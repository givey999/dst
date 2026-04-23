import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { IpcRequest, IpcResponse } from "@dst/shared";

const api = {
  rpc: async <T>(req: IpcRequest): Promise<IpcResponse<T>> =>
    ipcRenderer.invoke("dst:rpc", req) as Promise<IpcResponse<T>>,

  onUploadProgress: (cb: (p: unknown) => void): (() => void) => {
    const listener = (_: unknown, p: unknown): void => cb(p);
    ipcRenderer.on("dst:progress.upload", listener);
    return (): void => { ipcRenderer.removeListener("dst:progress.upload", listener); };
  },

  onDownloadProgress: (cb: (p: unknown) => void): (() => void) => {
    const listener = (_: unknown, p: unknown): void => cb(p);
    ipcRenderer.on("dst:progress.download", listener);
    return (): void => { ipcRenderer.removeListener("dst:progress.download", listener); };
  },

  showSaveDialog: (suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke("dst:showSaveDialog", suggestedName) as Promise<string | null>,

  showOpenDialog: (): Promise<string | null> =>
    ipcRenderer.invoke("dst:showOpenDialog") as Promise<string | null>,

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("dst:openExternal", url) as Promise<void>,

  // Electron 32 deprecated File.path; webUtils.getPathForFile is the replacement.
  // Returns the filesystem path for a File object that came from a drop event.
  getPathForFile: (file: File): string | null => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
};

contextBridge.exposeInMainWorld("dst", api);

declare global {
  interface Window {
    dst: typeof api;
  }
}

export type DstApi = typeof api;
