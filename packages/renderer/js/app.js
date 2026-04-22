const status = document.getElementById("status");
status.textContent = window.dst ? `dst preload v${window.dst.version}` : "no bridge";
