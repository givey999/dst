import { ipcMain, dialog, BrowserWindow } from "electron";
import type { IpcRequest, IpcResponse, VaultStatus } from "@dst/shared";
import type { AppState } from "./AppState.js";

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

        case "vault.upload": {
          if (!app.vault) throw new Error("vault not ready");
          const handle = app.vault.upload(req.localPath);
          const forward = (p: unknown): void => {
            evt.sender.send("dst:progress.upload", p);
          };
          handle.events.on("progress", forward);
          try {
            const entry = await handle.done;
            await app.vault.flush();
            return ok(entry);
          } finally {
            handle.events.off("progress", forward);
          }
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

        case "vault.delete":
          if (!app.vault) throw new Error("vault not ready");
          await app.vault.delete(req.fileId);
          await app.vault.flush();
          return ok(null);

        case "vault.changePassphrase": {
          if (!app.vault) throw new Error("vault not ready");
          await app.vault.changePassphrase(req.oldP, req.newP);
          return ok(null);
        }

        case "vault.garbageCollect":
          // Stub until Task 17
          return ok({ orphans: 0, reclaimedBytes: 0 });

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
}

function ok<T>(data: T): IpcResponse<T> {
  return { ok: true, data };
}
