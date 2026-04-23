import { rpc } from "../ipc.js";
import { route, navigate } from "../router.js";

export async function wizard(root) {
  const state = {
    step: 1,
    token: null,
    botUser: null,
    guildId: null,
    existingVault: false,
  };

  let pollInterval = null;
  const stopPoll = () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };

  async function goto(step) {
    stopPoll();
    state.step = step;
    await render();
  }

  async function render() {
    root.innerHTML = `<div class="wizard">${headerHtml()}<div class="wizard-body" data-body></div></div>`;
    const body = root.querySelector("[data-body]");
    const step = state.step;
    if (step === 1) renderWelcome(body);
    else if (step === 2) renderToken(body);
    else if (step === 3) renderServer(body);
    else if (step === 4) renderPassphrase(body);
    else if (step === 5) renderDone(body);
  }

  function headerHtml() {
    return `
      <header class="wizard-header">
        <div class="wizard-title">dst · setup</div>
        <div class="wizard-dots">
          ${[1, 2, 3, 4, 5].map((n) => `<span class="dot ${n === state.step ? "active" : n < state.step ? "done" : ""}"></span>`).join("")}
        </div>
      </header>
    `;
  }

  function renderWelcome(b) {
    b.innerHTML = `
      <div class="wizard-card">
        <h1>Welcome to dst</h1>
        <p>Turn a private Discord server into your personal infinite encrypted vault. Your files are encrypted locally before they ever leave your machine — Discord never sees the contents.</p>
        <p>Setup takes about 5 minutes. You'll need a Discord account.</p>
        <div class="wizard-footer">
          <span></span>
          <button class="primary" data-next>Get started</button>
        </div>
      </div>
    `;
    b.querySelector("[data-next]").addEventListener("click", () => goto(2));
  }

  function renderToken(b) {
    b.innerHTML = `
      <div class="wizard-card">
        <h1>Create your bot</h1>
        <ol class="wizard-steps">
          <li>Click "Open Developer Portal", then "New Application". Name it anything.</li>
          <li>Open the "Bot" tab, click "Reset Token", copy it.</li>
          <li>Paste the token below.</li>
        </ol>
        <button data-open>Open Developer Portal</button>
        <input type="password" placeholder="paste bot token here" data-token autocomplete="off" />
        <div class="wizard-validate" data-validate></div>
        <div class="wizard-footer">
          <button data-back>Back</button>
          <button class="primary" data-continue disabled>Continue</button>
        </div>
      </div>
    `;
    b.querySelector("[data-open]").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = "https://discord.com/developers/applications";
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
    });

    const input = b.querySelector("[data-token]");
    const validate = b.querySelector("[data-validate]");
    const cont = b.querySelector("[data-continue]");
    let debounce;
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      cont.disabled = true;
      if (!input.value.trim()) {
        validate.textContent = "";
        validate.className = "wizard-validate";
        return;
      }
      validate.textContent = "…";
      validate.className = "wizard-validate";
      debounce = setTimeout(async () => {
        try {
          const user = await rpc({ type: "onboarding.validateToken", token: input.value.trim() });
          state.token = input.value.trim();
          state.botUser = user;
          validate.textContent = `✓ connected as ${user.username}`;
          validate.className = "wizard-validate ok";
          cont.disabled = false;
        } catch (e) {
          validate.textContent = `✗ ${e.message}`;
          validate.className = "wizard-validate err";
          cont.disabled = true;
        }
      }, 400);
    });
    b.querySelector("[data-back]").addEventListener("click", () => goto(1));
    cont.addEventListener("click", () => goto(3));
  }

  function renderServer(b) {
    b.innerHTML = `
      <div class="wizard-card">
        <h1>Create your vault server</h1>
        <p>Open Discord and create a new server for your files:</p>
        <div class="wizard-instructions">Click the <strong>+</strong> icon in your Discord sidebar → <strong>"Create My Own"</strong> → <strong>"For me and my friends"</strong> → give it any name.</div>
        <button data-open-discord>Open Discord</button>

        <h2>Invite your bot</h2>
        <p>Then pick the server you just made:</p>
        <button class="primary" data-invite>Invite bot to server</button>

        <div class="wizard-validate" data-status>waiting for bot to join a new server…</div>

        <div class="wizard-footer">
          <button data-back>Back</button>
          <span></span>
        </div>
      </div>
    `;

    const status = b.querySelector("[data-status]");

    b.querySelector("[data-open-discord]").addEventListener("click", () => {
      // discord:// is a custom protocol; fall back to web app if not handled.
      window.location.href = "discord://";
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = "https://discord.com/app";
        a.target = "_blank";
        a.rel = "noopener";
        a.click();
      }, 500);
    });

    b.querySelector("[data-invite]").addEventListener("click", async () => {
      if (!state.botUser) return;
      const appId = state.botUser.id;
      // permissions=268545040: Manage Channels(16) + View Channels(1024) + Send Messages(2048)
      //                        + Manage Messages(8192) + Attach Files(32768)
      //                        + Read Message History(65536) + Manage Roles(268435456)
      // Manage Roles lets us set channel permission overrides on pre-existing channels.
      const url = `https://discord.com/oauth2/authorize?client_id=${appId}&permissions=268545040&scope=bot`;
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
    });

    // Start polling for new guild
    const seen = new Set();
    (async () => {
      try {
        const initial = await rpc({ type: "setup.listBotGuilds" });
        for (const g of initial) seen.add(g.id);
      } catch (_e) {
        // non-fatal: we'll still poll
      }

      pollInterval = setInterval(async () => {
        try {
          const current = await rpc({ type: "setup.listBotGuilds" });
          for (const g of current) {
            if (!seen.has(g.id)) {
              stopPoll();
              state.guildId = g.id;
              status.textContent = `found ${g.name} — setting up channels…`;
              status.className = "wizard-validate ok";
              try {
                await rpc({ type: "setup.initBotAndGuild", guildId: g.id });
                const existsRes = await rpc({ type: "setup.checkVaultExists" });
                state.existingVault = existsRes.exists;
                await goto(4);
              } catch (initErr) {
                status.textContent = `✗ ${initErr.message}`;
                status.className = "wizard-validate err";
              }
              return;
            }
          }
        } catch (_e) {
          // transient error — keep polling
        }
      }, 2000);
    })();

    b.querySelector("[data-back]").addEventListener("click", () => goto(2));
  }

  function renderPassphrase(b) {
    const isExisting = state.existingVault;
    b.innerHTML = `
      <div class="wizard-card">
        <h1>${isExisting ? "Enter your existing passphrase" : "Set your passphrase"}</h1>
        ${isExisting
          ? `<p>This server already has a dst vault. Enter the passphrase you used when you first created it.</p>`
          : `<p>Your passphrase encrypts your files. Only you can decrypt them.</p>
             <div class="wizard-warning"><strong>If you lose this passphrase, your files are gone forever.</strong> Write it down somewhere safe.</div>`}
        <input type="password" placeholder="passphrase" data-p1 autofocus autocomplete="off" />
        ${isExisting ? "" : `
          <input type="password" placeholder="confirm passphrase" data-p2 autocomplete="off" />
          <label class="wizard-checkbox"><input type="checkbox" data-saved /> I've saved my passphrase somewhere safe.</label>`}
        <div class="wizard-validate" data-err></div>
        <div class="wizard-footer">
          <button data-back>Back</button>
          <button class="primary" data-submit>${isExisting ? "Unlock" : "Create vault"}</button>
        </div>
      </div>
    `;

    const err = b.querySelector("[data-err]");
    b.querySelector("[data-submit]").addEventListener("click", async () => {
      err.textContent = "";
      err.className = "wizard-validate";
      const p1 = b.querySelector("[data-p1]").value;
      try {
        if (isExisting) {
          await rpc({ type: "vault.unlock", passphrase: p1 });
        } else {
          const p2 = b.querySelector("[data-p2]").value;
          const saved = b.querySelector("[data-saved]").checked;
          if (p1 !== p2) { err.textContent = "passphrases don't match"; err.className = "wizard-validate err"; return; }
          if (!saved) { err.textContent = "please confirm you've saved it"; err.className = "wizard-validate err"; return; }
          if (p1.length < 12) { err.textContent = "use at least 12 characters"; err.className = "wizard-validate err"; return; }
          await rpc({ type: "onboarding.createVault", passphrase: p1 });
          await rpc({ type: "vault.unlock", passphrase: p1 });
        }
        await goto(5);
      } catch (e) {
        err.textContent = e.message;
        err.className = "wizard-validate err";
      }
    });
    b.querySelector("[data-back]").addEventListener("click", () => goto(3));
  }

  function renderDone(b) {
    b.innerHTML = `
      <div class="wizard-card">
        <h1>You're in</h1>
        <p>Your vault is ready. Drop a file onto the window to upload your first file.</p>
        <div class="wizard-footer">
          <span></span>
          <button class="primary" data-go>Start using dst</button>
        </div>
      </div>
    `;
    b.querySelector("[data-go]").addEventListener("click", async () => {
      const { files } = await import("./files.js");
      route("files", files);
      await navigate("files");
    });
  }

  // Detect if the wizard view is removed (route change) so we stop polling.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      stopPoll();
      observer.disconnect();
    }
  });
  observer.observe(root.parentNode || document.body, { childList: true, subtree: false });

  await render();
}
