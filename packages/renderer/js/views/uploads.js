import { onUploadProgress, onDownloadProgress } from "../ipc.js";

// Module-level state: we track every upload/download from the moment the app starts,
// not just while the view is open. Installed once via installGlobalProgressListeners().
const ACTIVE = new Map();
let installed = false;

export function installGlobalProgressListeners() {
  if (installed) return;
  installed = true;

  onUploadProgress((p) => {
    ACTIVE.set(p.uploadId, { kind: "upload", ...p });
    document.dispatchEvent(new CustomEvent("dst:progress"));
  });
  onDownloadProgress((p) => {
    ACTIVE.set(p.downloadId, { kind: "download", ...p });
    document.dispatchEvent(new CustomEvent("dst:progress"));
  });
}

export async function uploads(root) {
  root.innerHTML = `<div class="uploads" data-list></div>`;
  const list = root.querySelector("[data-list]");

  function render() {
    const rows = [...ACTIVE.values()].sort((a, b) => {
      // Active first, then done/error
      const aDone = a.state === "done" || a.state === "error";
      const bDone = b.state === "done" || b.state === "error";
      if (aDone !== bDone) return aDone ? 1 : -1;
      return 0;
    });
    if (rows.length === 0) {
      list.innerHTML = `<div class="files-empty">no activity</div>`;
      return;
    }
    list.innerHTML = rows.map(rowHtml).join("");
  }

  render();
  const onProgress = () => render();
  document.addEventListener("dst:progress", onProgress);

  // Clean up when the view is replaced (router clears innerHTML).
  // We use MutationObserver on the parent since the router removes the whole root.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      document.removeEventListener("dst:progress", onProgress);
      observer.disconnect();
    }
  });
  observer.observe(root.parentNode || document.body, { childList: true, subtree: false });
}

function rowHtml(r) {
  const bytes = r.bytesUploaded ?? r.bytesDownloaded ?? 0;
  const pct = r.total > 0 ? Math.min(100, (bytes * 100) / r.total) : 0;
  const stateClass = r.state === "done" ? "done" : r.state === "error" ? "error" : "";
  const arrow = r.kind === "upload" ? "↑" : "↓";
  const label = r.state === "error" && r.error ? `error: ${escapeHtml(r.error)}` : `${r.state}${r.total ? ` · ${pct.toFixed(0)}%` : ""}`;
  return `
    <div class="upload-row ${stateClass}">
      <div class="upload-top">
        <div class="upload-name">${arrow} ${escapeHtml(r.name ?? "")}</div>
        <div class="upload-state">${label}</div>
      </div>
      <div class="upload-bar"><div class="upload-bar-fill" style="width: ${pct}%"></div></div>
    </div>
  `;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
