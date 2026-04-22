const MAGIC = Buffer.from("dstvlt", "utf8");
export const HEADER_SIZE = 84;
const VERSION_SUPPORTED = 1;

export interface VaultHeader {
  version: number;
  argonSalt: Buffer;
  wrappedVaultKeyNonce: Buffer;
  wrappedVaultKeyCiphertext: Buffer;
}

export function encodeHeader(h: VaultHeader): Buffer {
  if (h.argonSalt.length !== 16) throw new Error("argonSalt must be 16 bytes");
  if (h.wrappedVaultKeyNonce.length !== 12) throw new Error("wrappedVaultKeyNonce must be 12 bytes");
  if (h.wrappedVaultKeyCiphertext.length !== 48) throw new Error("wrappedVaultKeyCiphertext must be 48 bytes");

  const buf = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(buf, 0);
  buf[6] = h.version;
  buf[7] = 0;
  h.argonSalt.copy(buf, 8);
  h.wrappedVaultKeyNonce.copy(buf, 24);
  h.wrappedVaultKeyCiphertext.copy(buf, 36);
  return buf;
}

export function decodeHeader(buf: Buffer): VaultHeader {
  if (buf.length < HEADER_SIZE) throw new Error(`header length < ${HEADER_SIZE}`);
  if (!buf.subarray(0, 6).equals(MAGIC)) throw new Error("bad magic");
  const version = buf[6];
  if (version !== VERSION_SUPPORTED) throw new Error(`unsupported version ${version}`);

  return {
    version,
    argonSalt: Buffer.from(buf.subarray(8, 24)),
    wrappedVaultKeyNonce: Buffer.from(buf.subarray(24, 36)),
    wrappedVaultKeyCiphertext: Buffer.from(buf.subarray(36, 84)),
  };
}
