import { rpc } from "./ipc.js";
import { route, navigate, currentRoute } from "./router.js";
import { installGlobalProgressListeners } from "./views/uploads.js";

installGlobalProgressListeners();

async function bootstrap() {
  const status = await rpc({ type: "vault.status" });

  if (!status.guildId) {
    const { wizard } = await import("./views/wizard.js");
    route("wizard", wizard);
    await navigate("wizard");
    return;
  }

  // Guild is set, but is there actually a usable vault? A half-completed Create
  // Vault (e.g., upload ok but pin failed) leaves no pinned index — unlock would
  // fail confusingly. Route such states back through the wizard's passphrase step.
  try {
    const vaultCheck = await rpc({ type: "setup.checkVaultExists" });
    if (!vaultCheck.exists) {
      const { wizard } = await import("./views/wizard.js");
      route("wizard", wizard);
      await navigate("wizard");
      return;
    }
  } catch (_e) {
    // best-effort — if the check itself fails, fall through to the unlock screen
  }

  if (!status.unlocked) {
    const { unlock } = await import("./views/unlock.js");
    route("unlock", unlock);
    await navigate("unlock");
    return;
  }

  const { files } = await import("./views/files.js");
  route("files", files);
  await navigate("files");
}

document.getElementById("btn-lock").addEventListener("click", async () => {
  // Gate states already have no vault to lock — skip the prompt.
  if (currentRoute() === "wizard" || currentRoute() === "unlock") {
    return;
  }
  const ok = confirm(
    "Lock the vault?\n\nYou'll need to enter your passphrase again to see your files. Any in-progress uploads or downloads will be cancelled.",
  );
  if (!ok) return;
  await rpc({ type: "vault.lock" });
  const { unlock } = await import("./views/unlock.js");
  route("unlock", unlock);
  await navigate("unlock");
});

document.getElementById("btn-settings").addEventListener("click", async () => {
  // Toggle: if we're on settings, go back to files; otherwise go to settings.
  // (Only makes sense from the files view; wizard/unlock are gate states.)
  if (currentRoute() === "settings") {
    const { files } = await import("./views/files.js");
    route("files", files);
    await navigate("files");
    return;
  }
  if (currentRoute() === "wizard" || currentRoute() === "unlock") {
    return;
  }
  const { settings } = await import("./views/settings.js");
  route("settings", settings);
  await navigate("settings");
});

bootstrap().catch((e) => {
  const view = document.getElementById("view");
  view.innerHTML = `<div class="loading">boot failed: ${e.message}</div>`;
});
