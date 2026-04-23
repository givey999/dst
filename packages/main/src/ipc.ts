import { ipcMain, dialog, BrowserWindow, app as electronApp, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { IpcRequest, IpcResponse, VaultStatus } from "@dst/shared";
import type { AppState } from "./AppState.js";

// Track temp files created for preview so we can delete them on quit.
const previewTempFiles: string[] = [];

// Recursively list every file path under dir, absolute.
async function walkDirectory(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkDirectory(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

electronApp.on("will-quit", async () => {
  await Promise.all(
    previewTempFiles.map((p) => fs.unlink(p).catch(() => void 0)),
  );
});

export function registerIpc(app: AppState): void {
  ipcMain.handle("dst:rpc", async (evt, req: IpcRequest): Promise<IpcResponse> => {
    try {
      switch (req.type) {
        case "onboarding.getState": {
          const hasHeader = app.indexChannelId ? Boolean(await app.fetchVaultHeader()) : false;
          return ok({
            step: app.guildId ? 4 : app.discord.isLoggedIn() ? 3 : 1,
            botTokenValid: app.discord.isLoggedIn(),
            botUser: null,
            guildId: app.guildId,
            guildName: app.guildName,
            hasExistingVault: hasHeader,
          });
        }

        case "onboarding.validateToken": {
          await app.discord.logout().catch(() => void 0);
          const user = await app.discord.login(req.token);
          await app.storeToken(req.token);
          return ok(user);
        }

        case "onboarding.startGuildPoll":
          return ok(null);

        case "onboarding.stopGuildPoll":
          return ok(null);

        case "onboarding.createVault": {
          if (!app.vault) throw new Error("vault not initialized (pick a guild first)");
          if (!app.indexChannelId) throw new Error("no index channel");
          const { header, vaultKey } = await app.crypto.createVault(req.passphrase);
          const { IndexService } = await import("./services/IndexService.js");
          const tmpIndex = new IndexService({
            crypto: app.crypto,
            discord: app.discord,
            indexChannelId: app.indexChannelId,
          });
          await tmpIndex.createNew({ header, vaultKey });
          return ok(null);
        }

        case "vault.unlock": {
          if (!app.vault) throw new Error("vault not ready");
          const header = await app.fetchVaultHeader();
          if (!header) throw new Error("no vault header");
          await app.vault.unlock(req.passphrase, header);
          return ok(null);
        }

        case "vault.lock":
          app.vault?.lock();
          return ok(null);

        case "vault.status": {
          const s: VaultStatus = {
            unlocked: Boolean(app.vault?.isUnlocked()),
            guildId: app.guildId,
            guildName: app.guildName,
            premiumTier: null,
            chunkSize: app.chunkSize,
          };
          return ok(s);
        }

        case "vault.list":
          if (!app.vault) throw new Error("vault not ready");
          return ok(app.vault.list());

        case "vault.listFolders":
          if (!app.vault) throw new Error("vault not ready");
          return ok(app.vault.listFolders());

        case "vault.createFolder":
          if (!app.vault) throw new Error("vault not ready");
          await app.vault.createFolder(req.path);
          await app.vault.flush();
          return ok(null);

        case "vault.deleteFolder":
          if (!app.vault) throw new Error("vault not ready");
          await app.vault.deleteFolder(req.path);
          await app.vault.flush();
          return ok(null);

        case "vault.upload": {
          if (!app.vault) throw new Error("vault not ready");
          const stat = await fs.stat(req.localPath);

          const forward = (p: unknown): void => {
            evt.sender.send("dst:progress.upload", p);
          };

          if (stat.isFile()) {
            const handle = app.vault.upload(req.localPath, req.folderPrefix);
            handle.events.on("progress", forward);
            try {
              const entry = await handle.done;
              await app.vault.flush();
              return ok({ entries: [entry] });
            } finally {
              handle.events.off("progress", forward);
            }
          }

          if (stat.isDirectory()) {
            // Dropped a folder — walk it and upload each file, preserving the
            // relative folder structure as an in-vault path prefix.
            const rootName = path.basename(req.localPath);
            const files = await walkDirectory(req.localPath);
            const entries = [];
            for (const filePath of files) {
              const rel = path.relative(req.localPath, filePath);
              const relDir = path.dirname(rel).replace(/\\/g, "/");
              const parts = [
                req.folderPrefix ?? "",
                rootName,
                relDir === "." ? "" : relDir,
              ].filter((s) => s.length > 0);
              const prefix = parts.join("/");

              const handle = app.vault.upload(filePath, prefix);
              handle.events.on("progress", forward);
              try {
                const entry = await handle.done;
                entries.push(entry);
              } finally {
                handle.events.off("progress", forward);
              }
            }
            await app.vault.flush();
            return ok({ entries });
          }

          throw new Error(`${req.localPath} is neither a file nor a directory`);
        }

        case "vault.download": {
          if (!app.vault) throw new Error("vault not ready");
          const handle = app.vault.download(req.fileId, req.destPath);
          const forward = (p: unknown): void => {
            evt.sender.send("dst:progress.download", p);
          };
          handle.events.on("progress", forward);
          try {
            await handle.done;
            return ok(null);
          } finally {
            handle.events.off("progress", forward);
          }
        }

        case "vault.preview": {
          if (!app.vault) throw new Error("vault not ready");
          const file = app.vault.list().find((f) => f.id === req.fileId);
          if (!file) throw new Error("file not found");

          // Preserve the extension so the OS picks the right default app.
          // Strip any path separators from the filename for a safe temp name.
          const baseName = file.name.split(/[\\/]/).pop() ?? "preview";
          const safeName = baseName.replace(/[<>:"|?*\x00-\x1f]/g, "_");
          const tempDir = electronApp.getPath("temp");
          const tempPath = path.join(tempDir, `dst-${randomUUID()}-${safeName}`);

          const handle = app.vault.download(req.fileId, tempPath);
          const forward = (p: unknown): void => {
            evt.sender.send("dst:progress.download", p);
          };
          handle.events.on("progress", forward);
          try {
            await handle.done;
          } finally {
            handle.events.off("progress", forward);
          }

          previewTempFiles.push(tempPath);

          const openErr = await shell.openPath(tempPath);
          if (openErr) throw new Error(`open failed: ${openErr}`);
          return ok(null);
        }

        case "vault.delete":
          if (!app.vault) throw new Error("vault not ready");
          await app.vault.delete(req.fileId);
          await app.vault.flush();
          return ok(null);

        case "vault.rename":
          if (!app.vault) throw new Error("vault not ready");
          await app.vault.rename(req.fileId, req.newName);
          await app.vault.flush();
          return ok(null);

        case "vault.changePassphrase": {
          if (!app.vault) throw new Error("vault not ready");
          await app.vault.changePassphrase(req.oldP, req.newP);
          return ok(null);
        }

        case "vault.garbageCollect":
          if (!app.vault) throw new Error("vault not ready");
          return ok(await app.vault.garbageCollect());

        case "setup.listBotGuilds":
          return ok(await app.discord.listGuilds());

        case "setup.initBotAndGuild":
          await app.initAfterGuildPicked(req.guildId);
          return ok(null);

        case "setup.checkVaultExists": {
          const header = await app.fetchVaultHeader();
          return ok({ exists: Boolean(header) });
        }
      }
    } catch (e) {
      const err = e as Error;
      return { ok: false, error: { code: "internal", message: err.message } };
    }
  });

  ipcMain.handle("dst:showSaveDialog", async (_evt, suggestedName: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const res = await dialog.showSaveDialog(win, { defaultPath: suggestedName });
    return res.canceled ? null : res.filePath;
  });

  ipcMain.handle("dst:showOpenDialog", async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, { properties: ["openFile"] });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle("dst:openExternal", async (_evt, url: string) => {
    // Hard-restrict to http(s) and discord:// so we never shell.openExternal
    // an arbitrary string from the renderer (e.g. file://, javascript:, etc.).
    if (!/^(https?:|discord:)/.test(url)) {
      throw new Error(`refusing to open non-http/discord url: ${url}`);
    }
    await shell.openExternal(url);
    return null;
  });
}

function ok<T>(data: T): IpcResponse<T> {
  return { ok: true, data };
}
