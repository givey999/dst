import { rpc } from "../ipc.js";

export async function settings(root) {
  const status = await rpc({ type: "vault.status" });

  root.innerHTML = `
    <div class="settings">
      <section class="settings-section">
        <h2>Vault</h2>
        <div class="settings-row">
          <div class="settings-label">Server</div>
          <div class="settings-value mono">${escapeHtml(status.guildName ?? "—")}</div>
        </div>
        <div class="settings-row">
          <div class="settings-label">Chunk size</div>
          <div class="settings-value mono">${status.chunkSize ? humanSize(status.chunkSize) : "—"}</div>
        </div>
        <div class="settings-row">
          <div class="settings-label">Unlocked</div>
          <div class="settings-value mono">${status.unlocked ? "yes" : "no"}</div>
        </div>
      </section>

      <section class="settings-section">
        <h2>Change passphrase</h2>
        <form data-change-form class="settings-form" autocomplete="off">
          <input type="password" name="old" placeholder="old passphrase" required />
          <input type="password" name="new" placeholder="new passphrase" required />
          <input type="password" name="confirm" placeholder="confirm new passphrase" required />
          <div class="settings-error" data-error></div>
          <button type="submit">Change passphrase</button>
        </form>
      </section>

      <details class="settings-section">
        <summary>Advanced</summary>
        <div class="settings-row">
          <button data-gc>Run garbage collect</button>
          <div class="settings-hint">Scans the files channel and deletes messages not referenced in the index.</div>
        </div>
      </details>
    </div>
  `;

  const form = root.querySelector("[data-change-form]");
  const err = form.querySelector("[data-error]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    err.className = "settings-error";
    const data = new FormData(form);
    const oldP = data.get("old");
    const newP = data.get("new");
    const confirm = data.get("confirm");
    if (newP !== confirm) {
      err.textContent = "new + confirm don't match";
      err.className = "settings-error err";
      return;
    }
    if (newP.length < 12) {
      err.textContent = "use at least 12 characters";
      err.className = "settings-error err";
      return;
    }
    try {
      await rpc({ type: "vault.changePassphrase", oldP, newP });
      err.textContent = "changed.";
      err.className = "settings-error ok";
      form.reset();
    } catch (ex) {
      err.textContent = ex.message;
      err.className = "settings-error err";
    }
  });

  root.querySelector("[data-gc]").addEventListener("click", async () => {
    try {
      const r = await rpc({ type: "vault.garbageCollect" });
      alert(`orphans deleted: ${r.orphans}\nbytes reclaimed: ${r.reclaimedBytes}`);
    } catch (ex) {
      alert(`garbage collect failed: ${ex.message}`);
    }
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function humanSize(n) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
