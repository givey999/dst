import argon2 from "argon2";
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "node:crypto";
import { encodeHeader, decodeHeader } from "../util/binary.js";

const ARGON2 = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;

const GCM_NONCE_SIZE = 12;
const GCM_TAG_SIZE = 16;
const KEY_SIZE = 32;

export interface EncryptChunkArgs {
  fileId: string;
  seq: number;
  totalChunks: number;
  chunkHeader: Buffer;
  plaintext: Buffer;
}

export interface DecryptChunkArgs {
  fileId: string;
  seq: number;
  totalChunks: number;
  chunkHeader: Buffer;
  ciphertext: Buffer;
}

export class CryptoService {
  async createVault(passphrase: string): Promise<{ header: Buffer; vaultKey: Buffer }> {
    const salt = randomBytes(16);
    const masterKey = await this.deriveMasterKey(passphrase, salt);
    const vaultKey = randomBytes(KEY_SIZE);

    const nonce = randomBytes(GCM_NONCE_SIZE);
    const cipher = createCipheriv("aes-256-gcm", masterKey, nonce);
    const ct = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
    const tag = cipher.getAuthTag();
    const wrapped = Buffer.concat([ct, tag]);

    const header = encodeHeader({
      version: 1,
      argonSalt: salt,
      wrappedVaultKeyNonce: nonce,
      wrappedVaultKeyCiphertext: wrapped,
    });
    return { header, vaultKey };
  }

  async unlockVault(header: Buffer, passphrase: string): Promise<Buffer> {
    const h = decodeHeader(header);
    const masterKey = await this.deriveMasterKey(passphrase, h.argonSalt);

    const ct = h.wrappedVaultKeyCiphertext.subarray(0, KEY_SIZE);
    const tag = h.wrappedVaultKeyCiphertext.subarray(KEY_SIZE);

    const decipher = createDecipheriv("aes-256-gcm", masterKey, h.wrappedVaultKeyNonce);
    decipher.setAuthTag(tag);
    try {
      const vaultKey = Buffer.concat([decipher.update(ct), decipher.final()]);
      return vaultKey;
    } catch {
      throw new Error("wrong passphrase or corrupted header");
    }
  }

  async rewrap(oldHeader: Buffer, oldPassphrase: string, newPassphrase: string): Promise<Buffer> {
    const vaultKey = await this.unlockVault(oldHeader, oldPassphrase);
    const salt = randomBytes(16);
    const newMasterKey = await this.deriveMasterKey(newPassphrase, salt);

    const nonce = randomBytes(GCM_NONCE_SIZE);
    const cipher = createCipheriv("aes-256-gcm", newMasterKey, nonce);
    const ct = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
    const tag = cipher.getAuthTag();

    return encodeHeader({
      version: 1,
      argonSalt: salt,
      wrappedVaultKeyNonce: nonce,
      wrappedVaultKeyCiphertext: Buffer.concat([ct, tag]),
    });
  }

  async encryptJson(vaultKey: Buffer, obj: unknown): Promise<Buffer> {
    const pt = Buffer.from(JSON.stringify(obj), "utf8");
    const nonce = randomBytes(GCM_NONCE_SIZE);
    const cipher = createCipheriv("aes-256-gcm", vaultKey, nonce);
    const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, ct, tag]);
  }

  async decryptJson<T>(vaultKey: Buffer, blob: Buffer): Promise<T> {
    const nonce = blob.subarray(0, GCM_NONCE_SIZE);
    const tag = blob.subarray(blob.length - GCM_TAG_SIZE);
    const ct = blob.subarray(GCM_NONCE_SIZE, blob.length - GCM_TAG_SIZE);
    const decipher = createDecipheriv("aes-256-gcm", vaultKey, nonce);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString("utf8")) as T;
  }

  async encryptChunk(vaultKey: Buffer, args: EncryptChunkArgs): Promise<Buffer> {
    const key = this.deriveChunkKey(vaultKey, args.fileId, args.seq);
    const nonce = randomBytes(GCM_NONCE_SIZE);
    const aad = this.chunkAad(args.fileId, args.seq, args.totalChunks, args.chunkHeader);

    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aad);
    const ct = Buffer.concat([cipher.update(args.plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, ct, tag]);
  }

  async decryptChunk(vaultKey: Buffer, args: DecryptChunkArgs): Promise<Buffer> {
    const key = this.deriveChunkKey(vaultKey, args.fileId, args.seq);
    const nonce = args.ciphertext.subarray(0, GCM_NONCE_SIZE);
    const tag = args.ciphertext.subarray(args.ciphertext.length - GCM_TAG_SIZE);
    const ct = args.ciphertext.subarray(GCM_NONCE_SIZE, args.ciphertext.length - GCM_TAG_SIZE);
    const aad = this.chunkAad(args.fileId, args.seq, args.totalChunks, args.chunkHeader);

    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    decipher.setAAD(aad);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  private async deriveMasterKey(passphrase: string, salt: Buffer): Promise<Buffer> {
    return argon2.hash(passphrase, { ...ARGON2, salt, raw: true }) as unknown as Promise<Buffer>;
  }

  private deriveChunkKey(vaultKey: Buffer, fileId: string, seq: number): Buffer {
    const salt = Buffer.concat([
      Buffer.from(fileId.replace(/-/g, ""), "hex"),
      this.u32BE(seq),
    ]);
    const info = Buffer.from("dst/chunk/v1", "utf8");
    return Buffer.from(hkdfSync("sha256", vaultKey, salt, info, 32));
  }

  private chunkAad(fileId: string, seq: number, totalChunks: number, chunkHeader: Buffer): Buffer {
    return Buffer.concat([
      Buffer.from(fileId, "utf8"),
      this.u32BE(seq),
      this.u32BE(totalChunks),
      chunkHeader,
    ]);
  }

  private u32BE(n: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n, 0);
    return b;
  }
}
