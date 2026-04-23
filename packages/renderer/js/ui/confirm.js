// Custom confirm dialog. Returns Promise<boolean>.
// Used instead of window.confirm() because the native dialog breaks the app's visual tone.

export function confirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "confirm-backdrop";
    backdrop.innerHTML = `
      <div class="confirm-card" role="dialog" aria-modal="true">
        ${title ? `<div class="confirm-title">${escapeHtml(title)}</div>` : ""}
        <div class="confirm-message">${escapeHtml(message)}</div>
        <div class="confirm-actions">
          <button type="button" data-cancel>${escapeHtml(cancelLabel)}</button>
          <button type="button" class="${destructive ? "danger-primary" : "primary"}" data-ok>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;

    const close = (result) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(false); }
      else if (e.key === "Enter") { e.preventDefault(); close(true); }
    };

    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKey);

    backdrop.querySelector("[data-ok]").addEventListener("click", () => close(true));
    backdrop.querySelector("[data-cancel]").addEventListener("click", () => close(false));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(false);
    });

    // Focus the confirm button so Enter works immediately.
    backdrop.querySelector("[data-ok]").focus();
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
