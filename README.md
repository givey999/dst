# dst

Encrypted infinite storage over Discord.

## What it does

Turns a private Discord server into your personal encrypted vault. Drag a file in — it's split into AES-256-GCM-encrypted chunks, uploaded as attachments by your bot, and tracked in an encrypted index stored as the most recent message in the `#index` channel. Install on any PC with the same bot token + passphrase and your files are there.

Zero-knowledge: Discord sees only ciphertext and one encrypted index blob. Filenames included.

### Features

- **Upload / download / delete** with per-file 3-parallel chunk workers and live progress in the Uploads tab.
- **Folders** (including empty ones) — type any path like `photos/2024/` when creating.
- **Rename** files inline. Click the row's `rename` button → type → Enter.
- **Preview** any file — downloads to a temp dir and opens in your OS default app (image viewer, PDF reader, video player, editor, whatever). Temp copies are cleaned up on app close.
- **Passphrase change** that rewraps the vaultKey in milliseconds without re-uploading any chunks.
- **Second-machine portability** — wizard auto-detects existing vaults when you paste the same bot token.
- **Dark UI** with custom confirm dialogs and toast notifications (no browser-native dialogs).

## Who this is for

A personal tool for one human. Not a product, not for public distribution. Using Discord as a storage backend is a gray area of Discord's ToS — don't be loud about it.

## Requirements

- Windows 10+
- A Discord account
- 5 minutes for first-run setup
- For building: Node.js 20+, pnpm 9+, Windows Developer Mode enabled (Settings → For Developers → Developer Mode → On) so electron-builder can extract symlinks.

## Install (end user)

Download the latest `dst Setup x.y.z.exe` or `dst-x.y.z.exe` (portable) from your own build output (`release/`).

Windows SmartScreen will warn on first launch (the installer isn't code-signed). Click "More info" → "Run anyway."

First launch drops you into a 5-step setup wizard that creates the Discord bot and server for you.

## Dev

```bash
pnpm install
pnpm --filter @dst/shared build
pnpm --filter @dst/preload build
pnpm --filter @dst/main build
pnpm --filter @dst/main start
```

During development you can also run:

```bash
pnpm test         # 41 unit tests
pnpm typecheck    # all packages
pnpm lint         # main package eslint
```

## Package

```bash
pnpm package            # NSIS installer + portable, Windows x64
pnpm package:portable   # portable only
```

Artifacts appear in `release/`. First build downloads Electron binaries (~2-5 minutes).

## Integration tests

Optional, require a throwaway bot + server:

```bash
DST_E2E_TOKEN=<bot-token> DST_E2E_GUILD_ID=<guild-id> pnpm --filter @dst/main test:e2e
```

## Architecture

- **Electron main** (`packages/main`): services (CryptoService, ChunkerService, DiscordClient, IndexService, VaultService) + IPC handlers.
- **Preload** (`packages/preload`): typed `window.dst` bridge via `contextBridge`.
- **Renderer** (`packages/renderer`): vanilla HTML/CSS/ESM JS — no framework.
- **Shared** (`packages/shared`): IPC request/response type definitions.

### Encryption

Argon2id(passphrase, salt) → masterKey. masterKey wraps a random vaultKey (AES-256-GCM). Per-chunk keys derive from vaultKey via HKDF-SHA-256. Each chunk is AES-256-GCM encrypted with AAD binding `{ fileId, seq, totalChunks, chunkHeader }`. The index itself is also AES-256-GCM encrypted with the vaultKey.

Changing your passphrase rewraps the vaultKey in milliseconds — no chunks are re-encrypted.

See `docs/superpowers/specs/2026-04-22-dst-design.md` for the full design spec.

## Back up your secrets

The only two secrets worth backing up:

1. **Bot token** (stored at runtime in the OS keychain; re-paste in the wizard on a fresh install).
2. **Passphrase** (never stored anywhere; write it down on paper).

Losing the passphrase = files are gone forever. Losing the bot token = create a new bot and re-invite it to the same server.

## Testing

- 41 unit tests across `@dst/main` covering crypto, chunking, indexing, vault orchestration, folder handling, and the rename flow.
- 1 gated end-to-end test for DiscordClient (requires real bot + server + `DST_E2E_GATE=1`).
- Manual test checklist: `docs/manual-test.md`.

## License

**Polyform Noncommercial 1.0.0** — source-available, non-commercial only.

You may read the source, fork it, modify it, and run dst for personal / research / non-profit purposes. You may **not** sell dst, host it as a paid service, or use it for any commercial purpose without a separate license from the author.

See [`LICENSE`](./LICENSE) for the full terms and plain-language summary.
