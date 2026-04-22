export async function rpc(req) {
  const res = await window.dst.rpc(req);
  if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
  return res.data;
}

export const onUploadProgress = window.dst.onUploadProgress;
export const onDownloadProgress = window.dst.onDownloadProgress;
export const showSaveDialog = window.dst.showSaveDialog;
export const showOpenDialog = window.dst.showOpenDialog;
