import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DiscordClient } from "./DiscordClient.js";

const GATE = process.env.DST_E2E_GATE === "1";
const TOKEN = process.env.DST_E2E_TOKEN;
const GUILD_ID = process.env.DST_E2E_GUILD_ID;

describe.skipIf(!GATE || !TOKEN || !GUILD_ID)("DiscordClient e2e", () => {
  const c = new DiscordClient();
  let channelId: string;

  beforeAll(async () => {
    await c.login(TOKEN!);
    channelId = await c.findOrCreateTextChannel(GUILD_ID!, "dst-e2e");
  });

  afterAll(async () => {
    await c.logout();
  });

  it("uploads, re-resolves URL, and deletes", async () => {
    const payload = Buffer.from("e2e " + Date.now());
    const { messageId, attachmentUrl } = await c.uploadAttachment(channelId, payload, "e2e.bin");
    expect(messageId).toMatch(/^\d+$/);
    expect(attachmentUrl).toContain("cdn.discordapp.com");

    const refreshed = await c.fetchAttachmentUrl(channelId, messageId);
    expect(refreshed).toContain("cdn.discordapp.com");

    const res = await fetch(refreshed);
    const back = Buffer.from(await res.arrayBuffer());
    expect(back).toEqual(payload);

    await c.deleteMessages(channelId, [messageId]);
  });
});
