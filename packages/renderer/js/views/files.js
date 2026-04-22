import { rpc, showSaveDialog, showOpenDialog } from "../ipc.js";

export async function files(root) {
  root.innerHTML = `
    <div class="files">
      <div class="files-toolbar">
        <input type="search" placeholder="search…" data-search />
        <button class="primary" data-upload>Upload</button>
      </div>
      <div class="files-list" data-list></div>
    </div>
  `;

  let allFiles = await rpc({ type: "vault.list" });
  let filter = "";

  const list = root.querySelector("[data-list]");
  const searchInput = root.querySelector("[data-search]");

  function render() {
    const filtered = allFiles.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase()));
    if (filtered.length === 0) {
      list.innerHTML = `<div class="files-empty">${allFiles.length === 0 ? "no files yet — drop a file here or click Upload" : "no matches"}</div>`;
      return;
    }
    list.innerHTML = filtered.map((f) => `
      <div class="file-row" data-id="${f.id}">
        <div class="file-name">${escapeHtml(f.name)}</div>
        <div class="file-size">${humanSize(f.size)}</div>
        <div class="file-date">${humanDate(f.createdAt)}</div>
        <div class="file-actions">
          <button class="file-action-btn" data-download>download</button>
          <button class="file-action-btn danger" data-delete>delete</button>
        </div>
      </div>
    `).join("");
  }

  render();

  searchInput.addEventListener("input", (e) => {
    filter = e.target.value;
    render();
  });

  root.querySelector("[data-upload]").addEventListener("click", async () => {
    const localPath = await showOpenDialog();
    if (localPath) await doUpload(localPath);
  });

  root.addEventListener("click", async (e) => {
    const row = e.target.closest(".file-row");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.matches("[data-download]")) {
      const file = allFiles.find((f) => f.id === id);
      if (!file) return;
      const dest = await showSaveDialog(file.name);
      if (dest) {
        try {
          await rpc({ type: "vault.download", fileId: id, destPath: dest });
        } catch (ex) {
          alert(`download failed: ${ex.message}`);
        }
      }
    } else if (e.target.matches("[data-delete]")) {
      const name = row.querySelector(".file-name").textContent;
      if (!confirm(`Delete "${name}"?`)) return;
      try {
        await rpc({ type: "vault.delete", fileId: id });
        allFiles = await rpc({ type: "vault.list" });
        render();
      } catch (ex) {
        alert(`delete failed: ${ex.message}`);
      }
    }
  });

  // Drag-and-drop
  let overlay = null;
  const setOverlay = (on) => {
    if (on && !overlay) {
      overlay = document.createElement("div");
      overlay.className = "drop-overlay";
      overlay.textContent = "drop to upload";
      root.appendChild(overlay);
    } else if (!on && overlay) {
      overlay.remove();
      overlay = null;
    }
  };

  root.addEventListener("dragenter", (e) => { e.preventDefault(); setOverlay(true); });
  root.addEventListener("dragover", (e) => e.preventDefault());
  root.addEventListener("dragleave", (e) => {
    // Only remove overlay when leaving the root element, not its children
    if (!root.contains(e.relatedTarget)) setOverlay(false);
  });
  root.addEventListener("drop", async (e) => {
    e.preventDefault();
    setOverlay(false);
    for (const file of e.dataTransfer.files) {
      if (file.path) await doUpload(file.path);
    }
  });

  async function doUpload(localPath) {
    try {
      await rpc({ type: "vault.upload", localPath });
      allFiles = await rpc({ type: "vault.list" });
      render();
    } catch (ex) {
      alert(`upload failed: ${ex.message}`);
    }
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function humanSize(n) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function humanDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 30 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}
