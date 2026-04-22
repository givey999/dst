import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("dst", {
  version: "0.1.0",
});
