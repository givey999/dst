import keytar from "keytar";
import { CryptoService } from "./services/CryptoService.js";
import { ChunkerService } from "./services/ChunkerService.js";
import { DiscordClient } from "./services/DiscordClient.js";
import { IndexService } from "./services/IndexService.js";
import { VaultService } from "./services/VaultService.js";
import { HEADER_SIZE } from "./util/binary.js";

const KEYCHAIN_SERVICE = "dst";
const KEYCHAIN_TOKEN_KEY = "bot-token";
const KEYCHAIN_GUILD_KEY = "guild-id";

export class AppState {
  readonly crypto = new CryptoService();
  readonly chunker = new ChunkerService();
  readonly discord = new DiscordClient();
  vault: VaultService | null = null;

  guildId: string | null = null;
  guildName: string | null = null;
  filesChannelId: string | null = null;
  indexChannelId: string | null = null;
  chunkSize = 9 * 1024 * 1024;

  async loadBootstrap(): Promise<void> {
    const token = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_TOKEN_KEY);
    const guildId = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_GUILD_KEY);
    if (!token || !guildId) return;

    try {
      await this.discord.login(token);
      const g = await this.discord.fetchGuild(guildId);
      this.guildId = g.id;
      this.guildName = g.name;
      this.filesChannelId = await this.discord.findOrCreateTextChannel(g.id, "files");
      this.indexChannelId = await this.discord.findOrCreateTextChannel(g.id, "index");
      this.chunkSize = this.chunkSizeForTier(g.premiumTier);
      this.instantiateVault();
    } catch (e) {
      // If bootstrap fails (bad token, guild gone), leave state blank.
      // User goes through the wizard again.
      // eslint-disable-next-line no-console
      console.warn("dst bootstrap failed:", (e as Error).message);
      await this.discord.logout().catch(() => void 0);
      this.guildId = null;
      this.guildName = null;
      this.filesChannelId = null;
      this.indexChannelId = null;
      this.vault = null;
    }
  }

  instantiateVault(): void {
    if (!this.filesChannelId || !this.indexChannelId) {
      throw new Error("cannot instantiate vault — channels not set");
    }
    const index = new IndexService({
      crypto: this.crypto,
      discord: this.discord,
      indexChannelId: this.indexChannelId,
    });
    this.vault = new VaultService({
      crypto: this.crypto,
      chunker: this.chunker,
      discord: this.discord,
      index,
      filesChannelId: this.filesChannelId,
      chunkSize: this.chunkSize,
    });
    this.vault.events.on("indexSaveFailed", (err: Error) => {
      // eslint-disable-next-line no-console
      console.warn("index save failed:", err.message);
    });
  }

  async storeToken(token: string): Promise<void> {
    await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_TOKEN_KEY, token);
  }

  async storeGuild(guildId: string): Promise<void> {
    await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_GUILD_KEY, guildId);
  }

  async clearCredentials(): Promise<void> {
    await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_TOKEN_KEY);
    await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_GUILD_KEY);
  }

  async fetchVaultHeader(): Promise<Buffer | null> {
    if (!this.indexChannelId) return null;
    const latest = await this.discord.latestChannelMessageWithAttachment(this.indexChannelId);
    if (!latest) return null;
    if (latest.attachmentData.length < HEADER_SIZE) return null;
    return latest.attachmentData.subarray(0, HEADER_SIZE);
  }

  chunkSizeForTier(tier: 0 | 1 | 2 | 3): number {
    if (tier >= 3) return 99 * 1024 * 1024;
    if (tier >= 2) return 49 * 1024 * 1024;
    return 9 * 1024 * 1024;
  }

  async initAfterGuildPicked(guildId: string): Promise<void> {
    const g = await this.discord.fetchGuild(guildId);
    this.guildId = g.id;
    this.guildName = g.name;
    this.filesChannelId = await this.discord.findOrCreateTextChannel(g.id, "files");
    this.indexChannelId = await this.discord.findOrCreateTextChannel(g.id, "index");
    this.chunkSize = this.chunkSizeForTier(g.premiumTier);
    this.instantiateVault();
    await this.storeGuild(g.id);
  }
}
