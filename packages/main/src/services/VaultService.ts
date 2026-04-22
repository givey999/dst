import { EventEmitter } from "eventemitter3";
import { promises as fs, createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { CryptoService } from "./CryptoService.js";
import type { ChunkerService } from "./ChunkerService.js";
import type { IndexService, FileEntry, ChunkRef } from "./IndexService.js";

interface DiscordOps {
  uploadAttachment(channelId: string, data: Buffer, filename: string): Promise<{ messageId: string }>;
  fetchAttachmentData(channelId: string, messageId: string): Promise<Buffer>;
  deleteMessages(channelId: string, messageIds: string[]): Promise<void>;
  listChannelMessageIds(channelId: string): Promise<string[]>;
}

export interface VaultServiceDeps {
  crypto: CryptoService;
  chunker: ChunkerService;
  discord: DiscordOps;
  index: IndexService;
  filesChannelId: string;
  chunkSize: number;
}

export interface UploadHandle {
  uploadId: string;
  events: EventEmitter;
  cancel: () => void;
  done: Promise<FileEntry>;
}

export interface DownloadHandle {
  downloadId: string;
  events: EventEmitter;
  cancel: () => void;
  done: Promise<void>;
}

const CONCURRENCY = 3;
const INDEX_SAVE_DEBOUNCE_MS = 2_000;

export class VaultService {
  private crypto: CryptoService;
  private chunker: ChunkerService;
  private discord: DiscordOps;
  private index: IndexService;
  private filesChannelId: string;
  private chunkSize: number;

  private vaultKey: Buffer | null = null;
  private unlocked = false;
  private indexSaveTimer: NodeJS.Timeout | null = null;

  readonly events = new EventEmitter();

  constructor(deps: VaultServiceDeps) {
    this.crypto = deps.crypto;
    this.chunker = deps.chunker;
    this.discord = deps.discord;
    this.index = deps.index;
    this.filesChannelId = deps.filesChannelId;
    this.chunkSize = deps.chunkSize;
  }

  async unlock(passphrase: string, header: Buffer): Promise<void> {
    this.vaultKey = await this.crypto.unlockVault(header, passphrase);
    await this.index.load({ vaultKey: this.vaultKey, header });
    this.unlocked = true;
  }

  lock(): void {
    if (this.indexSaveTimer) {
      clearTimeout(this.indexSaveTimer);
      this.indexSaveTimer = null;
    }
    if (this.vaultKey) this.vaultKey.fill(0);
    this.vaultKey = null;
    this.unlocked = false;
  }

  async changePassphrase(oldP: string, newP: string): Promise<void> {
    this.requireUnlocked();
    const currentHeader = this.index.getHeader();
    const newHeader = await this.crypto.rewrap(currentHeader, oldP, newP);
    this.index.setHeader(newHeader);
    // Refresh the in-memory vaultKey using the new header path.
    this.vaultKey = await this.crypto.unlockVault(newHeader, newP);
    await this.index.save();
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  list(): FileEntry[] {
    this.requireUnlocked();
    return this.index.current().files;
  }

  upload(localPath: string): UploadHandle {
    this.requireUnlocked();
    const uploadId = randomUUID();
    const events = new EventEmitter();
    const name = path.basename(localPath);
    let cancelled = false;

    // Hoisted so the error handler can report progress-at-failure.
    let totalBytes = 0;
    let chunksTotal = 0;
    let chunksComplete = 0;
    let bytesUploaded = 0;

    const done = (async (): Promise<FileEntry> => {
      const stat = await fs.stat(localPath);
      totalBytes = stat.size;
      const fileId = randomUUID();
      chunksTotal = Math.max(1, Math.ceil(stat.size / this.chunkSize));
      events.emit("progress", { uploadId, name, bytesUploaded: 0, total: totalBytes, chunksComplete: 0, chunksTotal, state: "uploading" });

      const stream = createReadStream(localPath, { highWaterMark: this.chunkSize });
      const chunks: Array<{ seq: number; data: Buffer; header: Buffer }> = [];
      for await (const c of this.chunker.split(stream, this.chunkSize)) {
        chunks.push(c);
      }

      const chunkRefs: ChunkRef[] = [];
      let errored = false;

      const uploadOne = async (c: { seq: number; data: Buffer; header: Buffer }): Promise<ChunkRef> => {
        if (cancelled) throw new Error("cancelled");
        const ct = await this.crypto.encryptChunk(this.vaultKey!, {
          fileId,
          seq: c.seq,
          totalChunks: chunksTotal,
          chunkHeader: c.header,
          plaintext: c.data,
        });
        const framed = Buffer.concat([c.header, ct]);
        const { messageId } = await this.discord.uploadAttachment(this.filesChannelId, framed, `${fileId}-${c.seq}.bin`);
        chunksComplete++;
        bytesUploaded += c.data.length;
        events.emit("progress", {
          uploadId, name, bytesUploaded, total: totalBytes, chunksComplete, chunksTotal, state: "uploading",
        });
        return { messageId, seq: c.seq, ciphertextSize: framed.length };
      };

      const queue = [...chunks];
      const workers: Array<Promise<void>> = [];
      for (let w = 0; w < CONCURRENCY; w++) {
        workers.push((async () => {
          while (!errored && !cancelled && queue.length > 0) {
            const next = queue.shift();
            if (!next) break;
            try {
              const ref = await uploadOne(next);
              chunkRefs.push(ref);
            } catch (e) {
              errored = true;
              throw e;
            }
          }
        })());
      }
      await Promise.all(workers);

      chunkRefs.sort((a, b) => a.seq - b.seq);

      const entry: FileEntry = {
        id: fileId,
        name,
        size: stat.size,
        mime: guessMime(name),
        createdAt: new Date().toISOString(),
        chunks: chunkRefs,
        chunkSize: this.chunkSize,
      };
      this.index.addFile(entry);
      this.scheduleIndexSave();
      events.emit("progress", { uploadId, name, bytesUploaded: stat.size, total: stat.size, chunksComplete: chunksTotal, chunksTotal, state: "done" });
      return entry;
    })();

    done.catch((err: Error) => {
      events.emit("progress", {
        uploadId, name, bytesUploaded, total: totalBytes, chunksComplete, chunksTotal,
        state: "error", error: err.message,
      });
    });

    return {
      uploadId,
      events,
      cancel: () => { cancelled = true; },
      done,
    };
  }

  download(fileId: string, destPath: string): DownloadHandle {
    this.requireUnlocked();
    const downloadId = randomUUID();
    const events = new EventEmitter();
    let cancelled = false;

    // Hoisted so the error handler can report progress-at-failure.
    let resolvedName = path.basename(destPath);
    let totalBytes = 0;
    let bytesDownloaded = 0;

    const done = (async (): Promise<void> => {
      const file = this.index.findFile(fileId);
      if (!file) throw new Error("file not found");
      resolvedName = file.name;
      totalBytes = file.size;

      events.emit("progress", { downloadId, name: resolvedName, bytesDownloaded: 0, total: totalBytes, state: "fetching" });

      const results = new Map<number, Buffer>();
      const queue = [...file.chunks];
      let errored = false;

      const downloadOne = async (ref: ChunkRef): Promise<void> => {
        if (cancelled) throw new Error("cancelled");
        const framed = await this.discord.fetchAttachmentData(this.filesChannelId, ref.messageId);
        const chunkHeader = framed.subarray(0, 16);
        const ct = framed.subarray(16);

        const pt = await this.crypto.decryptChunk(this.vaultKey!, {
          fileId: file.id,
          seq: ref.seq,
          totalChunks: file.chunks.length,
          chunkHeader,
          ciphertext: ct,
        });
        results.set(ref.seq, pt);
        bytesDownloaded += pt.length;
        events.emit("progress", { downloadId, name: resolvedName, bytesDownloaded, total: totalBytes, state: "decrypting" });
      };

      const workers: Array<Promise<void>> = [];
      for (let w = 0; w < CONCURRENCY; w++) {
        workers.push((async () => {
          while (!errored && !cancelled && queue.length > 0) {
            const n = queue.shift();
            if (!n) break;
            try {
              await downloadOne(n);
            } catch (e) {
              errored = true;
              throw e;
            }
          }
        })());
      }
      await Promise.all(workers);

      const ordered: Buffer[] = [];
      for (let i = 0; i < file.chunks.length; i++) {
        const p = results.get(i);
        if (!p) throw new Error(`missing chunk seq ${i}`);
        ordered.push(p);
      }
      const out = Buffer.concat(ordered);
      await pipeline(Readable.from(out), createWriteStream(destPath));

      events.emit("progress", { downloadId, name: resolvedName, bytesDownloaded: totalBytes, total: totalBytes, state: "done" });
    })();

    done.catch((err: Error) => {
      events.emit("progress", {
        downloadId, name: resolvedName, bytesDownloaded, total: totalBytes,
        state: "error", error: err.message,
      });
    });

    return {
      downloadId,
      events,
      cancel: () => { cancelled = true; },
      done,
    };
  }

  async delete(fileId: string): Promise<void> {
    this.requireUnlocked();
    const entry = this.index.findFile(fileId);
    if (!entry) return;
    const ids = entry.chunks.map((c) => c.messageId);
    await this.discord.deleteMessages(this.filesChannelId, ids);
    this.index.removeFile(fileId);
    this.scheduleIndexSave();
  }

  async garbageCollect(): Promise<{ orphans: number; reclaimedBytes: number }> {
    this.requireUnlocked();
    const idx = this.index.current();
    const referenced = new Set<string>();
    for (const f of idx.files) {
      for (const c of f.chunks) referenced.add(c.messageId);
    }

    const allInFiles = await this.discord.listChannelMessageIds(this.filesChannelId);
    const orphans = allInFiles.filter((id) => !referenced.has(id));

    if (orphans.length > 0) {
      await this.discord.deleteMessages(this.filesChannelId, orphans);
    }
    // We don't have a cheap way to know bytes without fetching each — v1 returns 0.
    return { orphans: orphans.length, reclaimedBytes: 0 };
  }

  async flush(): Promise<void> {
    if (this.indexSaveTimer) {
      clearTimeout(this.indexSaveTimer);
      this.indexSaveTimer = null;
      try {
        await this.index.save();
      } catch (err) {
        this.events.emit("indexSaveFailed", err as Error);
        throw err;
      }
    }
  }

  private scheduleIndexSave(): void {
    if (this.indexSaveTimer) clearTimeout(this.indexSaveTimer);
    this.indexSaveTimer = setTimeout(() => {
      this.indexSaveTimer = null;
      void this.index.save().catch((err: Error) => {
        this.events.emit("indexSaveFailed", err);
      });
    }, INDEX_SAVE_DEBOUNCE_MS);
  }

  private requireUnlocked(): void {
    if (!this.unlocked || !this.vaultKey) throw new Error("vault locked");
  }
}

function guessMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const m: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    flac: "audio/flac",
    wav: "audio/wav",
    ogg: "audio/ogg",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    zip: "application/zip",
    rar: "application/vnd.rar",
    "7z": "application/x-7z-compressed",
  };
  return m[ext] ?? "application/octet-stream";
}
