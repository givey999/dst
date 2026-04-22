import { describe, it, expect, beforeAll } from "vitest";
import { CryptoService } from "./CryptoService.js";

let svc: CryptoService;
const PASSPHRASE = "correct horse battery staple";

beforeAll(() => {
  svc = new CryptoService();
});

describe("CryptoService.createVault / unlockVault", () => {
  it("creates a vault blob and unlocks it with the same passphrase", async () => {
    const { header, vaultKey } = await svc.createVault(PASSPHRASE);
    expect(header.length).toBe(84);
    expect(vaultKey.length).toBe(32);

    const unwrapped = await svc.unlockVault(header, PASSPHRASE);
    expect(unwrapped).toEqual(vaultKey);
  });

  it("fails to unlock with the wrong passphrase", async () => {
    const { header } = await svc.createVault(PASSPHRASE);
    await expect(svc.unlockVault(header, "nope")).rejects.toThrow(/passphrase/i);
  });

  it("rewrap: passphrase change keeps the same vaultKey", async () => {
    const { header: h1, vaultKey } = await svc.createVault(PASSPHRASE);
    const h2 = await svc.rewrap(h1, PASSPHRASE, "new-passphrase");
    const unwrappedNew = await svc.unlockVault(h2, "new-passphrase");
    expect(unwrappedNew).toEqual(vaultKey);
    await expect(svc.unlockVault(h2, PASSPHRASE)).rejects.toThrow();
  });
});

describe("CryptoService.encryptJson / decryptJson", () => {
  it("round-trips an object", async () => {
    const { vaultKey } = await svc.createVault(PASSPHRASE);
    const obj = { files: ["a", "b"], n: 42 };
    const ct = await svc.encryptJson(vaultKey, obj);
    const back = await svc.decryptJson<typeof obj>(vaultKey, ct);
    expect(back).toEqual(obj);
  });

  it("tamper detection flips a byte and fails", async () => {
    const { vaultKey } = await svc.createVault(PASSPHRASE);
    const ct = await svc.encryptJson(vaultKey, { x: 1 });
    ct.writeUInt8(ct.readUInt8(20) ^ 1, 20);
    await expect(svc.decryptJson(vaultKey, ct)).rejects.toThrow();
  });
});

describe("CryptoService chunk encryption", () => {
  it("round-trips a chunk", async () => {
    const { vaultKey } = await svc.createVault(PASSPHRASE);
    const plaintext = Buffer.from("hello world hello world");
    const ct = await svc.encryptChunk(vaultKey, {
      fileId: "00000000-0000-0000-0000-000000000001",
      seq: 0,
      totalChunks: 1,
      chunkHeader: Buffer.alloc(16, 0),
      plaintext,
    });
    const pt = await svc.decryptChunk(vaultKey, {
      fileId: "00000000-0000-0000-0000-000000000001",
      seq: 0,
      totalChunks: 1,
      chunkHeader: Buffer.alloc(16, 0),
      ciphertext: ct,
    });
    expect(pt).toEqual(plaintext);
  });

  it("rejects cross-file splicing (wrong fileId in AAD)", async () => {
    const { vaultKey } = await svc.createVault(PASSPHRASE);
    const plaintext = Buffer.from("hello");
    const ct = await svc.encryptChunk(vaultKey, {
      fileId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      seq: 0,
      totalChunks: 1,
      chunkHeader: Buffer.alloc(16, 0),
      plaintext,
    });
    await expect(
      svc.decryptChunk(vaultKey, {
        fileId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        seq: 0,
        totalChunks: 1,
        chunkHeader: Buffer.alloc(16, 0),
        ciphertext: ct,
      }),
    ).rejects.toThrow();
  });

  it("rejects reordered chunks (wrong seq in AAD)", async () => {
    const { vaultKey } = await svc.createVault(PASSPHRASE);
    const plaintext = Buffer.from("x");
    const ct = await svc.encryptChunk(vaultKey, {
      fileId: "11111111-1111-1111-1111-111111111111",
      seq: 0,
      totalChunks: 2,
      chunkHeader: Buffer.alloc(16, 0),
      plaintext,
    });
    await expect(
      svc.decryptChunk(vaultKey, {
        fileId: "11111111-1111-1111-1111-111111111111",
        seq: 1,
        totalChunks: 2,
        chunkHeader: Buffer.alloc(16, 0),
        ciphertext: ct,
      }),
    ).rejects.toThrow();
  });
});
