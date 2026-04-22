import { rpc } from "./ipc.js";
import { route, navigate } from "./router.js";
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
  await rpc({ type: "vault.lock" });
  const { unlock } = await import("./views/unlock.js");
  route("unlock", unlock);
  await navigate("unlock");
});

document.getElementById("btn-settings").addEventListener("click", async () => {
  const { settings } = await import("./views/settings.js");
  route("settings", settings);
  await navigate("settings");
});

bootstrap().catch((e) => {
  const view = document.getElementById("view");
  view.innerHTML = `<div class="loading">boot failed: ${e.message}</div>`;
});
