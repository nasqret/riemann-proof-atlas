// Retain an inspectable selection when switching from the archived Explorer.
const link = document.getElementById("june-edition");
function updateEditionLink() {
  const state = new URLSearchParams(location.hash.slice(1));
  const key = ["theorem", "context", "bundle"].find(k => state.has(k));
  link.hash = key ? new URLSearchParams([[key, state.get(key)]]).toString() : "";
}
if (link) {
  updateEditionLink();
  window.addEventListener("hashchange", updateEditionLink);
  link.addEventListener("focus", updateEditionLink);
  link.addEventListener("pointerdown", updateEditionLink);
  link.addEventListener("click", updateEditionLink);
}
