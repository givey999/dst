import { describe, it, expect } from "vitest";
import { DiscordClient } from "./DiscordClient.js";

// Thin unit tests — verify the wrapper respects input validation.
// Real network behavior is covered in DiscordClient.e2e.test.ts.

describe("DiscordClient", () => {
  it("constructs without logging in", () => {
    const c = new DiscordClient();
    expect(c.isLoggedIn()).toBe(false);
  });

  it("throws if upload called before login", async () => {
    const c = new DiscordClient();
    await expect(
      c.uploadAttachment("channel-id", Buffer.from("x"), "file.bin"),
    ).rejects.toThrow(/not logged in/i);
  });

  it("throws on empty token", async () => {
    const c = new DiscordClient();
    await expect(c.login("")).rejects.toThrow(/token/i);
  });
});
