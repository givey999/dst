import { rpc } from "../ipc.js";
import { route, navigate } from "../router.js";

export async function unlock(root) {
  const status = await rpc({ type: "vault.status" });

  root.innerHTML = `
    <div class="unlock">
      <form class="unlock-card" autocomplete="off">
        <div class="unlock-title">dst vault</div>
        <h1 class="unlock-heading">Enter your passphrase</h1>
        ${status.guildName ? `<div class="unlock-guild">${escapeHtml(status.guildName)}</div>` : ""}
        <input type="password" name="passphrase" placeholder="passphrase" autofocus required />
        <div class="unlock-error" data-error></div>
        <button type="submit" class="primary">Unlock</button>
      </form>
    </div>
  `;

  const form = root.querySelector("form");
  const err = root.querySelector("[data-error]");
  const input = form.querySelector("input");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    const data = new FormData(form);
    const pass = data.get("passphrase");
    try {
      await rpc({ type: "vault.unlock", passphrase: pass });
      const { files } = await import("./files.js");
      route("files", files);
      await navigate("files");
    } catch (_ex) {
      err.textContent = "wrong passphrase";
      input.select();
    }
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
