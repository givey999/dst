const routes = new Map();
let current = null;

export function route(name, render) {
  routes.set(name, render);
}

export async function navigate(name, params = {}) {
  const view = document.getElementById("view");
  const render = routes.get(name);
  if (!render) throw new Error(`no route ${name}`);
  view.innerHTML = "";
  current = name;
  await render(view, params);
}

export function currentRoute() {
  return current;
}
