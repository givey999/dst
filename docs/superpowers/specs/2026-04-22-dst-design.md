# dst — design spec

**Status:** draft v1
**Date:** 2026-04-22
**Author:** givey999
**Working name:** `dst`

> A desktop app that turns a private Discord server into your personal infinite encrypted vault. Drag a file in, it's on Discord. Drag it out, it's on your desk. Reinstall on any PC, your files follow you.

---

## 1. Goals and non-goals

### Goals

- **Infinite free storage** backed by a private Discord server the user controls.
- **Zero-knowledge encryption** by default: Discord sees only ciphertext and opaque index blobs. Filenames, sizes, and metadata are also encrypted.
- **Beginner-friendly first-run**: a non-technical user can go from "downloaded the .exe" to "first file uploaded" in under five minutes, including creating a bot and a storage server.
- **Portable across machines**: install on any PC, paste the bot token, and the same files appear. No local database of record.
- **Single executable**: a Windows `.exe` installer and a portable `.exe` build. No separate services, no localhost setup, no terminal.
- **Minimalist, branded UI**: feels hand-crafted, not "Electron template."

### Non-goals (explicitly out of v1)

- Folders / nested paths. Filenames are flat strings; users can use `/` in names as a visual convention if they want.
- Sharing files with other people, public links, or multi-user vaults.
- Image/video thumbnails or in-app previews.
- Mobile companion app.
- Multiple vaults managed by one install.
- Resumable uploads across app restarts.
- Auto-update.
- Multi-server sharding. One guild, one `#files` channel suffices for v1 — if/when the channel grows unwieldy for history fetches, we can shard across multiple channels later.
- Any persistence of plaintext to local disk.

---

## 2. Architecture

Single Electron process with a main/renderer split.

```
┌─ Renderer (vanilla HTML/CSS/ESM JS) ────────┐
│  • File list, drag-and-drop, progress        │
│  • First-run setup wizard                    │
│  • Settings panel                            │
│  • Unlock screen                             │
└──────────────────▲──IPC──┬────────────────────┘
                   │       │
┌──────────────────┴───────▼────────────────────┐
│  Main process (TypeScript, strict mode)       │
│                                               │
│  ┌─ VaultService (facade) ─────────────────┐  │
│  │  unlock, upload, download, delete, list │  │
│  └──────────────────┬──────────────────────┘  │
│  ┌─ CryptoService ──▼──────────────────────┐  │
│  │  Argon2id KDF + AES-256-GCM stream      │  │
│  └──────────────────┬──────────────────────┘  │
│  ┌─ ChunkerService ─▼──────────────────────┐  │
│  │  stream splitter / reorder buffer       │  │
│  └──────────────────┬──────────────────────┘  │
│  ┌─ DiscordClient ──▼──────────────────────┐  │
│  │  discord.js v14 wrapper, rate limits,   │  │
│  │  URL re-resolution, retries             │  │
│  └──────────────────┬──────────────────────┘  │
│  ┌─ IndexService ───▼──────────────────────┐  │
│  │  encrypted index load/save over Discord │  │
│  └─────────────────────────────────────────┘  │
└───────────────────────────────────────────────┘
```

**Design principle:** each service has a narrow, testable interface. `VaultService` is the only surface the renderer talks to via IPC. The others are implementation details of the main process and are substitutable with fakes in tests.

**Local persistence surface (deliberately tiny):**

- Bot token — encrypted at rest in the OS keychain via `keytar`.
- Vault guild ID (a single UUID-sized pointer).
- Vault channel IDs (`#files`, `#index`).

Everything else — file list, chunk map, filenames — lives encrypted on Discord and is fetched on unlock.

---

## 3. Components

### 3.1 `VaultService`

The façade exposed over IPC. All other services are instantiated by it.

```ts
interface VaultService {
  unlock(passphrase: string): Promise<void>;   // derives key, fetches index, verifies
  lock(): void;                                 // zeroes key, clears in-memory index
  list(): FileEntry[];                          // pure in-memory read
  upload(localPath: string): UploadHandle;      // returns handle with progress events
  download(id: string, destPath: string): DownloadHandle;
  delete(id: string): Promise<void>;
  changePassphrase(oldP: string, newP: string): Promise<void>;
  garbageCollect(): Promise<{ orphans: number; reclaimedBytes: number }>;
}
```

