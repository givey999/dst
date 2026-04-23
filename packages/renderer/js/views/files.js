import { rpc, showSaveDialog, showOpenDialog } from "../ipc.js";

export async function files(root) {
  root.innerHTML = `
    <div class="files">
      <div class="files-toolbar">
        <input type="search" placeholder="search…" data-search />
        <button data-new-folder title="Create folder">+ folder</button>
        <button class="primary" data-upload>Upload</button>
      </div>
      <div class="files-breadcrumb" data-breadcrumb></div>
      <div class="files-list" data-list></div>
    </div>
  `;

  let allFiles = await rpc({ type: "vault.list" });
  let filter = "";
  let currentFolder = ""; // "" = root. No leading or trailing slash.

  const listEl = root.querySelector("[data-list]");
  const searchInput = root.querySelector("[data-search]");
  const breadcrumbEl = root.querySelector("[data-breadcrumb]");

  function listAtPath(files, prefix) {
    const prefixSlash = prefix === "" ? "" : prefix + "/";
    const folders = new Set();
    const filesOut = [];
    for (const f of files) {
      if (prefixSlash && !f.name.startsWith(prefixSlash)) continue;
      const rest = prefixSlash ? f.name.slice(prefixSlash.length) : f.name;
      const slashIdx = rest.indexOf("/");
      if (slashIdx < 0) {
        filesOut.push({ ...f, displayName: rest });
      } else {
        folders.add(rest.slice(0, slashIdx));
      }
    }
    return {
      folders: [...folders].sort(),
      files: filesOut.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    };
  }

  function renderBreadcrumb() {
    if (currentFolder === "" && !filter) {
      breadcrumbEl.innerHTML = "";
      breadcrumbEl.style.display = "none";
      return;
    }
    breadcrumbEl.style.display = "";
    if (filter) {
      breadcrumbEl.innerHTML = `<span class="crumb-search">search results for "${escapeHtml(filter)}"</span>`;
      return;
    }
    const segments = currentFolder.split("/");
    const parts = [`<span class="crumb" data-goto="">root</span>`];
    let acc = "";
    for (let i = 0; i < segments.length; i++) {
      acc = i === 0 ? segments[0] : acc + "/" + segments[i];
      parts.push(`<span class="crumb-sep">/</span><span class="crumb" data-goto="${escapeHtml(acc)}">${escapeHtml(segments[i])}</span>`);
    }
    breadcrumbEl.innerHTML = parts.join("");
  }

  function render() {
    renderBreadcrumb();

    // When searching, show a flat matching list across ALL folders.
    if (filter) {
      const f = filter.toLowerCase();
      const matches = allFiles.filter((x) => x.name.toLowerCase().includes(f));
      if (matches.length === 0) {
        listEl.innerHTML = `<div class="files-empty">no matches</div>`;
        return;
      }
      listEl.innerHTML = matches.map((x) => fileRowHtml(x, x.name)).join("");
      return;
    }

    const { folders, files: filesHere } = listAtPath(allFiles, currentFolder);

    if (folders.length === 0 && filesHere.length === 0) {
      const hint = currentFolder === ""
        ? "no files yet — drop a file here or click Upload"
        : "empty folder";
      listEl.innerHTML = `<div class="files-empty">${hint}</div>`;
      return;
    }

    const folderRows = folders.map((name) => `
      <div class="file-row folder-row" data-folder="${escapeHtml(name)}">
        <div class="file-name">📁 ${escapeHtml(name)}</div>
        <div class="file-size"></div>
        <div class="file-date"></div>
        <div class="file-actions"></div>
      </div>
    `).join("");

    const fileRows = filesHere.map((x) => fileRowHtml(x, x.displayName)).join("");
    listEl.innerHTML = folderRows + fileRows;
  }

  function fileRowHtml(file, displayName) {
    return `
      <div class="file-row" data-id="${file.id}">
        <div class="file-name">${escapeHtml(displayName)}</div>
        <div class="file-size">${humanSize(file.size)}</div>
        <div class="file-date">${humanDate(file.createdAt)}</div>
        <div class="file-actions">
          <button class="file-action-btn" data-preview>preview</button>
          <button class="file-action-btn" data-download>download</button>
          <button class="file-action-btn danger" data-delete>delete</button>
        </div>
      </div>
    `;
  }

  render();

  searchInput.addEventListener("input", (e) => {
    filter = e.target.value;
    render();
  });

  breadcrumbEl.addEventListener("click", (e) => {
    const crumb = e.target.closest("[data-goto]");
    if (!crumb) return;
    currentFolder = crumb.dataset.goto;
    filter = "";
    searchInput.value = "";
    render();
  });

  root.querySelector("[data-upload]").addEventListener("click", async () => {
    const localPath = await showOpenDialog();
    if (localPath) await doUpload(localPath);
  });

  root.querySelector("[data-new-folder]").addEventListener("click", () => {
    const name = prompt("Folder name:");
    if (!name) return;
    const clean = name.trim().replace(/^\/+|\/+$/g, "");
    if (!clean || clean.includes("/")) {
      alert("Invalid folder name (no slashes, not empty).");
      return;
    }
    currentFolder = currentFolder === "" ? clean : currentFolder + "/" + clean;
    render();
  });

  root.addEventListener("click", async (e) => {
    const row = e.target.closest(".file-row");
    if (!row) return;

    if (row.classList.contains("folder-row")) {
      const folder = row.dataset.folder;
      currentFolder = currentFolder === "" ? folder : currentFolder + "/" + folder;
      render();
      return;
    }

    const id = row.dataset.id;
    if (e.target.matches("[data-preview]")) {
      try {
        await rpc({ type: "vault.preview", fileId: id });
      } catch (ex) {
        alert(`preview failed: ${ex.message}`);
      }
    } else if (e.target.matches("[data-download]")) {
      const file = allFiles.find((f) => f.id === id);
      if (!file) return;
      const suggested = file.name.split(/[\\/]/).pop() ?? file.name;
      const dest = await showSaveDialog(suggested);
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

  // Drag-and-drop — uploads land in the current folder.
  let overlay = null;
  const setOverlay = (on) => {
    if (on && !overlay) {
      overlay = document.createElement("div");
      overlay.className = "drop-overlay";
      overlay.textContent = currentFolder ? `drop to upload into ${currentFolder}` : "drop to upload";
      root.appendChild(overlay);
    } else if (!on && overlay) {
      overlay.remove();
      overlay = null;
    }
  };

  root.addEventListener("dragenter", (e) => { e.preventDefault(); setOverlay(true); });
  root.addEventListener("dragover", (e) => e.preventDefault());
  root.addEventListener("dragleave", (e) => {
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
      await rpc({
        type: "vault.upload",
        localPath,
        folderPrefix: currentFolder || undefined,
      });
      allFiles = await rpc({ type: "vault.list" });
      render();
    } catch (ex) {
      alert(`upload failed: ${ex.message}`);
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
