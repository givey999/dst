// Minimal toast notification system.
// toast.error("message") / toast.info("message") / toast.success("message")

let container = null;

function ensureContainer() {
  if (container && document.body.contains(container)) return container;
  container = document.createElement("div");
  container.className = "toast-container";
  document.body.appendChild(container);
  return container;
}

function show(message, kind = "info", duration = 4000) {
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  ensureContainer().appendChild(el);

  // Trigger enter animation
  requestAnimationFrame(() => el.classList.add("toast-in"));

  const dismiss = () => {
    el.classList.remove("toast-in");
    el.classList.add("toast-out");
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener("click", dismiss);
  setTimeout(dismiss, duration);
}

export const toast = {
  error: (m) => show(m, "error", 6000),
  info: (m) => show(m, "info", 4000),
  success: (m) => show(m, "success", 3000),
};