### 3.2 `CryptoService`

**Key hierarchy (wrapping-key pattern, as used by LUKS / BitLocker):**

- `masterKey` = Argon2id(passphrase, salt), 32 bytes. Parameters: `memoryCost=64 MiB, timeCost=3, parallelism=1`. Changes on passphrase change. Never persisted.
- `vaultKey` = 32 random bytes, generated once at vault init, **never changes for the lifetime of the vault**. Used to derive per-chunk keys.
- `wrappedVaultKey` = AES-256-GCM(masterKey, vaultKey). Stored in the index header. On passphrase change, we re-wrap with a new masterKey — the vaultKey itself stays the same, which is why passphrase changes don't require re-uploading chunks.
- `chunkKey(fileId, seq)` = HKDF-SHA-256(vaultKey, salt = fileId ‖ seq, info = "dst/chunk/v1"), 32 bytes. Derived on the fly at encrypt and decrypt time; never stored.

**Cipher:** AES-256-GCM via Node's `crypto.createCipheriv`. Per-chunk 12-byte random nonce, 16-byte auth tag appended. Authenticated data for each chunk is `{ fileId, seq, totalChunks, chunkHeader }` — binds a chunk to its file and position so ciphertext can't be spliced across files or reordered.

**Salt / verification storage:** the index message payload begins with an 84-byte plaintext header: `{ magic: 6B ("dstvlt"), version: 1B, reserved: 1B, argonSalt: 16B, wrappedVaultKeyNonce: 12B, wrappedVaultKeyCiphertext: 48B (32B key + 16B tag) }`. The rest of the payload is the encrypted JSON index (12B nonce ‖ ciphertext ‖ 16B tag).

**Verification on unlock:**

1. Read plaintext header, derive masterKey from passphrase + argonSalt.
2. Try to decrypt `wrappedVaultKeyCiphertext` with masterKey. If auth tag fails → wrong passphrase; abort.
3. On success, the unwrapped vaultKey decrypts the rest of the index.

**Streaming:** implemented as Node `Transform` streams so a 10 GB file never fully lands in RAM.

### 3.3 `ChunkerService`

- Splits a `Readable` into fixed-size chunks (default 9 MB — see §5 for dynamic sizing).
- Each chunk is prefixed with a 16-byte header: `{ magic: 4B, version: 1B, seq: 4B, totalChunks: 4B, reserved: 3B }`. The header is part of the AES-GCM authenticated data, not encrypted itself — lets us validate ordering without decrypting.
- Reassembly: maintains a small reorder buffer (max 10 chunks in memory) while writing downloaded chunks to the destination file in order.
- Edge cases unit-tested: zero-byte file, one-byte file, exactly one chunk, one-byte-over-one-chunk, file larger than RAM.

### 3.4 `DiscordClient`

Thin TypeScript wrapper around `discord.js` v14.

Responsibilities:

- Login and session management.
- Upload a buffer to a channel as an attachment, return `{ messageId, seq }`.
- Fetch a message by ID and re-resolve the current signed CDN URL. **Critical:** we never cache CDN URLs — Discord's signed URLs expire in ~24 hours. We store only `messageId` in the index and re-fetch on every download.
- Bulk-delete messages by ID (uses `bulkDelete` for messages <14 days old, falls back to individual deletes otherwise).
- Exponential backoff with jitter on 429 rate limits, on top of discord.js's built-in queue.
- Surfaces `"rate-limited"` events to the UI when backoff exceeds 3 s.

**Concurrency discipline:**

