import type { Readable } from "node:stream";

const CHUNK_MAGIC = Buffer.from("dstc", "utf8");
export const CHUNK_HEADER_SIZE = 16;

export interface ChunkOut {
  seq: number;
  data: Buffer;
  header: Buffer;
}

export interface ParsedHeader {
  magic: string;
  version: number;
  seq: number;
  totalChunks: number;
}

export class ChunkerService {
  async *split(src: Readable, chunkSize: number): AsyncGenerator<ChunkOut> {
    const collected: Buffer[] = [];

    for await (const piece of src) {
      const b = Buffer.isBuffer(piece) ? piece : Buffer.from(piece as string);
      collected.push(b);
    }
    const full = Buffer.concat(collected);

    const total = Math.ceil(full.length / chunkSize);
    for (let i = 0; i < total; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, full.length);
      const data = full.subarray(start, end);
      const header = this.buildHeader(i, total);
      yield { seq: i, data, header };
    }
  }

  buildHeader(seq: number, totalChunks: number): Buffer {
    const buf = Buffer.alloc(CHUNK_HEADER_SIZE);
    CHUNK_MAGIC.copy(buf, 0);
    buf[4] = 1;
    buf.writeUInt32BE(seq, 5);
    buf.writeUInt32BE(totalChunks, 9);
    return buf;
  }

  parseHeader(buf: Buffer): ParsedHeader {
    if (buf.length < CHUNK_HEADER_SIZE) throw new Error("chunk header too short");
    if (!buf.subarray(0, 4).equals(CHUNK_MAGIC)) throw new Error("bad chunk magic");
    const version = buf.readUInt8(4);
    return {
      magic: CHUNK_MAGIC.toString("utf8"),
      version,
      seq: buf.readUInt32BE(5),
      totalChunks: buf.readUInt32BE(9),
    };
  }

  async reassemble(chunks: Array<{ seq: number; data: Buffer }>): Promise<Buffer> {
    const sorted = [...chunks].sort((a, b) => a.seq - b.seq);
    if (sorted.length === 0) return Buffer.alloc(0);

    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      if (!c || c.seq !== i) {
        throw new Error(`missing seq ${i} (found ${c?.seq ?? "none"})`);
      }
    }
    return Buffer.concat(sorted.map((c) => c.data));
  }
}
