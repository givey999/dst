import { Client, GatewayIntentBits, AttachmentBuilder, ChannelType, PermissionFlagsBits } from "discord.js";
import type { TextChannel, Message } from "discord.js";

// Wrap a Discord API call so errors say which operation failed.
// discord.js usually throws DiscordAPIError with .code (like 50013) and .message ("Missing Permissions").
async function discordOp<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const err = e as { message?: string; code?: number | string };
    const code = err.code != null ? ` [code=${err.code}]` : "";
    throw new Error(`${label} failed: ${err.message ?? String(e)}${code}`);
  }
}

export interface UploadResult {
  messageId: string;
  attachmentUrl: string;
}

export interface GuildInfo {
  id: string;
  name: string;
  premiumTier: 0 | 1 | 2 | 3;
}

export class DiscordClient {
  private client: Client | null = null;

  isLoggedIn(): boolean {
    return this.client !== null && this.client.isReady();
  }

  async login(token: string): Promise<{ id: string; username: string; avatarUrl: string | null }> {
    if (!token || token.length < 30) throw new Error("token must be a valid Discord bot token");

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });

    await new Promise<void>((resolve, reject) => {
      client.once("ready", () => resolve());
      client.once("error", reject);
      client.login(token).catch(reject);
    });

    this.client = client;
    const user = client.user!;
    return {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatarURL() ?? null,
    };
  }

  async logout(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.client = null;
    }
  }

  async listGuilds(): Promise<GuildInfo[]> {
    this.requireClient();
    const out: GuildInfo[] = [];
    for (const g of this.client!.guilds.cache.values()) {
      out.push({ id: g.id, name: g.name, premiumTier: g.premiumTier as 0 | 1 | 2 | 3 });
    }
    return out;
  }

  async fetchGuild(guildId: string): Promise<GuildInfo> {
    this.requireClient();
    const g = await this.client!.guilds.fetch(guildId);
    return { id: g.id, name: g.name, premiumTier: g.premiumTier as 0 | 1 | 2 | 3 };
  }

  async findOrCreateTextChannel(guildId: string, name: string): Promise<string> {
    this.requireClient();
    const g = await discordOp(`fetchGuild(${guildId})`, () => this.client!.guilds.fetch(guildId));
    const existing = g.channels.cache.find((c) => c.name === name && c.type === ChannelType.GuildText);
    const botId = this.client!.user!.id;

    // Explicit permission overrides guarantee the bot has what it needs on this channel,
    // regardless of role-level permissions, OAuth uncheckings, or later role edits.
    const botAllow = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ManageChannels,
    ];

    if (existing) {
      // Try to ensure the bot's overrides on a pre-existing channel; best-effort,
      // since editing existing channel overrides requires MANAGE_ROLES (which we
      // don't ask for in the OAuth invite). Swallow the error if we lack it —
      // the subsequent operation will fail with its own labeled error if needed.
      await (existing as TextChannel).permissionOverwrites
        .edit(botId, {
          ViewChannel: true,
          SendMessages: true,
          AttachFiles: true,
          ReadMessageHistory: true,
          ManageMessages: true,
          ManageChannels: true,
        })
        .catch(() => void 0);
      return existing.id;
    }

    const created = await discordOp(
      `channels.create(${name})`,
      () => g.channels.create({
        name,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: botId,
            allow: botAllow,
          },
        ],
      }),
    );
    return created.id;
  }

  async uploadAttachment(channelId: string, data: Buffer, filename: string): Promise<UploadResult> {
    this.requireClient();
    const ch = await this.channel(channelId);
    const att = new AttachmentBuilder(data, { name: filename });
    const msg = await discordOp(`ch.send(${filename})`, () => ch.send({ files: [att] }));
    const attUrl = msg.attachments.first()?.url ?? null;
    if (!attUrl) throw new Error("upload succeeded but attachment URL missing");
    return { messageId: msg.id, attachmentUrl: attUrl };
  }

  async fetchAttachmentUrl(channelId: string, messageId: string): Promise<string> {
    this.requireClient();
    const ch = await this.channel(channelId);
    const msg = await discordOp(`messages.fetch(${messageId})`, () => ch.messages.fetch(messageId));
    const url = msg.attachments.first()?.url;
    if (!url) throw new Error(`no attachment on message ${messageId}`);
    return url;
  }

  async fetchAttachmentData(channelId: string, messageId: string): Promise<Buffer> {
    const url = await this.fetchAttachmentUrl(channelId, messageId);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`attachment fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async deleteMessages(channelId: string, messageIds: string[]): Promise<void> {
    this.requireClient();
    if (messageIds.length === 0) return;
    const ch = await this.channel(channelId);

    const young: string[] = [];
    const old: string[] = [];
    const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const id of messageIds) {
      const snowflake = BigInt(id);
      const ts = Number((snowflake >> 22n) + 1420070400000n);
      if (now - ts < TWO_WEEKS_MS) young.push(id);
      else old.push(id);
    }

    while (young.length > 0) {
      const batch = young.splice(0, 100);
      await ch.bulkDelete(batch);
    }
    for (const id of old) {
      const m = await ch.messages.fetch(id).catch((_e) => null);
      if (m) await m.delete();
    }
  }

  async pinAndUnpinPrevious(channelId: string, messageId: string): Promise<void> {
    this.requireClient();
    const ch = await this.channel(channelId);

    // Unpin first, then pin: avoids hitting Discord's 50-pins-per-channel cap
    // if the channel ever accumulated stale pins from crashes or manual edits.
    const pins = await discordOp("messages.fetchPinned", () => ch.messages.fetchPinned());
    for (const pinned of pins.values()) {
      if (pinned.id !== messageId) {
        await discordOp(`unpin(${pinned.id})`, () => pinned.unpin());
      }
    }

    const msg = await discordOp(`messages.fetch(${messageId})`, () => ch.messages.fetch(messageId));
    await discordOp(`pin(${messageId})`, () => msg.pin());
  }

  async latestPinnedMessage(channelId: string): Promise<Message | null> {
    this.requireClient();
    const ch = await this.channel(channelId);
    const pins = await ch.messages.fetchPinned();
    if (pins.size === 0) return null;
    return pins.sort((a, b) => b.createdTimestamp - a.createdTimestamp).first() ?? null;
  }

  async latestPinnedWithAttachment(channelId: string): Promise<{ id: string; attachmentData: Buffer } | null> {
    this.requireClient();
    const latest = await this.latestPinnedMessage(channelId);
    if (!latest) return null;
    const data = await this.fetchAttachmentData(channelId, latest.id);
    return { id: latest.id, attachmentData: data };
  }

  async listChannelMessageIds(channelId: string): Promise<string[]> {
    this.requireClient();
    const ch = await this.channel(channelId);
    const out: string[] = [];
    let before: string | undefined;
    for (;;) {
      const batch = await ch.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (batch.size === 0) break;
      const arr = [...batch.values()].sort((a, b) => (a.createdTimestamp < b.createdTimestamp ? 1 : -1));
      for (const m of arr) out.push(m.id);
      const next = arr[arr.length - 1]?.id;
      if (!next) break;
      before = next;
      if (batch.size < 100) break;
    }
    return out;
  }

  private requireClient(): void {
    if (!this.client) throw new Error("DiscordClient not logged in");
    if (!this.client.isReady()) throw new Error("DiscordClient not ready");
  }

  private async channel(channelId: string): Promise<TextChannel> {
    const ch = await this.client!.channels.fetch(channelId);
    if (!ch || ch.type !== ChannelType.GuildText) throw new Error(`channel ${channelId} is not a guild text channel`);
    return ch as TextChannel;
  }
}