- 3 concurrent chunk uploads per channel (Discord's per-channel message rate is ~5 per 5 s; 3 gives headroom).
- Global cap of 10 simultaneous in-flight Discord requests across the whole app.

### 3.5 `IndexService`

The index is a single encrypted JSON blob uploaded as one `.bin` attachment to a pinned message in `#index`.

**Index schema (pre-encryption):**

```ts
interface VaultIndex {
  version: 1;
  createdAt: string;          // ISO
  updatedAt: string;
  revision: number;           // monotonic; incremented on each save
  files: FileEntry[];
  folders?: string[];         // explicit empty-folder paths (added v0.2)
}

interface FileEntry {
  id: string;                 // uuid v4
  name: string;               // user-visible filename (may contain / for folders)
  size: number;               // plaintext bytes
  mime: string;               // sniffed at upload time
  createdAt: string;
  chunks: ChunkRef[];
  chunkSize?: number;
}

interface ChunkRef {
  messageId: string;          // Discord message holding the attachment
  seq: number;                // 0-indexed
  ciphertextSize: number;     // for integrity check
}
```

**Save flow:**

1. Serialize to JSON, encrypt with the vault key.
2. Upload as a new message to `#index` (not pinned — see rationale below).
3. Delete the bot's own older messages in `#index` as best-effort cleanup. Bots can always delete their own messages without `MANAGE_MESSAGES`, so this works in channels where we don't have that permission.
4. Update the local in-memory `currentIndexMessageId` pointer.

**Load flow:**

1. Fetch the most recent message with an attachment in `#index`.
2. Download its attachment, decrypt, parse.
3. If decrypt fails: passphrase is wrong (or vault is corrupted — rare; we surface a recovery dialog).

**Why not pins?** The original design used pinned messages as the canonical-current-index pointer. Discord's pin API has been unreliable for bots in 2024/2025 — it returns `Missing Permissions [50013]` even when the bot provably has `MANAGE_MESSAGES` on the channel. We pivoted to "most recent message is the current index," which requires no special permissions and works around whatever Discord is doing to the pin endpoint. The tradeoff: if a human manually posts in `#index`, the app would briefly see that as the current index and fail to decrypt. We document that the `#index` channel is for the app only.

**Concurrent edit protection:** the `revision` counter is checked on save — if the remote index's `revision` is higher than ours, we abort with a "vault modified elsewhere — reload?" dialog. For a personal single-user tool this is rare; we don't attempt automatic merge.

---

## 4. Data flow

### 4.1 Upload (example: `dst.mp4`, 127 MB)

1. User drags file onto window.
2. Renderer sends `{ localPath }` IPC → main's `VaultService.upload()`.
3. `VaultService` returns an `UploadHandle` with an `EventEmitter` for progress, cancel, and done events. Renderer subscribes.
4. Main opens a read stream from disk.
5. Stream pipes: `fs.createReadStream` → `CryptoService.encryptStream` → `ChunkerService.split(9 MB)` → a pool of 3 concurrent `DiscordClient.uploadChunk` tasks.
6. Each `uploadChunk` returns `{ messageId, seq, ciphertextSize }`; results collected in a `Map<seq, ChunkRef>`.
7. When all chunks resolve, `IndexService.addFile({ name, size, mime, chunks })` updates the in-memory index.
8. A debounced 2-second timer fires `IndexService.save()` to Discord. (Debounce coalesces a burst of uploads into one index write.)
9. Progress events fire every 128 KB of source read: `{ bytesUploaded, total, chunksComplete, chunksTotal }`.

### 4.2 Download

1. Renderer sends `{ id, destPath }`.
2. `IndexService` looks up `FileEntry`.
3. For each chunk in `chunks` array: `DiscordClient.resolveUrl(messageId)` → `fetch(cdnUrl)` → `CryptoService.decryptStream` → reorder buffer → `fs.createWriteStream(destPath)`.
4. Chunks download 3 at a time; the reorder buffer holds out-of-order chunks until their seq is writable.
5. On auth-tag failure at any chunk: abort, show "File is corrupted or tampered with" — don't attempt partial recovery.

### 4.3 Delete

1. `DiscordClient.bulkDelete(file.chunks.map(c => c.messageId))`.
2. `IndexService.removeFile(id)`.
3. Debounced index save.

### 4.4 List

Pure in-memory read from the decrypted index. No I/O. Fast.

### 4.5 Change passphrase

1. Verify old passphrase by unwrapping the current `wrappedVaultKey` with the old-passphrase-derived masterKey.
2. Generate a new Argon2id salt; derive newMasterKey from new passphrase + new salt.
3. Re-wrap the **same** `vaultKey` with newMasterKey → new `wrappedVaultKey`.
4. Re-encrypt the index JSON with the vaultKey (same key as before, but the ciphertext is freshly generated with a new nonce — keeps it clean).
5. Upload as a new pinned index message. Unpin the old one.

**Why this is fast:** chunk keys are derived from the unchanged `vaultKey`, so individual file chunks remain decryptable after a passphrase change without re-uploading a single byte. Only the 64-byte header + index JSON are rewritten.

---

## 5. Dynamic chunk sizing

Discord attachment limits depend on the **guild's boost tier**, not the user's Nitro. On unlock:

- Call `guild.fetch()` and read `premiumTier`.
- Set chunk size:
  - Tier 0 (unboosted): **9 MB** (headroom under the 10 MB cap)
  - Tier 2 (7 boosts): **49 MB**
  - Tier 3 (14 boosts): **99 MB**

Chunk size is recorded per-file in the index, so files uploaded at tier 0 remain readable after a boost, and vice versa.

---

## 6. Error handling

| Scenario | Behavior |
|---|---|
| Wrong passphrase on unlock | "Wrong passphrase" error; no Discord call is made. |
| Bot token invalid or revoked | Setup wizard re-appears, token step highlighted. |
| Bot was kicked from server | Setup wizard at invite step; existing index remains recoverable once bot is re-added. |
| Mid-upload crash / kill | Orphan chunks remain in `#files` but unreferenced. User can trigger **Settings → Advanced → Garbage collect** to scan `#files` and delete un-indexed messages. Never auto-run. |
| 429 rate limit | discord.js queue + jittered backoff; after 3 consecutive 429s, UI shows "Slowing down…" status. |
| Offline | Queue uploads in-memory; show "N uploads queued — waiting for connection." Do NOT persist queue to disk (plaintext would break encryption contract). Warn on app close if queue is non-empty. |
| Corrupted chunk (auth tag mismatch) | Abort download, show "File corrupted or tampered." Don't attempt partial recovery. |
| Index decrypt fails on unlock | Two possibilities: wrong passphrase (common) or corrupted index (rare). Offer "Try recovery" which falls back to scanning prior pinned messages in `#index` and asking user to pick one. |
| Concurrent edit (two PCs) | Index `revision` check detects it; show "Vault modified on another machine — reload?" dialog. |

---

## 7. First-run onboarding wizard

**The most important UX surface in the app.** Five steps, progress dots at bottom, Back button on every step except the last.

### Step 1 — Welcome

One paragraph explaining what dst does and that it uses Discord as storage. One button: **"Get started"**.

### Step 2 — Create your bot

Inline GIF or short video showing the Discord Developer Portal flow:

1. Click "New Application", name it anything.
2. Go to the "Bot" tab, click "Add Bot".
3. Copy the token.

Buttons:
- **"Open Developer Portal"** (opens `https://discord.com/developers/applications` in default browser)
- Paste field for the bot token. On paste, app calls `GET https://discord.com/api/v10/users/@me` with the token; a green check appears on success, red X + error message on failure.
- **"Continue"** enables once token validates.

### Step 3 — Create your vault server

Two sub-steps in sequence:

**3a — Create the server:**

> "You need a private Discord server to hold your files. Create one now."

- Button: **"Open Discord"** (tries `discord://` protocol handler, falls back to `https://discord.com/app`).
- Instructions card: *"Click the + icon in your Discord sidebar → 'Create My Own' → 'For me and my friends' → give it any name (e.g., 'my dst'). Come back here when done."*
- Button: **"I created it — continue"**.

**3b — Invite your bot:**

- Button: **"Invite bot to your server"** (opens `https://discord.com/oauth2/authorize?client_id=<APP_ID>&permissions=109584&scope=bot` — permissions integer 109584 = View Channels (1024) + Send Messages (2048) + Manage Messages (8192) + Attach Files (32768) + Read Message History (65536) + Manage Channels (16)).
- User picks their new server from Discord's dropdown, clicks Authorize.
- Meanwhile the app polls `GET /users/@me/guilds` on the bot every 2 s.
- The moment the bot appears in a new guild (and only one new guild since last poll), app auto-detects it.
- App creates `#files` and `#index` channels via `POST /guilds/{id}/channels`.
- Advance to step 4. Show a subtle success toast.

### Step 4 — Set your passphrase

- Two password fields: passphrase + confirm.
- Strength meter (zxcvbn-lite or a small hand-rolled one: length × entropy guess).
- Big red warning card: **"If you lose this, your files are gone forever. Write it down somewhere safe."**
- Checkbox: *"I've saved my passphrase somewhere safe."* (required to proceed)
- **"Create vault"** button — on click:
  - Derive key with fresh Argon2id salt.
  - Encrypt an empty `VaultIndex` (no files) + verification ciphertext.
  - Upload as first pinned message in `#index`.
  - Advance.

### Step 5 — You're in

- One-sentence confirmation + **"Start using dst"**.
- On click, enters main UI. First time only: a 3-step tooltip chain points at: the upload button, the file list, the settings gear.

### 7.1 Second-machine / reinstall flow

The wizard is smart enough to skip completed steps when a bot token is reused.

After step 2 validates the token, the app queries `GET /users/@me/guilds`:

- **If the bot is in 0 guilds** → continue to step 3 (create server, invite bot).
- **If the bot is in ≥1 guild that contains both a `#files` and an `#index` channel** → this is an existing vault. Skip step 3 entirely. Present step 4 as **"Enter your existing passphrase"** (with no strength meter, no "I've saved it" checkbox). On submit, unwrap the vault.
- **If the bot is in a guild but channels are missing** → surface a recovery dialog offering to recreate missing channels or pick a different guild.

This is what makes "install on any PC" work end-to-end: same token + same passphrase = same vault.

---

## 8. Main UI

### 8.1 Layout

Single window, ~900×600 default, resizable, min 600×400.

```
┌──────────────────────────────────────────────────────┐
│  dst                                   🔒   ⚙    │   ← title bar, lock + settings icons
├──────────┬───────────────────────────────────────────┤
│          │  Search _______________              [+]  │   ← search + upload
│  Files   │  ────────────────────────────────────────  │
│  Uploads │  birthday-video.mp4      127 MB   2m ago   │
│  Settings│  taxes-2025.zip           52 MB   1d ago   │
│          │  vacation photos.rar     890 MB   3d ago   │
│          │  …                                         │
└──────────┴───────────────────────────────────────────┘
```

### 8.2 Views

- **Files** — flat list sorted newest-first, configurable to name/size. Clicking a row opens an overlay with Download, Rename, Delete actions. Right-click also offers these.
- **Uploads** — live progress bars for in-flight uploads, with pause and cancel. History of recent uploads.
- **Settings** — passphrase change, chunk size override (for power users), current guild info, bot token re-paste, "Show advanced" (reveals: garbage-collect, export index, disable-encryption toggle).

### 8.3 Interactions

- Entire window is a drop zone. On dragenter, dim UI and show "Drop to upload" overlay.
- Clicking 🔒 locks the vault (zeros key, returns to unlock screen).
- Cmd/Ctrl+F focuses search. Escape clears it.
- Cmd/Ctrl+O opens file picker for upload.

### 8.4 Aesthetic

- Dark theme only in v1. Near-black background (`#0b0b0f`), one accent color from `theme.css`.
- Font: system sans for UI, monospace for sizes and IDs.
- No icon library — 5–8 hand-drawn inline SVG icons (upload, download, delete, settings, lock, search, close, plus). Stroke-based, 1.5 px, rounded caps.
- Subtle hover states (50 ms ease), no bouncy animations. Soft focus rings (accent color, 2 px).
- No gradients except one tasteful radial on the splash behind the logo.

---

## 9. Tech choices

| Layer | Choice | Rationale |
|---|---|---|
| Desktop shell | Electron 30+ | Known stack, fastest ship time, plays to existing expertise |
| Language | TypeScript 5.6+, strict mode, ESM | Standard |
| Discord | `discord.js` v14 | Already used in `@donuttrade`, mature |
| Encryption | `node:crypto` (AES-256-GCM) + `argon2` native | FIPS-grade primitives, native perf |
| Keychain | `keytar` | Cross-platform OS-level credential storage |
| Packaging | `electron-builder` | NSIS installer + portable `.exe` |
| Frontend | Vanilla HTML/CSS/ESM JS | Matches givey.zip philosophy; no framework tax |
| Testing | `vitest` | Fast, ESM-native |
| Linting | `eslint` + `@typescript-eslint` with `strict` preset | Standard |
| Auto-update | `electron-updater` with GitHub Releases | Deferred to v1.1 |

**Not using:**

- SQLite / any local DB. No local persistence of file metadata.
- Any CSS framework.
- Any state management library (`zustand`, `redux`, etc.). Renderer state is small enough for vanilla.
- Any icon library.

---

## 10. Testing strategy

### 10.1 Unit tests (vitest, `packages/main/src/**/*.test.ts`)

- `CryptoService`:
  - Round-trip a stream of exact chunk size, size ± 1, empty, 1 MB, 100 MB.
  - Tamper detection: flip a bit in ciphertext, assert auth tag fails.
  - Cross-file splice: try decrypting a chunk with wrong `fileId` in AAD, assert failure.
  - Passphrase change: re-derive, assert old verification ciphertext fails and new one succeeds.
- `ChunkerService`:
  - Zero-byte file produces zero chunks, handled downstream.
  - Boundary sizes: 9 MB − 1, 9 MB, 9 MB + 1.
  - Reorder buffer: feed chunks out of order, assert reassembled output matches input.
- `IndexService`:
  - Encrypt-decrypt round-trip with a stub `DiscordClient`.
  - Revision conflict detection.

### 10.2 Integration test (gated behind `DST_E2E_TOKEN` env var)

One end-to-end test against a real Discord bot in a real test server:

- Upload a 50 MB random file.
- Restart the vault (lock + unlock with the same passphrase).
- Download, assert byte-identical to source.
- Delete, assert no messages remain in `#files`.

### 10.3 Manual test script (`docs/manual-test.md`)

10-step checklist walking a human through:

1. Fresh install of the `.exe`.
2. First-run wizard completes successfully.
3. Upload a 1 KB file, a 12 MB file, and a 500 MB file.
4. Close the app fully, reopen, unlock, confirm files still appear.
5. Download each and assert content matches.
6. Rename a file in the app, reopen, confirm rename persisted.
7. Change passphrase, relock, unlock with new passphrase.
8. Uninstall the app.
9. Reinstall on the same machine; re-enter bot token + passphrase; confirm files still appear.
10. Install on a different machine with the same token + passphrase; confirm files still appear.

Step 10 is the portability claim's only real test.

---

## 10.4 Discord Terms-of-Service risk

Using Discord as a general-purpose file storage backend sits in a gray area of Discord's Developer Terms and Community Guidelines. Discord has not, historically, enforced action against small-scale personal tools of this kind, but:

- **This is a personal tool, not a product.** No public distribution to strangers, no monetization. If you start handing the `.exe` to thousands of users, you're asking to be noticed.
- **The bot should be well-behaved:** respect rate limits, don't spam channels the user didn't create, don't self-promote, don't message other users.
- **Worst case:** Discord removes your bot application, which kills access to files on that account. Mitigation: back up the **bot token** and **passphrase** (not the files — they're already "backed up" on Discord's side); re-creating a bot and re-pointing it at the existing server restores access.

This is documented in the README and in a dismissible one-time notice on first unlock.

## 11. Security model

**Threat model: what a plausible attacker sees.**

| Attacker | What they see | Mitigation |
|---|---|---|
| Someone who steals your bot token | Every attachment in `#files`, all pinned messages in `#index`, all message metadata (timestamps, sizes). | All payloads are AES-256-GCM with a key they don't have. They see blobs and sizes. |
| Discord staff / subpoena | Same as above, plus server-side metadata. | Same. |
| Someone who steals your laptop | Keytar-stored bot token (if OS is unlocked), the vault guild ID, and **nothing else** — no file cache, no metadata, no passphrase. | To open the vault they still need the passphrase. If the OS is locked, they need the OS password first. |
| Someone who steals your passphrase | Everything. | Only mitigation is the passphrase being strong. Strength meter nags at setup. |

**Explicit non-protections:**

- Timing/sizing attacks: chunk sizes and counts reveal approximate file sizes. Not mitigated in v1 (padding is expensive; single-user threat model doesn't justify it).
- Metadata leakage via Discord rate-limit / audit logs: Discord logs message counts and timestamps. A determined adversary with Discord-side access could infer upload patterns.

---

## 12. Directory layout

```
R:\dst\
├─ .gitignore
├─ package.json                      (pnpm workspace root)
├─ pnpm-workspace.yaml
├─ electron-builder.yml
├─ README.md
├─ CLAUDE.md
├─ docs\
│  ├─ superpowers\specs\             ← this file lives here
│  ├─ manual-test.md
│  └─ threat-model.md
├─ packages\
│  ├─ main\                          (Electron main process)
│  │  ├─ src\
│  │  │  ├─ index.ts                 (entry: create BrowserWindow, register IPC)
│  │  │  ├─ ipc.ts
│  │  │  ├─ services\
│  │  │  │  ├─ VaultService.ts
│  │  │  │  ├─ CryptoService.ts
│  │  │  │  ├─ ChunkerService.ts
│  │  │  │  ├─ DiscordClient.ts
│  │  │  │  └─ IndexService.ts
│  │  │  └─ types.ts
│  │  ├─ tsconfig.json
│  │  └─ package.json
│  ├─ preload\                       (contextBridge surface)
│  │  ├─ src\index.ts
│  │  └─ package.json
│  └─ renderer\                      (vanilla HTML/CSS/JS)
│     ├─ index.html
│     ├─ css\
│     │  ├─ theme.css
│     │  └─ layout.css
│     ├─ js\
│     │  ├─ app.js                   (ESM entry)
│     │  ├─ views\
│     │  │  ├─ wizard.js
│     │  │  ├─ unlock.js
│     │  │  ├─ files.js
│     │  │  ├─ uploads.js
│     │  │  └─ settings.js
│     │  └─ ipc.js                   (thin wrapper over window.dst)
│     └─ assets\
│        ├─ icons\*.svg
│        └─ logo.svg
└─ release\                           (electron-builder output, gitignored)
```

---

## 13. Build and release

- `pnpm dev` — runs Electron in dev with hot-reloaded renderer (via a tiny local file-watcher, not Vite — keeps the "no build step" spirit for the renderer) and tsx-watch for main.
- `pnpm build` — typechecks main/preload, produces dist JS.
- `pnpm package` — electron-builder → `release/dst-setup-x.y.z.exe` (NSIS) and `release/dst-portable-x.y.z.exe`.
- v1.0 target: the NSIS installer is < 120 MB. Portable is whatever electron-builder produces — no hard target.
- GitHub Releases hosts the artifacts. No code signing in v1 (users will see Windows SmartScreen warning on first launch; document this in README).

---

## 14. Open questions (resolved in brainstorming, documented here for traceability)

- Stack: Electron + TS + vanilla frontend + discord.js — **resolved**.
- Auth: bot token, no self-bot — **resolved**.
- Encryption: default on, toggle in Settings — **resolved**.
- Index location: Discord-only (no local DB) — **resolved**.
- Chunk size: dynamic per guild boost tier (9 / 49 / 99 MB) — **resolved**.
- Upload parallelism: 3 per channel — **resolved**.
- Server creation: user creates, bot invited via OAuth (not bot-creates-server) — **resolved**.

---

## 15. Milestones for implementation plan (rough)

Listed here to feed the plan-writing phase, not as commitments:

1. Scaffold Electron + TS + pnpm workspace; hello-world window.
2. `CryptoService` + `ChunkerService` with unit tests.
3. `DiscordClient` + `IndexService` against a test guild.
4. `VaultService` wiring + IPC surface.
5. Unlock + files view + upload/download flows.
6. Setup wizard.
7. Settings panel.
8. Polish pass (animations, empty states, error toasts).
9. Packaging + manual-test pass.
10. v1.0 release.
