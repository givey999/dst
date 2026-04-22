# dst manual test checklist

Run this before tagging any release. Requires a throwaway Discord bot and a throwaway server.

## Setup

- Create a bot at https://discord.com/developers/applications. Copy the token.
- Keep the token in a safe place — you'll need to paste it into the wizard.

## 1. Fresh install

- [ ] Run `pnpm package` (Windows Developer Mode must be ON — see README).
- [ ] Install `release/dst Setup 0.1.0.exe` to a scratch directory.
- [ ] Launch dst. Wizard appears at step 1 ("Welcome to dst").

## 2. Wizard

- [ ] Click "Get started" → step 2.
- [ ] Click "Open Developer Portal" — Discord's dev portal opens in a browser.
- [ ] Paste bot token → within 1 second, green "✓ connected as <bot>" appears.
- [ ] Click "Continue" → step 3.
- [ ] Click "Open Discord" → Discord opens (app or web).
- [ ] Create a new server manually. Any name.
- [ ] Click "Invite bot to server". OAuth page opens. Pick the new server. Authorize.
- [ ] Within 2 seconds: "found <server> — setting up channels…" appears, then advances to step 4.
- [ ] Enter 12+ char passphrase, confirm, check the "I've saved it" box.
- [ ] Click "Create vault". Advances to step 5.
- [ ] Click "Start using dst". Drops into the empty Files view.

## 3. Small upload / download

- [ ] Drop a 1 KB text file onto the window. Progress updates briefly, then file appears in the list.
- [ ] Click "download" on the row, save to a scratch dir.
- [ ] Compare (`fc /b` on Windows cmd) against the original — should be identical.

## 4. Multi-chunk upload

- [ ] Drop a 12 MB file (any binary — e.g., a photo).
- [ ] Watch the Uploads view show progress.
- [ ] Download, diff → match.

## 5. Large upload (optional)

- [ ] Create a 500 MB file: `fsutil file createnew large.bin 524288000`
- [ ] Drop it. Should complete without error (may take 1-5 minutes depending on your connection).
- [ ] Download, diff → match.

## 6. Restart persistence

- [ ] Close the app fully.
- [ ] Relaunch. Unlock screen appears (not wizard).
- [ ] Enter passphrase. Files list identical to before.

## 7. Change passphrase

- [ ] Settings → enter old + new + confirm.
- [ ] "changed." appears in green.
- [ ] Click lock (top right).
- [ ] Unlock with NEW passphrase → succeeds.
- [ ] Lock again. Try OLD passphrase → "wrong passphrase".
- [ ] Download a pre-existing file → still works (proves chunks aren't re-encrypted).

## 8. Delete + garbage collect

- [ ] Delete a file from the list → confirmation → row disappears.
- [ ] Settings → Advanced → "Run garbage collect" → alert shows orphans count (usually 0 right after a clean delete).

## 9. Uninstall + reinstall (same machine)

- [ ] Uninstall via Windows Settings.
- [ ] Reinstall. Launch. Wizard appears.
- [ ] Paste SAME bot token → green check.
- [ ] Click Continue. Since the bot is already in the vault server, wizard auto-detects and skips the server-creation step (polling finds the existing guild).
- [ ] Enter existing passphrase → "Unlock" — files reappear.

## 10. Second-machine portability

- [ ] Copy `dst-0.1.0.exe` (portable) or installer to another PC.
- [ ] Install, launch. Wizard.
- [ ] Paste SAME bot token + SAME passphrase. All files appear, all downloadable.

## 11. Lock safety

- [ ] Unlock vault.
- [ ] Drop a file, let upload finish.
- [ ] Click lock. Files list disappears (unlock screen appears).
- [ ] Enter wrong passphrase → "wrong passphrase".
- [ ] Enter correct → files reappear.

## Known v1 limitations

- Windows SmartScreen warns on the unsigned installer. Click "More info" → "Run anyway".
- No folder support — filenames are flat.
- No rename — delete + re-upload instead.
- Upload/download can't be resumed across app restart (in-memory only).
- Paused/cancelled uploads leave orphan chunks — use "Run garbage collect" to clean up.
