import { EventEmitter } from "node:events";

interface StoredMessage {
  id: string;
  attachment: Buffer;
  filename: string;
  pinned: boolean;
  createdAt: number;
}

export class FakeDiscordClient extends EventEmitter {
  private messages = new Map<string, StoredMessage[]>();
  private idCounter = 1;

  isLoggedIn(): boolean {
    return true;
  }

  private getChannel(channelId: string): StoredMessage[] {
    let arr = this.messages.get(channelId);
    if (!arr) {
      arr = [];
      this.messages.set(channelId, arr);
    }
    return arr;
  }

  async uploadAttachment(channelId: string, data: Buffer, filename: string): Promise<{ messageId: string; attachmentUrl: string }> {
    const id = `fake-msg-${this.idCounter++}`;
    const arr = this.getChannel(channelId);
    arr.push({ id, attachment: Buffer.from(data), filename, pinned: false, createdAt: Date.now() });
    return { messageId: id, attachmentUrl: `fake://${channelId}/${id}` };
  }

  async fetchAttachmentUrl(channelId: string, messageId: string): Promise<string> {
    const arr = this.getChannel(channelId);
    const m = arr.find((x) => x.id === messageId);
    if (!m) throw new Error("not found");
    return `fake://${channelId}/${messageId}`;
  }

  async fetchAttachmentData(channelId: string, messageId: string): Promise<Buffer> {
    const arr = this.getChannel(channelId);
    const m = arr.find((x) => x.id === messageId);
    if (!m) throw new Error("not found");
    return Buffer.from(m.attachment);
  }

  async deleteMessages(channelId: string, messageIds: string[]): Promise<void> {
    const arr = this.getChannel(channelId);
    for (const id of messageIds) {
      const i = arr.findIndex((x) => x.id === id);
      if (i >= 0) arr.splice(i, 1);
    }
  }

  async latestChannelMessageWithAttachment(channelId: string): Promise<{ id: string; attachmentData: Buffer } | null> {
    const arr = this.getChannel(channelId);
    const sorted = [...arr].sort((a, b) => b.createdAt - a.createdAt);
    const p = sorted[0];
    if (!p) return null;
    return { id: p.id, attachmentData: Buffer.from(p.attachment) };
  }

  async deleteOwnOlderMessages(channelId: string, keepId: string): Promise<void> {
    const arr = this.getChannel(channelId);
    // Fake assumes every message in the channel belongs to the "bot".
    for (let i = arr.length - 1; i >= 0; i--) {
      const item = arr[i];
      if (item && item.id !== keepId) arr.splice(i, 1);
    }
  }

  async listChannelMessageIds(channelId: string): Promise<string[]> {
    return this.getChannel(channelId).map((m) => m.id);
  }
}
