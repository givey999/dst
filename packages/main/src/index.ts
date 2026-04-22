import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./window.js";
import { AppState } from "./AppState.js";
import { registerIpc } from "./ipc.js";

app.whenReady().then(async () => {
  const state = new AppState();
  await state.loadBootstrap().catch(() => void 0);
  registerIpc(state);
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
