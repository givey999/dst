import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VaultService } from "./VaultService.js";
import { CryptoService } from "./CryptoService.js";
import { ChunkerService } from "./ChunkerService.js";
import { IndexService } from "./IndexService.js";
import { FakeDiscordClient } from "./__fakes__/FakeDiscordClient.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const PASS = "correct horse battery staple";

async function tmpFile(data: Buffer): Promise<string> {
  const p = path.join(os.tmpdir(), `dst-test-${Date.now()}-${Math.random()}.bin`);
  await fs.writeFile(p, data);
  return p;
}

describe("VaultService", () => {
  let crypto: CryptoService;
  let chunker: ChunkerService;
  let discord: FakeDiscordClient;
  let index: IndexService;
  let svc: VaultService;

  beforeEach(async () => {
    crypto = new CryptoService();
    chunker = new ChunkerService();
    discord = new FakeDiscordClient();
    index = new IndexService({ crypto, discord: discord as never, indexChannelId: "idx" });
    svc = new VaultService({
      crypto,
      chunker,
      discord: discord as never,
      index,
      filesChannelId: "files",
      chunkSize: 1024,
    });
    const { header, vaultKey } = await crypto.createVault(PASS);
    await index.createNew({ header, vaultKey });
    await svc.unlock(PASS, header);
  });

  afterEach(async () => {
    await svc.flush().catch(() => void 0);
    svc.lock();
  });

  it("uploads a small file and downloads it byte-identical", async () => {
    const src = Buffer.from("hello world hello world");
    const srcPath = await tmpFile(src);
    const handle = svc.upload(srcPath);
    await handle.done;

    const files = svc.list();
    expect(files.length).toBe(1);

    const destPath = path.join(os.tmpdir(), `dst-dl-${Date.now()}.bin`);
    const f0 = files[0];
    expect(f0).toBeDefined();
    const dl = svc.download(f0!.id, destPath);
    await dl.done;
    const back = await fs.readFile(destPath);
    expect(back).toEqual(src);
  });

  it("uploads a multi-chunk file and downloads it byte-identical", async () => {
    const src = Buffer.alloc(3500, 0);
    for (let i = 0; i < src.length; i++) src[i] = i & 0xff;
    const srcPath = await tmpFile(src);
    const handle = svc.upload(srcPath);
    await handle.done;

    const files = svc.list();
    expect(files.length).toBe(1);
    const destPath = path.join(os.tmpdir(), `dst-dl-${Date.now()}.bin`);
    await svc.download(files[0]!.id, destPath).done;
    const back = await fs.readFile(destPath);
    expect(back).toEqual(src);
  });

  it("delete removes chunks and index entry", async () => {
    const srcPath = await tmpFile(Buffer.from("bye"));
    await svc.upload(srcPath).done;
    const files = svc.list();
    const id = files[0]!.id;
    await svc.delete(id);
    expect(svc.list().length).toBe(0);
  });
});
