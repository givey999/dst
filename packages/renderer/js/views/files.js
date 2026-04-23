import { rpc, showSaveDialog, showOpenDialog, onUploadProgress, onDownloadProgress, getPathForFile } from "../ipc.js";
import { confirmDialog } from "../ui/confirm.js";
import { toast } from "../ui/toast.js";

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
  let allFolders = await rpc({ type: "vault.listFolders" });
  let filter = "";
  let currentFolder = ""; // "" = root. No leading or trailing slash.
  const busyFileIds = new Set(); // ids currently being uploaded/downloaded

  const listEl = root.querySelector("[data-list]");
  const searchInput = root.querySelector("[data-search]");
  const breadcrumbEl = root.querySelector("[data-breadcrumb]");

  // Subscribe to progress events so we can mark in-flight rows as busy.
  // Progress for uploads doesn't include a fileId since the file isn't in the
  // index yet, but we can match downloads against the file list by id — for
  // uploads we just show general busy state elsewhere (Uploads tab).
  const offDL = onDownloadProgress((p) => {
    if (!p) return;
    // Our DownloadProgress has `name` but not fileId — match by name against current list.
    // Simpler: track any in-flight download name → set busy flag on that row.
    // Since downloads are triggered by clicks in this view, we can reasonably pair.
    // Skip for now — upload activity is visible in Uploads tab.
  });
  const offUL = onUploadProgress(() => {});

  // Clean up listeners when this view is replaced.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      if (typeof offDL === "function") offDL();
      if (typeof offUL === "function") offUL();
      observer.disconnect();
    }
  });
  observer.observe(root.parentNode || document.body, { childList: true, subtree: false });

  async function refresh() {
    allFiles = await rpc({ type: "vault.list" });
    allFolders = await rpc({ type: "vault.listFolders" });
    render();
  }

  function listAtPath(files, folders, prefix) {
    const prefixSlash = prefix === "" ? "" : prefix + "/";
    const folderSet = new Set();
    const filesOut = [];
    // Folders implied by file paths.
    for (const f of files) {
      if (prefixSlash && !f.name.startsWith(prefixSlash)) continue;
      const rest = prefixSlash ? f.name.slice(prefixSlash.length) : f.name;
      const slashIdx = rest.indexOf("/");
      if (slashIdx < 0) {
        filesOut.push({ ...f, displayName: rest });
      } else {
        folderSet.add(rest.slice(0, slashIdx));
      }
    }
    // Explicit (possibly empty) folders.
    for (const p of folders) {
      if (p === prefix) continue;
      if (prefixSlash && !p.startsWith(prefixSlash)) continue;
      const rest = prefixSlash ? p.slice(prefixSlash.length) : p;
      const slashIdx = rest.indexOf("/");
      const name = slashIdx < 0 ? rest : rest.slice(0, slashIdx);
      if (name) folderSet.add(name);
    }
    return {
      folders: [...folderSet].sort(),
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

    const { folders, files: filesHere } = listAtPath(allFiles, allFolders, currentFolder);

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
        <div class="file-actions">
          <button class="file-action-btn danger" data-delete-folder>delete</button>
        </div>
      </div>
    `).join("");

    const fileRows = filesHere.map((x) => fileRowHtml(x, x.displayName)).join("");
    listEl.innerHTML = folderRows + fileRows;
  }

  function fileRowHtml(file, displayName) {
    const busy = busyFileIds.has(file.id);
    return `
      <div class="file-row ${busy ? "file-busy" : ""}" data-id="${file.id}">
        <div class="file-name" data-display-name>${busy ? `<span class="file-busy-indicator"></span>` : `<span class="file-icon">${iconForFile(displayName)}</span>`}${escapeHtml(displayName)}</div>
        <div class="file-size">${humanSize(file.size)}</div>
        <div class="file-date">${humanDate(file.createdAt)}</div>
        <div class="file-actions">
          <button class="file-action-btn" data-preview>preview</button>
          <button class="file-action-btn" data-rename>rename</button>
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
    // Electron disables window.prompt(), so use an inline input instead.
    const btn = root.querySelector("[data-new-folder]");
    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = "folder name — enter to create";
    inp.className = "folder-input";
    btn.replaceWith(inp);
    inp.focus();

    let committed = false;
    const restore = () => {
      if (committed) return;
      committed = true;
      // If the input is still in the DOM (wasn't replaced by a render), swap back to the button.
      if (inp.parentNode) inp.replaceWith(btn);
    };
    const commit = async () => {
      if (committed) return;
      const clean = inp.value.trim().replace(/^\/+|\/+$/g, "");
      if (!clean || clean.includes("/")) {
        restore();
        return;
      }
      committed = true;
      const newPath = currentFolder === "" ? clean : currentFolder + "/" + clean;
      try {
        await rpc({ type: "vault.createFolder", path: newPath });
      } catch (ex) {
        alert(`couldn't create folder: ${ex.message}`);
        return;
      }
      currentFolder = newPath;
      await refresh();
    };
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { e.preventDefault(); restore(); }
    });
    inp.addEventListener("blur", () => restore());
  });

  root.addEventListener("click", async (e) => {
    const row = e.target.closest(".file-row");
    if (!row) return;

    if (row.classList.contains("folder-row")) {
      const folder = row.dataset.folder;
      if (e.target.matches("[data-delete-folder]")) {
        const folderPath = currentFolder === "" ? folder : currentFolder + "/" + folder;
        const prefix = folderPath + "/";
        const fileCount = allFiles.filter((f) => f.name.startsWith(prefix)).length;
        const msg = fileCount === 0
          ? `The folder "${folderPath}" is empty.`
          : `The folder "${folderPath}" contains ${fileCount} file${fileCount === 1 ? "" : "s"}. They will all be permanently deleted.`;
        const ok = await confirmDialog({
          title: "Delete folder?",
          message: msg + "\n\nThis can't be undone.",
          confirmLabel: "Delete",
          cancelLabel: "Cancel",
          destructive: true,
        });
        if (!ok) return;
        try {
          await rpc({ type: "vault.deleteFolder", path: folderPath });
          await refresh();
          toast.success(`Deleted folder "${folderPath}"`);
        } catch (ex) {
          toast.error(`Delete folder failed: ${ex.message}`);
        }
        return;
      }
      currentFolder = currentFolder === "" ? folder : currentFolder + "/" + folder;
      render();
      return;
    }

    const id = row.dataset.id;
    if (e.target.matches("[data-preview]")) {
      busyFileIds.add(id);
      render();
      try {
        await rpc({ type: "vault.preview", fileId: id });
      } catch (ex) {
        toast.error(`Preview failed: ${ex.message}`);
      } finally {
        busyFileIds.delete(id);
        render();
      }
    } else if (e.target.matches("[data-rename]")) {
      const nameEl = row.querySelector("[data-display-name]");
      const file = allFiles.find((f) => f.id === id);
      if (!file || !nameEl) return;
      const displayName = nameEl.textContent;
      startInlineRename(nameEl, displayName, async (newDisplayName) => {
        // Preserve the folder prefix — only the basename changes via rename.
        const slashIdx = file.name.lastIndexOf("/");
        const prefix = slashIdx >= 0 ? file.name.slice(0, slashIdx + 1) : "";
        const newFullName = prefix + newDisplayName;
        try {
          await rpc({ type: "vault.rename", fileId: id, newName: newFullName });
          await refresh();
          toast.success(`Renamed to "${newDisplayName}"`);
        } catch (ex) {
          toast.error(`Rename failed: ${ex.message}`);
        }
      });
    } else if (e.target.matches("[data-download]")) {
      const file = allFiles.find((f) => f.id === id);
      if (!file) return;
      const suggested = file.name.split(/[\\/]/).pop() ?? file.name;
      const dest = await showSaveDialog(suggested);
      if (dest) {
        busyFileIds.add(id);
        render();
        try {
          await rpc({ type: "vault.download", fileId: id, destPath: dest });
          toast.success(`Downloaded "${suggested}"`);
        } catch (ex) {
          toast.error(`Download failed: ${ex.message}`);
        } finally {
          busyFileIds.delete(id);
          render();
        }
      }
    } else if (e.target.matches("[data-delete]")) {
      const name = row.querySelector(".file-name").textContent;
      const ok = await confirmDialog({
        title: "Delete file?",
        message: `"${name}" will be permanently deleted from your vault.\n\nThis can't be undone.`,
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        destructive: true,
      });
      if (!ok) return;
      try {
        await rpc({ type: "vault.delete", fileId: id });
        await refresh();
        toast.success(`Deleted "${name}"`);
      } catch (ex) {
        toast.error(`Delete failed: ${ex.message}`);
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

    const paths = [];
    for (const file of e.dataTransfer.files) {
      // Prefer webUtils.getPathForFile (Electron 32+ way). Fall back to
      // file.path (deprecated but sometimes still populated) to be resilient.
      const p = getPathForFile(file) ?? file.path ?? null;
      if (p) paths.push(p);
    }

    if (paths.length === 0) {
      toast.error("couldn't read dropped file(s) — check the console");
      return;
    }

    for (const p of paths) {
      await doUpload(p);
    }
  });

  async function doUpload(localPath) {
    const baseName = localPath.split(/[\\/]/).pop() ?? localPath;
    try {
      const result = await rpc({
        type: "vault.upload",
        localPath,
        folderPrefix: currentFolder || undefined,
      });
      await refresh();
      const count = result?.entries?.length ?? 1;
      if (count === 1) {
        toast.success(`Uploaded "${baseName}"`);
      } else {
        toast.success(`Uploaded ${count} files from "${baseName}"`);
      }
    } catch (ex) {
      toast.error(`Upload failed: ${ex.message}`);
    }
  }
}

function iconForFile(name) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map = {
    png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", webp: "🖼️", bmp: "🖼️", svg: "🖼️", ico: "🖼️",
    mp4: "🎬", webm: "🎬", mkv: "🎬", mov: "🎬", avi: "🎬", wmv: "🎬",
    mp3: "🎵", flac: "🎵", wav: "🎵", ogg: "🎵", m4a: "🎵", aac: "🎵",
    pdf: "📕",
    txt: "📄", md: "📝", rtf: "📄",
    doc: "📘", docx: "📘",
    xls: "📗", xlsx: "📗", csv: "📊",
    ppt: "📙", pptx: "📙",
    zip: "📦", rar: "📦", "7z": "📦", tar: "📦", gz: "📦", bz2: "📦",
    exe: "⚙️", msi: "⚙️", dll: "⚙️", bin: "⚙️", iso: "💿",
    js: "📜", ts: "📜", json: "📜", html: "📜", css: "📜", py: "📜", rb: "📜",
    java: "📜", c: "📜", cpp: "📜", h: "📜", go: "📜", rs: "📜", sh: "📜",
  };
  return map[ext] ?? "📄";
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

function startInlineRename(nameEl, current, onCommit) {
  const inp = document.createElement("input");
  inp.type = "text";
  inp.value = current;
  inp.className = "rename-input";
  nameEl.replaceWith(inp);
  inp.focus();
  inp.setSelectionRange(0, current.lastIndexOf(".") > 0 ? current.lastIndexOf(".") : current.length);

  let done = false;
  const cancel = () => {
    if (done) return;
    done = true;
    if (inp.parentNode) inp.replaceWith(nameEl);
  };
  const commit = () => {
    if (done) return;
    const v = inp.value.trim();
    if (!v || v === current || v.includes("/")) {
      cancel();
      return;
    }
    done = true;
    onCommit(v);
  };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
  inp.addEventListener("blur", () => cancel());
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
