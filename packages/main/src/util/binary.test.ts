import { describe, it, expect } from "vitest";
import { encodeHeader, decodeHeader, HEADER_SIZE } from "./binary.js";

describe("binary header", () => {
  it("HEADER_SIZE is 84", () => {
    expect(HEADER_SIZE).toBe(84);
  });

  it("round-trips a header", () => {
    const salt = Buffer.alloc(16, 1);
    const nonce = Buffer.alloc(12, 2);
    const wrapped = Buffer.alloc(48, 3);
    const buf = encodeHeader({ version: 1, argonSalt: salt, wrappedVaultKeyNonce: nonce, wrappedVaultKeyCiphertext: wrapped });
    expect(buf.length).toBe(HEADER_SIZE);
    const decoded = decodeHeader(buf);
    expect(decoded.version).toBe(1);
    expect(decoded.argonSalt).toEqual(salt);
    expect(decoded.wrappedVaultKeyNonce).toEqual(nonce);
    expect(decoded.wrappedVaultKeyCiphertext).toEqual(wrapped);
  });

  it("rejects bad magic", () => {
    const bad = Buffer.alloc(84, 0);
    expect(() => decodeHeader(bad)).toThrow(/magic/);
  });

  it("rejects unknown version", () => {
    const salt = Buffer.alloc(16, 1);
    const nonce = Buffer.alloc(12, 2);
    const wrapped = Buffer.alloc(48, 3);
    const buf = encodeHeader({ version: 1, argonSalt: salt, wrappedVaultKeyNonce: nonce, wrappedVaultKeyCiphertext: wrapped });
    buf[6] = 99;
    expect(() => decodeHeader(buf)).toThrow(/version/);
  });

  it("rejects short buffers", () => {
    expect(() => decodeHeader(Buffer.alloc(83))).toThrow(/length/);
  });
});
