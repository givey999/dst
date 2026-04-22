import { BrowserWindow } from "electron";
import path from "node:path";

export async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: "#0b0b0f",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.resolve(__dirname, "../../preload/dist/index.js"),
    },
  });

  win.once("ready-to-show", () => win.show());

  const rendererEntry = path.resolve(__dirname, "../../renderer/index.html");
  await win.loadFile(rendererEntry);

  return win;
}
