# dst manual test checklist

Run this before tagging any release. Requires a throwaway Discord bot and a throwaway server.

## Setup

- Create a bot at https://discord.com/developers/applications. Copy the token.
- Keep the token in a safe place — you'll need to paste it into the wizard.

## 1. Fresh install

- [ ] Run `pnpm package` (Windows Developer Mode must be ON — see README).
- [ ] Install `release/dst Setup 0.2.0.exe` to a scratch directory (or run the portable `dst 0.2.0.exe`).
- [ ] Launch dst. Wizard appears at step 1 ("Welcome to dst").

## 2. Wizard

- [ ] Click "Get started" → step 2.
- [ ] Click "Open Developer Portal" — your default browser opens the Discord dev portal (NOT a window inside dst).
- [ ] Paste bot token → within 1 second, green "✓ connected as <bot>" appears.
- [ ] Click "Continue" → step 3.
- [ ] Click "Open Discord" → Discord app or web opens in your default browser.
- [ ] Create a new server manually. Any name.
- [ ] Click "Invite bot to server". OAuth page opens in your default browser. Pick the new server. Authorize.
- [ ] Within 2 seconds: "found <server> — setting up channels…" appears, then advances to step 4.
- [ ] Enter 12+ char passphrase, confirm, check the "I've saved it" box.
- [ ] Click "Create vault". Advances to step 5.
- [ ] Click "Start using dst". Drops into the empty Files view.

## 3. Small upload / download

- [ ] Drop a 1 KB text file onto the window.
- [ ] Toast appears: `Uploaded "name"`. File appears in the list with a 📄 icon.
- [ ] Click "download" on the row, save to a scratch dir. Row briefly shows a spinner while downloading.
- [ ] Toast appears: `Downloaded "name"`.
- [ ] Compare (`fc /b` on Windows cmd) against the original — should be identical.

## 4. Multi-chunk upload

- [ ] Drop a 12 MB file (any binary — e.g., a photo).
- [ ] Watch the Uploads view show progress.
- [ ] The Files view shows a 🖼️ / 🎬 / etc. icon based on the extension.
- [ ] Download, diff → match.

## 5. Folders

- [ ] Click the "+ folder" button → an inline input appears in the toolbar.
- [ ] Type `photos` → press Enter. Breadcrumb shows `root / photos`. Empty folder view.
- [ ] Drop a file while in `photos`. It uploads with the folder prefix.
- [ ] Click `root` in the breadcrumb. You see a `📁 photos` row.
- [ ] Click the `📁 photos` row → navigates back in. File is still there.
- [ ] Go back to root. Click the `delete` button on the folder row → confirm dialog shows file count.
- [ ] Confirm → folder and its files are deleted. Toast says "Deleted folder photos".

## 6. Empty folders persist

- [ ] Create an empty folder called `notes` (click "+ folder", type, Enter).
- [ ] Close and relaunch dst, unlock.
- [ ] The `notes` folder still appears in root even though it has no files.

## 7. Rename

- [ ] Click a file's `rename` button. The name becomes an editable input with the filename stem selected (before the extension).
- [ ] Type a new name → Enter. Toast says "Renamed to ...".
- [ ] Escape cancels; clicking elsewhere also cancels.

## 8. Preview

- [ ] For an image file: click `preview` → it opens in your default image viewer.
- [ ] For a PDF: opens in default PDF viewer.
- [ ] For a video: opens in default player.
- [ ] For a text file: opens in Notepad / VS Code / whatever you have associated.
- [ ] Row briefly shows a spinner while the file downloads.
- [ ] Close dst → temp preview files in `%TEMP%\dst-*` are removed on quit.

## 9. Large upload (optional)

- [ ] Create a 500 MB file: `fsutil file createnew large.bin 524288000`
- [ ] Drop it. Should complete without error (may take 1-5 minutes depending on your connection).
- [ ] Download, diff → match.

## 10. Restart persistence

- [ ] Close the app fully.
- [ ] Relaunch. Unlock screen appears (not wizard).
- [ ] Enter passphrase. Files list identical to before, folders identical, everything.

## 11. Change passphrase

- [ ] Settings → enter old + new + confirm.
- [ ] "changed." appears in green.
- [ ] Click lock (top right). Confirm dialog (custom, dark) asks to confirm.
- [ ] Unlock with NEW passphrase → succeeds.
- [ ] Lock again. Try OLD passphrase → "wrong passphrase".
- [ ] Download a pre-existing file → still works (proves chunks aren't re-encrypted).

## 12. Delete + garbage collect

- [ ] Delete a file from the list → custom confirm dialog → row disappears with a toast.
- [ ] Settings → Advanced → "Run garbage collect" → alert shows orphans count (usually 0 right after a clean delete).

## 13. Settings navigation

- [ ] Click the ⚙ button → Settings view opens.
- [ ] Click ⚙ again → toggles back to Files view.
- [ ] Click ⚙ while on wizard/unlock → nothing happens (gate states).

## 14. Uninstall + reinstall (same machine)

- [ ] Uninstall via Windows Settings.
- [ ] Reinstall. Launch. Wizard appears.
- [ ] Paste SAME bot token → green check.
- [ ] Click Continue. Wizard auto-detects the existing vault server.
- [ ] Enter existing passphrase → "Unlock" — files and folders reappear.

## 15. Second-machine portability

- [ ] Copy `dst-0.2.0.exe` (portable) or installer to another PC.
- [ ] Install, launch. Wizard.
- [ ] Paste SAME bot token + SAME passphrase. All files (including folder structure) appear.

## 16. Lock safety

- [ ] Unlock vault.
- [ ] Drop a file, let upload finish.
- [ ] Click lock → confirm dialog → Lock. Files list disappears (unlock screen appears).
- [ ] Enter wrong passphrase → "wrong passphrase" error.
- [ ] Enter correct → files reappear.

## Known v0.2 limitations

- Windows SmartScreen warns on the unsigned installer. Click "More info" → "Run anyway".
- Preview writes the decrypted file to `%TEMP%` briefly while the OS app opens it. Cleaned up on dst quit.
- Upload/download can't be resumed across app restart (in-memory only).
- Paused/cancelled uploads leave orphan chunks — use "Run garbage collect" to clean up.
- No auto-lock after idle. Remember to click lock when you step away if the threat model cares.
- Preview downloads the full file before opening it (no streaming). A 500 MB video takes a while.
