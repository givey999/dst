import { describe, it, expect } from "vitest";
import { ChunkerService, CHUNK_HEADER_SIZE } from "./ChunkerService.js";
import { Readable } from "node:stream";

function readableFrom(buf: Buffer): Readable {
  return Readable.from([buf]);
}

async function collectChunks(
  svc: ChunkerService,
  src: Buffer,
  chunkSize: number,
): Promise<Array<{ seq: number; data: Buffer; header: Buffer }>> {
  const out: Array<{ seq: number; data: Buffer; header: Buffer }> = [];
  for await (const c of svc.split(readableFrom(src), chunkSize)) {
    out.push(c);
  }
  return out;
}

describe("ChunkerService.split", () => {
  it("CHUNK_HEADER_SIZE is 16", () => {
    expect(CHUNK_HEADER_SIZE).toBe(16);
  });

  it("zero-byte file emits zero chunks", async () => {
    const svc = new ChunkerService();
    const chunks = await collectChunks(svc, Buffer.alloc(0), 100);
    expect(chunks.length).toBe(0);
  });

  it("file smaller than one chunk emits one chunk", async () => {
    const svc = new ChunkerService();
    const chunks = await collectChunks(svc, Buffer.from("hello"), 100);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.seq).toBe(0);
    expect(chunks[0]!.data).toEqual(Buffer.from("hello"));
  });

  it("exactly one chunk emits one chunk", async () => {
    const svc = new ChunkerService();
    const src = Buffer.alloc(100, 7);
    const chunks = await collectChunks(svc, src, 100);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.data.length).toBe(100);
  });

  it("one byte over emits two chunks", async () => {
    const svc = new ChunkerService();
    const src = Buffer.alloc(101, 7);
    const chunks = await collectChunks(svc, src, 100);
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.data.length).toBe(100);
    expect(chunks[1]!.data.length).toBe(1);
    expect(chunks[1]!.seq).toBe(1);
  });

  it("emits chunks with monotonic seq and correct totalChunks", async () => {
    const svc = new ChunkerService();
    const src = Buffer.alloc(250, 7);
    const chunks = await collectChunks(svc, src, 100);
    expect(chunks.length).toBe(3);
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2]);
    for (const c of chunks) {
      const { seq, totalChunks } = svc.parseHeader(c.header);
      expect(totalChunks).toBe(3);
      expect(seq).toBe(c.seq);
    }
  });
});

describe("ChunkerService.reassemble", () => {
  it("reassembles in-order chunks back to source", async () => {
    const svc = new ChunkerService();
    const src = Buffer.alloc(250, 7);
    src.write("hello", 0);
    const chunks = await collectChunks(svc, src, 100);
    const reassembled = await svc.reassemble(
      chunks.map((c) => ({ seq: c.seq, data: c.data })),
    );
    expect(reassembled).toEqual(src);
  });

  it("reassembles out-of-order chunks", async () => {
    const svc = new ChunkerService();
    const src = Buffer.alloc(250, 7);
    const chunks = await collectChunks(svc, src, 100);
    const shuffled = [chunks[2]!, chunks[0]!, chunks[1]!].map((c) => ({
      seq: c.seq,
      data: c.data,
    }));
    const reassembled = await svc.reassemble(shuffled);
    expect(reassembled).toEqual(src);
  });

  it("throws on missing seq", async () => {
    const svc = new ChunkerService();
    const src = Buffer.alloc(250, 7);
    const chunks = await collectChunks(svc, src, 100);
    const incomplete = [chunks[0]!, chunks[2]!].map((c) => ({
      seq: c.seq,
      data: c.data,
    }));
    await expect(svc.reassemble(incomplete)).rejects.toThrow(/missing|seq/);
  });
});
