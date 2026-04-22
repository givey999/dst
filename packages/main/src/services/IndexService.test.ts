import { describe, it, expect, beforeEach } from "vitest";
import { IndexService } from "./IndexService.js";
import { CryptoService } from "./CryptoService.js";
import { FakeDiscordClient } from "./__fakes__/FakeDiscordClient.js";

const PASS = "correct horse battery staple";

describe("IndexService", () => {
  let crypto: CryptoService;
  let disc: FakeDiscordClient;
  let svc: IndexService;
  let indexChannelId: string;

  beforeEach(() => {
    crypto = new CryptoService();
    disc = new FakeDiscordClient();
    indexChannelId = "idx-chan";
    svc = new IndexService({ crypto, discord: disc as never, indexChannelId });
  });

  it("createNew returns an empty index with the given header", async () => {
    const { header, vaultKey } = await crypto.createVault(PASS);
    await svc.createNew({ header, vaultKey });
    const idx = svc.current();
    expect(idx.files).toEqual([]);
    expect(idx.revision).toBe(1);
  });

  it("save + load round-trips the index", async () => {
    const { header, vaultKey } = await crypto.createVault(PASS);
    await svc.createNew({ header, vaultKey });

    svc.addFile({
      id: "11111111-1111-1111-1111-111111111111",
      name: "a.txt",
      size: 10,
      mime: "text/plain",
      createdAt: new Date().toISOString(),
      chunks: [{ messageId: "m1", seq: 0, ciphertextSize: 42 }],
    });
    await svc.save();

    const svc2 = new IndexService({ crypto, discord: disc as never, indexChannelId });
    await svc2.load({ vaultKey, header });

    const loaded = svc2.current();
    expect(loaded.files.length).toBe(1);
    const f0 = loaded.files[0];
    expect(f0?.name).toBe("a.txt");
  });

  it("revision conflict aborts save", async () => {
    const { header, vaultKey } = await crypto.createVault(PASS);
    await svc.createNew({ header, vaultKey });

    const svc2 = new IndexService({ crypto, discord: disc as never, indexChannelId });
    await svc2.load({ vaultKey, header });

    svc2.addFile({
      id: "22222222-2222-2222-2222-222222222222",
      name: "b.txt",
      size: 0,
      mime: "text/plain",
      createdAt: new Date().toISOString(),
      chunks: [],
    });
    await svc2.save();

    svc.addFile({
      id: "33333333-3333-3333-3333-333333333333",
      name: "c.txt",
      size: 0,
      mime: "text/plain",
      createdAt: new Date().toISOString(),
      chunks: [],
    });
    await expect(svc.save()).rejects.toThrow(/revision|conflict/i);
  });
});
