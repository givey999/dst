import type { CryptoService } from "./CryptoService.js";
import { HEADER_SIZE } from "../util/binary.js";

export interface ChunkRef {
  messageId: string;
  seq: number;
  ciphertextSize: number;
}

export interface FileEntry {
  id: string;
  name: string;
  size: number;
  mime: string;
  createdAt: string;
  chunks: ChunkRef[];
  chunkSize?: number;
}

export interface VaultIndex {
  version: 1;
  createdAt: string;
  updatedAt: string;
  revision: number;
  files: FileEntry[];
}

interface DiscordAttachmentReader {
  uploadAttachment(channelId: string, data: Buffer, filename: string): Promise<{ messageId: string; attachmentUrl: string }>;
  pinAndUnpinPrevious(channelId: string, messageId: string): Promise<void>;
  latestPinnedWithAttachment(channelId: string): Promise<{ id: string; attachmentData: Buffer } | null>;
  deleteMessages(channelId: string, messageIds: string[]): Promise<void>;
}

export interface IndexServiceDeps {
  crypto: CryptoService;
  discord: DiscordAttachmentReader;
  indexChannelId: string;
}

export class IndexService {
  private crypto: CryptoService;
  private discord: DiscordAttachmentReader;
  private indexChannelId: string;
  private vaultKey: Buffer | null = null;
  private header: Buffer | null = null;
  private index: VaultIndex | null = null;
  private lastRevisionOnDisk = 0;
  private lastMessageId: string | null = null;

  constructor(deps: IndexServiceDeps) {
    this.crypto = deps.crypto;
    this.discord = deps.discord;
    this.indexChannelId = deps.indexChannelId;
  }

  current(): VaultIndex {
    if (!this.index) throw new Error("index not loaded");
    return this.index;
  }

  lastMessageIdOnDisk(): string | null {
    return this.lastMessageId;
  }

  async createNew(args: { header: Buffer; vaultKey: Buffer }): Promise<void> {
    this.vaultKey = args.vaultKey;
    this.header = args.header;
    const now = new Date().toISOString();
    this.index = { version: 1, createdAt: now, updatedAt: now, revision: 1, files: [] };
    await this.save({ force: true });
  }

  async load(args: { vaultKey: Buffer; header: Buffer }): Promise<void> {
    const latest = await this.discord.latestPinnedWithAttachment(this.indexChannelId);
    if (!latest) throw new Error("no pinned index message");

    if (latest.attachmentData.length < HEADER_SIZE) throw new Error("index blob too short");
    const body = latest.attachmentData.subarray(HEADER_SIZE);
    const idx = await this.crypto.decryptJson<VaultIndex>(args.vaultKey, body);

    this.vaultKey = args.vaultKey;
    this.header = args.header;
    this.index = idx;
    this.lastRevisionOnDisk = idx.revision;
    this.lastMessageId = latest.id;
  }

  addFile(file: FileEntry): void {
    const idx = this.current();
    idx.files.unshift(file);
    idx.updatedAt = new Date().toISOString();
    idx.revision += 1;
  }

  removeFile(fileId: string): FileEntry | null {
    const idx = this.current();
    const pos = idx.files.findIndex((f) => f.id === fileId);
    if (pos < 0) return null;
    // pos >= 0 is verified above, so splice(pos,1)[0] is always defined
    const [removed] = idx.files.splice(pos, 1);
    if (!removed) throw new Error("splice returned empty array — this should never happen");
    idx.updatedAt = new Date().toISOString();
    idx.revision += 1;
    return removed;
  }

  findFile(fileId: string): FileEntry | null {
    const idx = this.current();
    return idx.files.find((f) => f.id === fileId) ?? null;
  }

  async save(opts: { force?: boolean } = {}): Promise<void> {
    if (!this.index || !this.vaultKey || !this.header) throw new Error("nothing to save");

    if (!opts.force) {
      const latest = await this.discord.latestPinnedWithAttachment(this.indexChannelId);
      if (latest) {
        const body = latest.attachmentData.subarray(HEADER_SIZE);
        const remote = await this.crypto.decryptJson<VaultIndex>(this.vaultKey, body);
        if (remote.revision > this.lastRevisionOnDisk) {
          throw new Error(`revision conflict: remote=${remote.revision}, base=${this.lastRevisionOnDisk}`);
        }
      }
    }

    const body = await this.crypto.encryptJson(this.vaultKey, this.index);
    const blob = Buffer.concat([this.header, body]);
    const { messageId } = await this.discord.uploadAttachment(this.indexChannelId, blob, "index.bin");
    await this.discord.pinAndUnpinPrevious(this.indexChannelId, messageId);

    this.lastRevisionOnDisk = this.index.revision;
    this.lastMessageId = messageId;
  }
}
