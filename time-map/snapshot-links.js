// The change ledger can see a new pin before its map is built. Link only published maps.
let pins;
export async function appendSnapshotMaps(container, pin) {
  if (!pins) pins = fetch("data/time-map/pins.json").then(async response => {
    if (!response.ok) throw Error("Snapshot catalogue unavailable");
    return new Set((await response.json()).snapshots.map(item => item.pin));
  }).catch(() => { pins = null; return new Set(); });
  if (!(await pins).has(pin)) return;
  for (const [label,path] of [["Original map","index.html"],["Paper Sky","june-map.html"]]) {
    const anchor = document.createElement("a");
    anchor.href = path+"?"+new URLSearchParams({snapshot:pin});
    anchor.textContent = label;
    anchor.className = "action";
    container.append(anchor);
  }
}
