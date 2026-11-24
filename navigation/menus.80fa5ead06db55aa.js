const nav = document.querySelector(".atlas-navigation");
const groups = [...nav.querySelectorAll("details")];

function currentDestination() {
  const page = document.body.dataset.sitePage;
  if (page !== "explorer") return page;
  const address = new URLSearchParams(location.hash.slice(1));
  if (address.has("chapter")) return "chapters";
  if (address.has("proof")) return "proofs";
  if (address.has("statement") || address.has("component")) return "statement";
  return "explorer";
}

function closeGroup(group, returnFocus = false) {
  if (!group.open) return;
  group.open = false;
  if (returnFocus) group.querySelector("summary").focus();
}

function markPage() {
  const active = currentDestination();
  for (const link of nav.querySelectorAll("a[data-destination]")) {
    if (link.dataset.destination === active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  for (const group of groups) {
    group.toggleAttribute("data-current", !!group.querySelector('[aria-current="page"]'));
    closeGroup(group, group.contains(document.activeElement));
  }
}

for (const group of groups) {
  group.addEventListener("toggle", () => {
    if (group.open) for (const other of groups) if (other !== group) closeGroup(other);
  });
  group.addEventListener("focusout", event => {
    if (event.relatedTarget && !group.contains(event.relatedTarget)) closeGroup(group);
  });
  group.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "Escape" && group.open) {
      event.preventDefault();
      closeGroup(group, true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    group.open = true;
    const links = [...group.querySelectorAll("a")];
    const index = links.indexOf(document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const start = index === -1 && step < 0 ? 0 : index;
    links[(start + step + links.length) % links.length].focus();
  });
}

document.addEventListener("pointerdown", event => {
  for (const group of groups) if (!group.contains(event.target)) closeGroup(group);
});
document.querySelector(".site-skip").addEventListener("click", event => {
  const main = document.getElementById(event.currentTarget.hash.slice(1));
  if (main) {
    event.preventDefault();
    main.focus();
    main.scrollIntoView({block: "nearest"});
  }
});
window.addEventListener("hashchange", markPage);
window.addEventListener("popstate", markPage);
window.addEventListener("atlas-address-change", markPage);
markPage();
