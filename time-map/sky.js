import {
  nodeIndex,
  writtenRecord,
  constantRecord,
  writtenFromAtlas,
  proofBundle,
  bundlesAt,
  listNodes,
} from "../june-map/node-records.js";
import { externalEdition, setSnapshotAddress, snapshotSelector, sourceTreeURL } from "./edition-address.js?atlas=de34adf8c4baea9c";

const BASE = "40e56bab026552e089d7afcfeff08d2defb9c005";
let query = new URLSearchParams(location.search);
let pin = snapshotSelector(query) || BASE;
let historical = pin !== BASE;
const sky = document.body.dataset.sitePage === "june-map";
const geometry = sky ? "sky" : "original";
const hash = () => new URLSearchParams(location.hash.slice(1));
const fmt = (n) => Number(n).toLocaleString("en-US");
const $ = (id) => document.getElementById(id);
const realId = (value) =>
  /^\d+$/.test(value ?? "") && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const node = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const a = (text, url, cls) => {
  const n = node("a", text, cls);
  n.href = url;
  return n;
};
const btn = (text, action, cls) => {
  const n = node("button", text, cls);
  n.type = "button";
  n.addEventListener("click", action);
  return n;
};
function route(key, value, extra = {}, at = location.href) {
  const url = new URL(at, document.baseURI);
  url.hash = key ? new URLSearchParams({ [key]: String(value), ...extra }).toString() : "";
  return url.href;
}
const rec = () => import("../june-map/snapshot-records.js?atlas=de34adf8c4baea9c");
const placement = () => import("./placement.js");
let catalogPromise, atlasPromise;
function catalog() {
  const url = new URL("data/time-map/pins.json", document.baseURI);
  const version = new URL(import.meta.url).searchParams.get("atlas");
  if (version) url.searchParams.set("atlas", version);
  return (catalogPromise ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw Error("Snapshot catalogue (HTTP " + r.status + ")");
      return r.json();
    })
    .catch((e) => {
      catalogPromise = null;
      throw e;
    }));
}
function atlas() {
  return (atlasPromise ??= placement()
    .then((m) => m.placementIndex())
    .catch((e) => {
      atlasPromise = null;
      throw e;
    }));
}
let bridge,
  data,
  stats,
  rev,
  track,
  trackPins,
  restoring = 0,
  layer,
  markers = [],
  selected = null,
  panel,
  panelOpen = false;
let popup,
  preview,
  graphView,
  sourceIndexLink,
  exactSelection,
  selectionRing,
  editionToken = 0,
  motion = 0,
  keep = null,
  readSearch = location.search;
let originalScopeOptions = null;
let cameraGesture = 0;
const beforeGraph = new WeakMap();
let focusGraph = false;
const markerCache = new Map();
const labels = {
  journey: "Proof evolution",
  daily: "Daily history",
  archives: "Recorded snapshots",
  proposals: "Pull requests",
  readable: "Readable edition",
  sernau: "Sernau editions",
};
function revisionName(key) {
  const edition = externalEdition(key);
  if (edition) return (data?.snapshots.find((row) => row.pin === key)?.sourcePin || "").slice(0, 8) + " · " + edition;
  return key.slice(0, 8);
}
function switches() {
  refreshEdition();
  const key = hash();
  const special = [
    "missing",
    "otherMap",
    "foundation",
    "unpositioned",
    "unplaced",
    "anchorConstants",
    "proofSearch",
    "graph",
  ].some((k) => key.has(k));
  const originalShared =
    !sky &&
    (["written", "constant", "proofBundle", "unplaced"].some((k) => key.has(k)) ||
      /^a-\d+$/.test(key.get("placement") || ""));
  return historical || special || originalShared || (!sky && query.has("snapshot") && !key.size);
}
export function exclusiveProofLayer() {
  return switches();
}
function nativePaper() {
  const h = hash();
  return sky && historical && (h.has("paper") || h.has("region"));
}
export function handlesRoute() {
  return switches() && !nativePaper();
}
export function handlesSearch() {
  return historical || !sky;
}
function failure(error, host) {
  host.replaceChildren(
    node("h2", "Snapshot data unavailable"),
    node("p", error.message || String(error)),
    btn("Retry", () => location.reload(), "time-button"),
  );
}
function showPanel(on) {
  if (!panel) return;
  panelOpen = on;
  panel.hidden = !on;
  const other = $(sky ? "inspector-content" : "content");
  if (other) other.hidden = on;
  document.body.classList.toggle("time-reading", on);
}
function locationURL(next, params = hash(), nextTrack = track) {
  const url = setSnapshotAddress(new URL(location.href), next);
  const defaultTrack = data?.tracks.journey?.length ? "journey" : "daily";
  if (nextTrack && nextTrack !== defaultTrack) url.searchParams.set("track", nextTrack);
  else url.searchParams.delete("track");
  url.hash = params.toString();
  return url;
}
function graphParams(kind, id, h = hash()) {
  const g = new URLSearchParams({ graph: "1" });
  if (kind && id != null) g.set(kind, id);
  if (h.has("graph")) {
    for (const k of ["back", "at", "backMap"]) if (h.has(k)) g.set(k, h.get(k));
  } else {
    g.set("back", h.toString());
    g.set("at", pin);
    g.set("backMap", geometry);
  }
  return g;
}
function graphTarget(kind, id, at = location.href) {
  const u = new URL(at, document.baseURI);
  u.hash = graphParams(kind, id);
  return u.href;
}
const nativeSelections = new Map(),
  nativeResults = new Map();
function nativeSelection(id) {
  if (!Number.isInteger(id)) return Promise.resolve(null);
  if (!nativeSelections.has(id))
    nativeSelections.set(
      id,
      (async () => {
        const item = await (await import("../native.js")).nativeDetail(id);
        if (Number.isInteger(item.kernelId))
          return { kind: "constant", id: item.kernelId, name: item.kernel };
        if (Number.isInteger(item.primary)) {
          const row = await writtenFromAtlas(item.primary);
          if (row != null) return { kind: "written", id: row, name: item.kernel };
        }
        return { kind: "native", id, name: item.kernel };
      })()
        .then((item) => {
          nativeResults.set(id, item);
          return item;
        })
        .catch((e) => {
          nativeSelections.delete(id);
          throw e;
        }),
    );
  return nativeSelections.get(id);
}
async function reconcile(h, from, to) {
  if (from === to || !["written", "missing", "context", "theorem"].some((k) => h.has(k))) return h;
  const origin = h.has("missing") ? h.get("from") || from : from;
  let id = realId(h.get("written") ?? h.get("missing") ?? h.get("context") ?? h.get("theorem"));
  if (h.has("theorem") && id != null) id = await writtenFromAtlas(id);
  if (id == null) return h;
  const match = await (await rec()).resolveSnapshot(origin, to, id);
  const result = new URLSearchParams(h);
  for (const k of ["written", "missing", "context", "theorem", "from"]) result.delete(k);
  if (match?.status === "present" && match.id != null) result.set("written", match.id);
  else {
    result.set("missing", id);
    result.set("from", origin);
  }
  return result;
}
function moveWithin(u) {
  const camera = bridge?.camera();
  history.replaceState({ ...history.state, skyCamera: camera }, "", location.href);
  history.pushState({ skyCamera: camera }, "", u.href);
  keep = { href: u.href, camera };
  window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
}
async function toggleGraph() {
  const request = ++motion,
    h = hash(),
    u = new URL(location.href);
  if (h.has("graph")) {
    let back = h.has("back") ? new URLSearchParams(h.get("back")) : new URLSearchParams(h);
    for (const k of ["graph", "at", "back", "backMap"]) back.delete(k);
    if (h.has("backMap") && h.get("backMap") !== geometry) {
      const from = h.get("backMap");
      if (back.has("native")) await nativeSelection(realId(back.get("native")));
      back = selectionForMap(back, from, geometry);
    }
    u.hash = await reconcile(back, h.get("at") || pin, pin);
  } else {
    const k = ["constant", "native", "written", "context", "theorem", "missing"].find((k) => h.has(k));
    const normalized = k === "native" ? await nativeSelection(realId(h.get(k))) : null;
    const g =
      k === "native" && !normalized
        ? graphParams(null, null, h)
        : graphParams(normalized?.kind || k, normalized?.id ?? (k ? h.get(k) : null), h);
    if (k === "missing" && h.has("from")) g.set("from", h.get("from"));
    u.hash = g;
  }
  if (request === motion) moveWithin(u);
}
async function changePin(next, nextTrack = track) {
  const request = ++motion,
    origin = location.href;
  if (!next || (next === pin && nextTrack === track)) return;
  const h = hash(),
    target = locationURL(next, h, nextTrack);
  try {
    target.hash = await reconcile(h, pin, next);
  } catch (error) {
    $("time-announce").textContent = "Could not match this selection. " + error.message;
    return;
  }
  if (request !== motion || location.href !== origin) return;
  moveWithin(target);
}
function prepareChrome(spec) {
  data = spec;
  const all = new Map(spec.snapshots.map((s) => [s.pin, s]));
  rev = all.get(pin);
  if (rev && externalEdition(pin)) {
    const canonical = setSnapshotAddress(new URL(location.href), pin);
    if (canonical.href !== location.href) {
      history.replaceState(history.state, "", canonical);
      readSearch = canonical.search;
      query = canonical.searchParams;
    }
  }
  const preferred = query.get("track");
  track =
    Object.hasOwn(labels, preferred) && spec.tracks[preferred]?.includes(pin)
      ? preferred
      : Object.keys(labels).find((t) => spec.tracks[t]?.includes(pin)) || "daily";
  const trackField = $("time-track"),
    slider = $("time-slider"),
    previous = $("time-prev"),
    next = $("time-next");
  trackField.replaceChildren();
  for (const [id, title] of Object.entries(labels))
    if (spec.tracks[id]?.length) {
      const o = node("option", title);
      o.value = id;
      trackField.append(o);
    }
  trackField.value = track;
  trackPins = spec.tracks[track] || [];
  const position = trackPins.indexOf(pin);
  function describe(id) {
    const item = all.get(id);
    if (!item) return "Unknown snapshot";
    const day = item.day || item.date || String(item.committedAt || "").slice(0, 10);
    return (item.label || "").includes(day) ? item.label : [day, item.label].filter(Boolean).join(" · ");
  }
  const output = $("time-date"),
    pinLink = $("time-pin");
  slider.min = 0;
  slider.max = Math.max(0, trackPins.length - 1);
  slider.step = 1;
  slider.value = Math.max(0, position);
  slider.disabled = !rev || trackPins.length < 2;
  slider.setAttribute("aria-valuetext", describe(pin));
  previous.disabled = position < 1;
  next.disabled = position < 0 || position >= trackPins.length - 1;
  output.textContent = describe(pin);
  pinLink.textContent = (rev?.sourcePin || pin).slice(0, 8);
  pinLink.hidden = !rev;
  if (rev) {
    pinLink.href = sourceTreeURL(rev);
    pinLink.title = rev.sourceRepository ? rev.sourceRepository + " · " + rev.sourcePath + " · " + rev.sourcePin : pin;
  }
  const terminal = spec.tracks.journey?.at(-1);
  const latest = $("time-final");
  latest.hidden = !externalEdition(terminal) || terminal === pin;
  latest.onclick = () => changePin(terminal, "journey");
  previous.onclick = () => changePin(trackPins[position - 1]);
  next.onclick = () => changePin(trackPins[position + 1]);
  slider.oninput = () => {
    ++motion;
    const text = describe(trackPins[Number(slider.value)]);
    output.textContent = text;
    slider.setAttribute("aria-valuetext", text);
  };
  slider.onchange = () => changePin(trackPins[Number(slider.value)]);
  trackField.onchange = () => {
    const t = trackField.value,
      ids = spec.tracks[t];
    changePin(ids.includes(pin) ? pin : ids.at(-1), t);
  };
  const bookmark = $("time-bookmark");
  bookmark.onclick = async () => {
    try {
      await navigator.clipboard.writeText(locationURL(pin).href);
      $("time-announce").textContent = "Snapshot link copied.";
    } catch {
      const f = node("input");
      f.readOnly = true;
      f.value = locationURL(pin).href;
      f.setAttribute("aria-label", "Snapshot link");
      bookmark.after(f);
      f.select();
    }
  };
  if (!rev) $("time-announce").textContent = "Unknown snapshot. Choose a recorded revision.";
  document.body.dataset.snapshot = pin;
  document.body.dataset.sourcePin = rev?.sourcePin || pin;
  document.body.dataset.edition = rev?.edition || "";
  document.body.dataset.snapshotTrack = track;
  document.body.dataset.timeReady = "true";
}
function currentRow(anchor) {
  return anchor?.[sky ? "june" : "original"];
}
function point(anchor) {
  const r = currentRow(anchor);
  if (!r) return null;
  const y = sky ? r.y : (r.projectedY ?? (180 / Math.PI) * Math.asinh(Math.tan((r.y * Math.PI) / 180)));
  return Number.isFinite(r.x) && Number.isFinite(y) ? [r.x, y] : null;
}
const hashKinds = [
  "written",
  "constant",
  "proofBundle",
  "placement",
  "theorem",
  "context",
  "bundle",
  "search",
  "unplaced",
  "unpositioned",
  "foundation",
  "anchorConstants",
  "missing",
  "proofSearch",
  "graph",
];
function selectionForMap(h, fromMap, toMap) {
  let out = new URLSearchParams(h);
  if (h.has("otherMap")) {
    if (h.get("otherMap") === toMap) out = new URLSearchParams(h.get("selection") || "");
  } else if (h.has("native") && !h.has("graph")) {
    const normalized = nativeResults.get(realId(h.get("native")));
    out =
      normalized && normalized.kind !== "native"
        ? new URLSearchParams({ [normalized.kind]: normalized.id })
        : new URLSearchParams({ otherMap: fromMap, selection: h.toString() });
  } else if (h.has("paper")) {
    const from = fromMap === "sky" ? "june" : "original",
      to = toMap === "sky" ? "june" : "original";
    const match = markers.find((m) => m.anchor[from]?.row === realId(h.get("paper")));
    if (match) {
      const p = match.anchor[to];
      out = new URLSearchParams({ paper: p.row });
      if (to === "june") {
        out.set("x", p.x);
        out.set("y", p.y);
      }
    } else out = new URLSearchParams({ otherMap: fromMap, selection: h.toString() });
  } else if (
    (h.size && !hashKinds.some((k) => h.has(k))) ||
    (h.has("placement") && !/^a-\d+$/.test(h.get("placement")) && !h.has("theorem"))
  ) {
    out = new URLSearchParams({ otherMap: fromMap, selection: h.toString() });
  }
  return out;
}
function syncSwitch() {
  const h = hash(),
    dest = sky ? "index.html" : "june-map.html",
    url = new URL(dest, location.href);
  url.search = location.search;
  const out = selectionForMap(h, geometry, sky ? "original" : "sky");
  url.hash = out.toString();
  const link = $("time-switch-other");
  if (link) link.href = url.href;
  if (link && h.has("native") && !h.has("graph") && !sky) {
    const origin = location.href,
      key = realId(h.get("native"));
    const apply = (res) => {
      if (location.href !== origin || !res || res.kind === "native") return;
      const counterpart = new URL(url.href);
      counterpart.hash = new URLSearchParams({ [res.kind]: res.id });
      link.href = counterpart.href;
    };
    if (nativeResults.has(key)) apply(nativeResults.get(key));
    else
      nativeSelection(key)
        .then(apply)
        .catch(() => {});
  }
  const toggle = $("time-graph");
  if (toggle) toggle.setAttribute("aria-pressed", String(h.has("graph")));
  const old = $("june-edition");
  if (old && (historical || switches())) old.href = url.href;
}
function visibleOriginalBase() {
  return !sky && !historical && !hash().size;
}
export function controlsForRevision() {
  document.body.classList.toggle("time-historical", historical);
  if (!sky)
    for (const id of ["scope", "subject", "generated", "relations", "evidence", "placement"])
      if ($(id)) $(id).disabled = historical || bridge?.legacyReady?.() === false;
  if (sky) {
    const s = $("node-scope");
    if (s) {
      originalScopeOptions ??= [...s.options].map((o) => o.cloneNode(true));
      if (historical) {
        s.replaceChildren(new Option("Written in this snapshot", "snapshot"));
        s.disabled = true;
      } else if (s.value === "snapshot") {
        s.replaceChildren(...originalScopeOptions.map((o) => o.cloneNode(true)));
        s.value = query.get("scope") || "rh";
        s.disabled = false;
      }
    }
  }
}
function showMarkers() {
  return exclusiveProofLayer() || visibleOriginalBase();
}
function readAnchorN(row) {
  return row?.written ?? row?.count ?? row?.counts?.all?.written ?? row?.counts?.written ?? 0;
}
async function loadMarkers(wanted, token) {
  if (!markerCache.has(wanted))
    markerCache.set(
      wanted,
      (async () => {
        const [p, counts] = await Promise.all([
          atlas(),
          wanted === BASE ? nodeIndex() : rec().then((m) => m.snapshotStats(wanted)),
        ]);
        const records = wanted === BASE ? null : counts,
          baseline = records ? null : counts;
        const groups = p.anchors.map((anchor, i) => {
          const row = records
            ? Array.isArray(records.markers)
              ? records.markers.find((x) => x.id === anchor.id) || records.markers[i]
              : records.markers[anchor.id]
            : baseline.markers[i];
          return { anchor, index: i, count: readAnchorN(row) };
        });
        return { stats: records || p.counts, groups };
      })().catch((e) => {
        markerCache.delete(wanted);
        throw e;
      }),
    );
  const result = await markerCache.get(wanted);
  if (token !== editionToken || wanted !== pin) return;
  stats = result.stats;
  markers = result.groups.map((g) => ({ ...g, element: null }));
  const size = $("time-size"),
    current = historical ? stats.written : stats.all?.written;
  if (size && Number.isFinite(current)) {
    size.textContent = fmt(current) + " written commands";
    const prev = trackPins?.[trackPins.indexOf(wanted) - 1];
    if (prev && Boolean(externalEdition(prev)) === Boolean(externalEdition(wanted)))
      (await rec())
        .snapshotIndex()
        .then((master) => {
          if (token !== editionToken) return;
          const last = master.snapshots.find((x) => x.pin === prev)?.counts?.written;
          if (Number.isFinite(last)) {
            const diff = current - last;
            size.textContent =
              fmt(current) +
              " written · " +
              (diff > 0 ? "+" : diff < 0 ? "−" : "") +
              fmt(Math.abs(diff)) +
              " from previous stop";
          }
        })
        .catch(() => {});
  }
  syncSwitch();
  draw();
  bridge?.redraw();
}
function addLayer(parent) {
  layer = node("div", null, "time-map-markers");
  layer.id = "time-map-markers";
  layer.setAttribute("aria-label", "Snapshot paper anchors");
  parent.append(layer);
  selectionRing = node("i", null, "time-source-ring");
  selectionRing.hidden = true;
  selectionRing.setAttribute("aria-hidden", "true");
  layer.append(selectionRing);
  popup = node("section", null, "time-map-popup");
  popup.id = "time-map-records";
  popup.setAttribute("aria-label", "Proof records at the selected paper");
  popup.hidden = true;
  parent.append(popup);
  sourceIndexLink = a("", route("unpositioned", 1), "time-source-index-link");
  sourceIndexLink.id = "time-source-index";
  sourceIndexLink.setAttribute("aria-expanded", "false");
  sourceIndexLink.setAttribute("aria-controls", popup.id);
  sourceIndexLink.addEventListener("click", (e) => {
    if (new URL(sourceIndexLink.href).href === location.href) {
      e.preventDefault();
      restoreTime();
    }
  });
  sourceIndexLink.hidden = true;
  const controls = sky ? node("div", null, "time-sky-controls") : parent.querySelector(".mapbar");
  if (sky) {
    const layers = parent.querySelector(".map-layers");
    layers.before(controls);
    controls.append(layers);
  }
  controls.append(sourceIndexLink);
  graphView = node("section", null, "time-graph-view");
  graphView.id = "time-graph-view";
  graphView.setAttribute("aria-label", "Dependency graph");
  graphView.tabIndex = -1;
  graphView.addEventListener("click", (e) => {
    if (e.target.closest('a[href*="#graph="]')) focusGraph = true;
  });
  graphView.hidden = true;
  parent.append(graphView);
}
export function draw() {
  if (!bridge || !layer) return;
  bridge.viewport.dataset.timeCamera = bridge.camera().join(",");
  const loose = historical ? stats?.unplaced || 0 : 0;
  sourceIndexLink.hidden = !loose || hash().has("graph");
  if (loose && sourceIndexLink.dataset.count !== String(loose)) {
    sourceIndexLink.dataset.count = loose;
    sourceIndexLink.textContent = "Source index · " + fmt(loose);
    const label = "Source index, " + fmt(loose) + " written commands without a paper coordinate";
    sourceIndexLink.setAttribute("aria-label", label);
    sourceIndexLink.title = label;
  }
  if (loose && sourceIndexLink.dataset.search !== location.search) {
    sourceIndexLink.dataset.search = location.search;
    sourceIndexLink.href = route("unpositioned", 1);
  }
  layer.hidden = !showMarkers() || !bridge.visible();
  if (layer.hidden) {
    if (preview?.fixed) positionPreview();
    else if (popup) popup.hidden = true;
    return;
  }
  const width = bridge.width(),
    height = bridge.height();
  for (const marker of markers) {
    const p = point(marker.anchor);
    if (!p || !marker.count) continue;
    if (!marker.element) {
      const e = a("", route("placement", marker.anchor.id), "time-dot");
      e.tabIndex = -1;
      e.dataset.anchor = marker.anchor.id;
      const name = marker.anchor.arxivId + " · " + fmt(marker.count) + " written declarations";
      e.setAttribute("aria-label", name);
      e.title = name;
      const shape = node("i"),
        count = node("span", fmt(marker.count));
      e.append(shape, count);
      marker.element = e;
      layer.append(e);
    }
    const [x, y] = bridge.screen(...p),
      e = marker.element;
    e.hidden = x < 0 || y < 0 || x > width || y > height;
    if (!e.hidden) {
      e.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
      e.classList.toggle("is-selected", selected === marker.anchor.id);
      e.style.setProperty("--dot", Math.max(7, Math.min(15, 4 + Math.log10(marker.count + 1) * 2)) + "px");
    }
  }
  layer.dataset.visible = String(markers.filter((m) => m.element && !m.element.hidden).length);
  layer.classList.toggle("time-counted", bridge.zoom() >= 6);
  layer.classList.toggle("time-external-detail", Boolean(externalEdition(pin)) && bridge.zoom() >= 6);
  if (exactSelection) {
    const [sx, sy] = bridge.screen(exactSelection.x, exactSelection.y);
    selectionRing.hidden = sx < 0 || sy < 0 || sx > width || sy > height;
    selectionRing.style.transform = "translate(" + sx + "px," + sy + "px)";
  } else selectionRing.hidden = true;
  if (preview) positionPreview();
}

function positionPreview() {
  if (preview?.fixed && popup) {
    popup.hidden = false;
    popup.style.left = "10px";
    popup.style.top =
      Math.max(
        9,
        sourceIndexLink.getBoundingClientRect().bottom - popup.parentElement.getBoundingClientRect().top + 6,
      ) + "px";
    return;
  }
  if (!popup || !preview || !bridge.visible() || layer.hidden) {
    if (popup) popup.hidden = true;
    return;
  }
  const coords = preview.exact ? [preview.exact.x, preview.exact.y] : point(preview.marker?.anchor);
  if (!coords) {
    popup.hidden = true;
    return;
  }
  const [x, y] = bridge.screen(...coords),
    width = bridge.width(),
    height = bridge.height();
  if (x < 0 || x > width || y < 0 || y > height) {
    popup.hidden = true;
    return;
  }
  popup.hidden = false;
  const pad = 8,
    w = popup.offsetWidth,
    h = popup.offsetHeight,
    gap = width < 520 ? 12 : 22;
  const fitsRight = x + gap + w <= width - pad,
    fitsLeft = x - gap - w >= pad;
  let left = fitsRight && (!fitsLeft || x + gap + w <= width - 62 || y > 200) ? x + gap : x - gap - w;
  if (!fitsLeft && !fitsRight) left = x - w / 2;
  popup.style.left = Math.max(pad, Math.min(left, width - w - pad)) + "px";
  const top = y - 25;
  popup.style.top = Math.max(left < 116 ? 60 : pad, Math.min(top, height - h - pad)) + "px";
}
function mapPage(marker, title, reader, ticket, fixed = false) {
  if ((!marker && !exactSelection && !fixed) || !active(ticket)) return;
  const instance = { marker, exact: exactSelection, fixed };
  preview = instance;
  popup.classList.toggle("time-index-inset", fixed);
  sourceIndexLink.setAttribute("aria-expanded", String(fixed));
  popup.setAttribute(
    "aria-label",
    fixed ? "Source index for unpositioned commands" : "Proof records at the selected paper",
  );
  const header = node("header"),
    close = btn("×", () => {
      preview = null;
      popup.hidden = true;
      sourceIndexLink.setAttribute("aria-expanded", "false");
      (fixed ? sourceIndexLink : bridge.viewport).focus({ preventScroll: true });
    });
  close.setAttribute("aria-label", "Close snapshot map details");
  header.append(node("strong", title), close);
  const body = node("div");
  popup.replaceChildren(
    header,
    node(
      "small",
      fixed
        ? "Written commands without a paper coordinate"
        : exactSelection
          ? exactSelection.paperLayout ? "Paper-centered declaration layout" : "Recorded Original map position"
          : "Paper " + marker.anchor.arxivId,
    ),
    body,
  );
  positionPreview();
  if (fixed && document.activeElement === sourceIndexLink) close.focus({ preventScroll: true });
  let serial = 0;
  async function turn(offset, focus = false) {
    const req = ++serial;
    try {
      const { total, rows } = await reader(offset, 3);
      if (!active(ticket) || preview !== instance || req !== serial) return;
      const list = node("ul");
      for (const r of rows) {
        const li = node("li"),
          link = r.url ? a(r.name, r.url) : node("span", r.name);
        link.title = r.name;
        li.append(link);
        if (fixed && r.source) {
          const line = a(r.meta || "Pinned source", r.source, "time-index-line");
          line.title = r.path || r.source;
          li.append(line);
        }
        list.append(li);
      }
      const nav = node("nav");
      nav.setAttribute("aria-label", "Snapshot map detail pages");
      if (total > 3)
        for (const [symbol, off, label, disabled] of [
          ["‹", offset - 3, "Previous map entries", offset === 0],
          ["›", offset + 3, "Next map entries", offset + 3 >= total],
        ]) {
          const b = btn(symbol, () => turn(off, true));
          b.disabled = disabled;
          b.setAttribute("aria-label", label);
          nav.append(b);
        }
      if (total)
        nav.append(node("small", fmt(offset + 1) + "–" + fmt(offset + rows.length) + " / " + fmt(total)));
      const view = btn("Inspector", () => {
        panel.focus({ preventScroll: true });
        panel.scrollIntoView({ block: "start" });
      });
      nav.append(view);
      body.replaceChildren(rows.length ? list : node("small", "No entries in this snapshot."), nav);
      positionPreview();
      if (focus) (list.querySelector("a") || view).focus({ preventScroll: true });
    } catch (e) {
      if (active(ticket) && preview === instance) body.replaceChildren(node("p", e.message));
    }
  }
  turn(0);
}

function inspectNearest(event) {
  if (externalEdition(pin) && event.key.toLowerCase() === "d" && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const address = location.href;
    import("./external-points.de34adf8c4baea9c.js").then((map) => {
      if (location.href !== address) return;
      const hit = map.hitExternalPoint(bridge.width() / 2, bridge.height() / 2, true);
      if (hit) inspectExternalPoint(hit);
      else $("time-announce").textContent = "No paper-centered declaration point is visible here.";
    });
    return;
  }
  if (
    !showMarkers() ||
    !bridge ||
    !(event.key === "b" || event.key === "B") ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  const near = markers
    .filter((m) => m.element && !m.element.hidden)
    .map((m) => {
      const [x, y] = bridge.screen(...point(m.anchor));
      return { m, d: Math.hypot(x - bridge.width() / 2, y - bridge.height() / 2) };
    })
    .sort((a, b) => a.d - b.d)[0];
  if (near) {
    event.preventDefault();
    event.stopImmediatePropagation();
    navigate("placement", near.m.anchor.id);
  }
}
function navigate(k, v, extra) {
  location.hash = new URL(route(k, v, extra)).hash;
}
function mayCenterOriginal(gesture) {
  return (gesture === undefined || gesture === cameraGesture) && !bridge.pointerActive?.();
}
function displayExternalPosition(record, gesture, focus) {
  const coordinates = record.coordinates?.[sky ? "june" : "original"];
  if (!coordinates?.every(Number.isFinite)) return false;
  const [x, y] = coordinates;
  exactSelection = { x, y, paperLayout: true };
  if (focus && !keepCamera() && mayCenterOriginal(gesture)) {
    bridge.restoreCamera([x, y, Math.max(sky ? 52 : 75, bridge.zoom())]);
  }
  draw();
  return true;
}
function focusMarker(m, gesture) {
  selected = m?.anchor.id || null;
  if (m) {
    const p = point(m.anchor);
    if (p && !keepCamera() && mayCenterOriginal(gesture)) bridge.go(...p);
  }
  draw();
}
function active(ticket) {
  return ticket === restoring;
}
function heading(kicker, title, state, id) {
  panel.replaceChildren();
  const nav = node("div", null, "time-nav");
  nav.append(
    a("Snapshot overview", route()),
    btn(hash().has("graph") ? "Show graph" : "Show map", () => {
      const view = hash().has("graph") ? graphView : bridge.viewport;
      view.focus({ preventScroll: true });
      view.scrollIntoView({ block: "nearest" });
    }),
  );
  panel.append(nav, node("p", kicker, "time-kicker"), node("h2", title));
  panel.dataset.state = state;
  panel.dataset.item = String(id ?? "");
}
function recordItem(r) {
  const meta =
    r.status === "foundation"
      ? "Graph only · foundational"
      : r.status === "unpositioned"
        ? "Unpositioned graph constant"
        : r.kind === "constant"
          ? "Graph constant"
          : r.commandKind || "Written declaration";
  return { name: r.name, meta, url: route(r.kind === "constant" ? "constant" : "written", r.id) };
}
function box(title) {
  const wrap = node("section"),
    body = node("div");
  wrap.append(node("h3", title), body);
  panel.append(wrap);
  return body;
}
async function pages(host, ticket, read, empty = "No members in this snapshot.", offset = 0) {
  const limit = 12;
  try {
    host.setAttribute("aria-busy", "true");
    const { total, rows } = await read(offset, limit);
    if (!active(ticket)) return;
    if (offset && offset >= total) return pages(host, ticket, read, empty, 0);
    host.replaceChildren(
      node(
        "p",
        total ? fmt(offset + 1) + "–" + fmt(offset + rows.length) + " of " + fmt(total) : empty,
        "time-count",
      ),
    );
    const list = node("ul", null, "time-list");
    for (const r of rows) {
      const li = node("li"),
        link = r.url ? a("", r.url) : node("span");
      link.append(node("span", r.name));
      if (r.meta) link.append(node("small", r.meta));
      li.append(link);
      list.append(li);
    }
    if (rows.length) host.append(list);
    if (total > limit) {
      const nav = node("div", null, "time-page-nav");
      for (const [text, next, disabled] of [
        ["Previous", Math.max(0, offset - limit), offset === 0],
        ["Next", offset + limit, offset + limit >= total],
      ]) {
        const b = btn(text, () => pages(host, ticket, read, empty, next));
        b.disabled = disabled;
        nav.append(b);
      }
      host.append(nav);
    }
  } catch (e) {
    if (active(ticket))
      host.replaceChildren(
        node("p", e.message),
        btn("Retry", () => pages(host, ticket, read, empty, offset)),
      );
  } finally {
    if (active(ticket)) host.removeAttribute("aria-busy");
  }
}
const slice = (rows) => async (o, l) => ({ total: rows.length, rows: rows.slice(o, o + l) });
function markerFor(value) {
  return typeof value === "number" ? markers[value] : markers.find((m) => m.anchor.id === value);
}
function anchorLink(m) {
  if (m) panel.append(a("Paper anchor · " + m.anchor.arxivId, route("placement", m.anchor.id), "time-link"));
}
function presentScope() {
  const s = query.get("scope");
  return s === "rh" || (sky && !s) ? "rh" : "all";
}
function absent(id) {
  heading("Source correspondence", "Declaration absent from this snapshot", "absent", id);
  panel.append(node("p", "This revision has no verified matching written declaration."));
}
async function missing(h, t) {
  const id = realId(h.get("missing")),
    from = h.get("from"),
    r = await (await rec()).resolveSnapshot(from, pin, id);
  if (!active(t)) return;
  if (r?.status === "present" && r.id != null) {
    location.replace(h.has("graph") ? graphTarget("written", r.id) : route("written", r.id));
    return;
  }
  absent(id);
  if (data.snapshots.some((s) => s.pin === from))
    panel.append(
      a(
        "Open the selected declaration at " + revisionName(from),
        route("written", id, {}, locationURL(from)),
        "time-link",
      ),
    );
  if (r?.candidates?.length)
    pages(
      box("Possible matches"),
      t,
      slice(
        r.candidates.map((c) =>
          typeof c === "object" ? recordItem(c) : { name: "Written row " + c, url: route("written", c) },
        ),
      ),
    );
}
async function written(id, t) {
  const gesture = cameraGesture;
  const r = historical ? await (await rec()).snapshotRecord(pin, id) : await writtenRecord(id);
  if (!active(t)) return;
  if (!r || r.present === false) {
    absent(id);
    return;
  }
  id = r.id;
  heading(
    (externalEdition(pin) ? rev.sourceRepository + " · " + rev.edition + " · " : "") +
      "Written declaration · " + (r.commandKind || "Lean command") + " · row " + id,
    r.name,
    "written",
    id,
  );
  const m = markerFor(r.marker);
  focusMarker(m,gesture);
  const paperLayout = externalEdition(pin) && displayExternalPosition(r, gesture, sky || r.baseId == null);
  if (r.path) panel.append(node("p", r.path + (r.line ? " · line " + r.line : ""), "time-path"));
  if (r.sourceUrl) panel.append(a("Read pinned Lean source", r.sourceUrl, "time-button"));
  else panel.append(node("p", "The source register supplies no pinned line range for this command."));
  if (paperLayout && (sky || r.baseId == null))
    panel.append(node("p", "This declaration has a display position around its supporting paper. The paper anchor carries the recorded map coordinate.", "time-note"));
  if (historical) {
    const bases = {
      "submission-source-correspondence": "Paper assignment of the corresponding submission command",
      "identical-source-tree": "Paper assignment from the identical source tree in the readable edition",
      "identical-source-command": "Paper assignment from an identical source command",
      "same-qualified-source-name": "Paper navigation from a matching qualified source name",
      "literal-source-reference": "Paper assignment from a declaration named in this command",
      "same-module-source-neighbor": "Paper assignment from a nearby declaration in the same module",
      "source-topic-vocabulary": "Paper assignment from topic terms in the source",
      "source-file-citation": "Paper assignment from a citation in the source file",
      "source-file-topic": "Paper assignment from the file heading or module path",
      "literal-source-peer": "Paper assignment from a source reference in this edition",
      "same-file-source-peer": "Paper assignment from a command in the same source file",
      "imported-module-peer": "Paper assignment from a module imported by this file",
      "same-file-navigation-only": "Navigation from other commands in this file",
      "source-import-navigation-only": "Navigation from modules imported by this file",
      "mathlib-import-topic-navigation":
        "Mathematical topic suggested by a named Mathlib import · navigation only",
      "no-source-placement": "Source index",
    };
    const fields = [
      r.status?.replaceAll("-", " "),
      bases[r.positionBasis] || r.positionBasis,
      r.sourceRangeBasis,
    ].filter(Boolean);
    if (fields.length) panel.append(node("p", fields.join(" · "), "time-meta"));
    if (r.basisRow != null && r.basisRow !== id)
      panel.append(a("Inspect placement witness " + r.basisRow, route("written", r.basisRow), "time-link"));
    if (r.positionEvidence?.sourceUrl)
      panel.append(
        a(
          "Placement evidence · " +
            (r.positionEvidence.label || "source in this revision") +
            (r.positionEvidence.line ? " · line " + fmt(r.positionEvidence.line) : ""),
          r.positionEvidence.sourceUrl,
          "time-link",
        ),
      );
    if (r.positionEvidence?.alternativeWitnessIds?.length) {
      const alternatives = node("details");
      alternatives.append(node("summary", "Other source witnesses"));
      for (const witness of r.positionEvidence.alternativeWitnessIds)
        alternatives.append(a("Written command " + fmt(witness), route("written", witness), "time-link"));
      panel.append(alternatives);
    }
  }
  if (m) anchorLink(m);
  else panel.append(node("p", "Placement evidence supplies no paper coordinate for this command."));
  if (r.bundle) panel.append(a("Open proof bundle", route("proofBundle", r.bundle), "time-link"));
  const actions = [];
  if (r.sourceUrl) actions.push({ name: "Read " + r.name, url: r.sourceUrl });
  if (r.bundle)
    actions.push({ name: "Other declarations in this bundle", url: route("proofBundle", r.bundle) });
  if (historical && !m && !exactSelection) {
    panel.append(a("Open the source index", route("unpositioned", 1), "time-link"));
    if (hash().get("via") === "sourceIndex") {
      const info = [
        {
          name: r.name,
          url: r.sourceUrl,
          meta: r.path?.split("/").pop() + " · line " + r.line,
          source: r.sourceUrl,
          path: r.path,
        },
        { name: "More commands in the source index", url: route("unpositioned", 1) },
      ];
      mapPage(null, "Written declaration", slice(info), t, true);
    }
  } else mapPage(m, "Written declaration", slice(actions), t);
  if (!sky && (!historical || r.baseId != null)) {
    const note = node("p", "Loading the recorded Original position…", "time-meta");
    panel.append(note);
    originalWrittenLocation(r, t, note,gesture);
  }
  if (!historical) {
    const out = box("Owned graph constants");
    pages(out, t, async (offset, limit) => {
      const result = await listNodes({ kind: "constant", scope: "all", owner: id, offset, limit });
      return { ...result, rows: result.rows.map(recordItem) };
    });
  } else {
    const refs = await (await rec()).snapshotReferences(pin, id);
    if (!active(t)) return;
    const host = box("Source references at this revision");
    if (!refs.length)
      host.append(
        node(
          "p",
          "The source index records no literal reference in the inspected command forms.",
          "time-note",
        ),
      );
    else {
      host.append(
        node(
          "p",
          "Identifiers in the command text link to their source lines. A unique name in this revision also opens its declaration.",
          "time-note",
        ),
      );
      const list = node("ul", null, "time-list");
      host.append(list);
      for (const ref of refs.slice(0, 24)) {
        const line = node("li", null, "time-reference");
        const lookup = a(
          ref.name,
          ref.targetId == null ? route("search", ref.name) : route("written", ref.targetId),
        );
        lookup.title =
          ref.targetId == null ? "Search this source revision" : ref.relation + " · " + ref.targetName;
        line.append(lookup);
        if (ref.sourceUrl) line.append(a("line " + fmt(ref.line), ref.sourceUrl));
        list.append(line);
      }
      if (refs.length > 24)
        host.append(
          node("p", "Showing 24 of " + fmt(refs.length) + " recorded source references.", "time-note"),
        );
    }
    panel.append(
      node("p", "The checked kernel dependency graph is available at the submission pin.", "time-note"),
    );
  }
}
async function originalWrittenLocation(record, t, note,gesture) {
  const camera = bridge.camera(),
    visiblePopup = preview;
  try {
    const ready = await bridge.geometryReady();
    if (!active(t)) return;
    if (!ready) {
      note.textContent = "Detailed Original geometry is unavailable.";
      return;
    }
    const point = historical
      ? await (await import("./retained-points.de34adf8c4baea9c.js")).originalWrittenPosition(record.baseId, record.atlas)
      : await bridge.basePoint(record.id, record.atlas);
    if (!active(t)) return;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      if (externalEdition(pin) && displayExternalPosition(record, gesture, true)) {
        note.textContent = "This declaration has a display position around its supporting paper.";
        draw();
      } else note.remove();
      return;
    }
    exactSelection = point;
    selected = null;
    note.textContent =
      "Recorded submission position of the corresponding source command on the Original map.";
    if (!keepCamera() && mayCenterOriginal(gesture) && bridge.camera().every((n, i) => n === camera[i]))
      bridge.goWritten(point.x, point.y);
    if (visiblePopup && preview === visiblePopup && !preview.fixed) {
      preview.exact = point;
      const basis = popup.querySelector(":scope > small");
      if (basis) basis.textContent = "Recorded Original map position";
    }
    draw();
  } catch (error) {
    if (active(t)) note.textContent = "Detailed Original position unavailable. " + error.message;
  }
}
async function constant(id, t) {
  if (historical) {
    const r = await constantRecord(id);
    if (!active(t)) return;
    heading("Submission export", "Graph evidence belongs to the submission", "constant-unavailable", id);
    if (r) {
      panel.append(
        node("p", r.name),
        a("Inspect the checked graph constant", route("constant", id, {}, locationURL(BASE)), "time-button"),
      );
      if (r.owner != null) {
        const match = await (await rec()).resolveSnapshot(BASE, pin, r.owner);
        if (active(t) && match?.status === "present")
          panel.append(a("Open this snapshot’s written owner", route("written", match.id), "time-link"));
      }
    }
    return;
  }
  const [r, p] = await Promise.all([constantRecord(id), (await placement()).constantPlacement(id, { pin })]);
  if (!active(t)) return;
  if (!r) {
    heading("Graph", "Unknown export name", "absent", id);
    return;
  }
  heading("Graph constant · export ID " + id, r.name, "constant", id);
  const m = markerFor(p?.marker);
  focusMarker(m);
  placementText(panel, p);
  anchorLink(m);
  if (r.owner != null) panel.append(a("Written owner", route("written", r.owner), "time-link"));
  if (r.sourceUrl) panel.append(a("Read owner’s pinned Lean source", r.sourceUrl, "time-button"));
  const evidence = node("details");
  evidence.append(
    node("summary", "Lean export evidence"),
    node(
      "p",
      "Type expression " +
        r.typeExpr +
        " · Value expression " +
        (r.valueExpr ?? "absent") +
        " · Byte offset " +
        r.byteOffset,
    ),
  );
  panel.append(evidence);
  const edgeAPI = await import("../june-map/node-edges.js"),
    summary = await import("../june-map/node-records.js");
  if (!active(t)) return;
  const host = box("Direct dependencies");
  pages(
    host,
    t,
    async (offset, limit) => {
      const e = await edgeAPI.constantEdges(id, { offset, limit });
      const rows = await Promise.all(
        e.items.map(async (x) => ({
          name: x.frontier?.name || (await summary.constantSummary(x.id)).name,
          meta: [
            [1, "type"],
            [2, "value"],
            [4, "compiler support"],
          ]
            .filter(([b]) => x.flags & b)
            .map(([, v]) => v)
            .join(" + "),
          url: x.frontier ? null : route("constant", x.id),
        })),
      );
      return { total: e.total, rows };
    },
    "This constant has no outgoing edge.",
  );
}
const edgeRoles = (flags) =>
  [
    [1, "type"],
    [2, "value"],
    [4, "compiler support"],
  ]
    .filter(([bit]) => flags & bit)
    .map(([, name]) => name)
    .join(" + ");
async function graphDiagram(title, relation, source, t, read) {
  if (!active(t)) return;
  graphView.replaceChildren();
  const k = node("p", title, "time-graph-eyebrow");
  const center = node("h2", source, "time-graph-center"),
    links = node("div", null, "time-graph-branches");
  graphView.append(k, center, node("p", relation, "time-graph-relation"), links);
  if (focusGraph) {
    center.tabIndex = -1;
    center.focus({ preventScroll: true });
    focusGraph = false;
  }
  let version = 0;
  async function page(offset = 0, focus = false) {
    const call = ++version,
      pageSize = 8;
    links.setAttribute("aria-busy", "true");
    try {
      const { total, rows } = await read(offset, pageSize);
      if (!active(t) || call !== version) return;
      const count = node(
        "p",
        total
          ? fmt(offset + 1) + "–" + fmt(offset + rows.length) + " of " + fmt(total)
          : "No recorded outgoing references.",
        "time-graph-count",
      );
      links.replaceChildren(count);
      if (!total) return;
      const list = node("ul", null, "time-graph-list");
      for (const r of rows) {
        const li = node("li"),
          link = r.url ? a("", r.url) : node("span");
        link.append(node("small", r.meta), node("span", r.name));
        li.append(link);
        if (r.source) li.append(a("Source line " + fmt(r.line), r.source, "time-graph-line"));
        list.append(li);
      }
      links.append(list);
      if (total > pageSize) {
        const nav = node("nav", null, "time-graph-pages");
        nav.setAttribute("aria-label", "Dependency pages");
        for (const [label, to, disabled] of [
          ["Previous", offset - pageSize, offset === 0],
          ["Next", offset + pageSize, offset + pageSize >= total],
        ]) {
          const b = btn(label, () => page(to, true));
          b.disabled = disabled;
          nav.append(b);
        }
        links.append(nav);
      }
      if (focus) list.querySelector("a")?.focus({ preventScroll: true });
    } catch (e) {
      if (active(t) && call === version)
        links.replaceChildren(
          node("p", e.message),
          btn("Retry", () => page(offset)),
        );
    } finally {
      if (active(t) && call === version) links.removeAttribute("aria-busy");
    }
  }
  await page();
}
function graphMessage(title, msg, link) {
  graphView.replaceChildren(
    node("p", historical ? "Source references" : "Kernel dependency graph", "time-graph-eyebrow"),
    node("h2", title, "time-graph-center"),
    node("p", msg, "time-graph-relation"),
  );
  if (link) graphView.append(link);
}
async function dependencyGraph(h, t) {
  const index = await nodeIndex(),
    root = index.root;
  if (!active(t)) return;
  if (h.has("native")) {
    const nativeId = realId(h.get("native")),
      record = await nativeSelection(nativeId);
    if (!active(t)) return;
    if (record?.kind === "native") {
      heading("Original compiled theorem", record.name, "graph-empty", nativeId);
      const message =
        "The compiled theorem register supplies no matching submission export or written command.";
      panel.append(
        node("p", message),
        a("Open the original theorem record", route("native", nativeId, {}, locationURL(BASE)), "time-link"),
      );
      graphMessage(
        record.name,
        message,
        a("Open the classical RH graph", graphTarget(null, null), "time-graph-action"),
      );
      return;
    }
    h = new URLSearchParams(h);
    h.delete("native");
    if (record) h.set(record.kind, record.id);
  }
  if (h.has("missing")) {
    await missing(h, t);
    if (active(t))
      graphMessage(
        "Declaration absent from this snapshot",
        "Its source references belong to another revision.",
        a("Open the classical RH graph", graphTarget(null, null), "time-graph-action"),
      );
    return;
  }
  const wantsConstant = h.has("constant") || h.has("native");
  let constantID = wantsConstant ? realId(h.get("constant") ?? h.get("native")) : null;
  let writtenID = realId(h.get("written") ?? h.get("context") ?? h.get("theorem"));
  if (h.has("theorem") && writtenID != null) writtenID = await writtenFromAtlas(writtenID);
  const hasSelection = wantsConstant || ["written", "context", "theorem"].some((k) => h.has(k));
  if (!historical) {
    let owner;
    if (writtenID != null) {
      owner = await writtenRecord(writtenID);
      if (owner?.primaryConstant != null) constantID = owner.primaryConstant;
      else if (owner?.ownedCount)
        constantID = (await listNodes({ kind: "constant", scope: "all", owner: writtenID, limit: 1 })).rows[0]
          ?.id;
    } else if (!hasSelection) constantID = root.constant;
    const r = constantID == null ? null : await constantRecord(constantID);
    if (!active(t)) return;
    if (!r) {
      heading("Submission dependency graph", owner?.name || "Constant unavailable", "graph-empty", writtenID);
      const reason = owner
        ? "This written command owns no exported constant."
        : "The submission export has no matching constant.";
      panel.append(node("p", reason));
      if (owner?.sourceUrl) panel.append(a("Read pinned Lean source", owner.sourceUrl, "time-link"));
      graphMessage(
        owner?.name || "Constant unavailable",
        reason,
        a("Open the classical RH graph", graphTarget("constant", root.constant), "time-graph-action"),
      );
      return;
    }
    heading("Submission dependency graph · export " + r.id, r.name, "graph", r.id);
    panel.append(
      node(
        "p",
        "Choose a directly referenced constant to follow another dependency. Each edge records where the referenced name appears in the Lean export.",
      ),
    );
    if (r.owner != null) panel.append(a("Open written owner", route("written", r.owner), "time-link"));
    if (r.sourceUrl) panel.append(a("Read owner’s pinned Lean source", r.sourceUrl, "time-button"));
    panel.append(a("Inspect export and placement evidence", route("constant", r.id), "time-link"));
    if (owner?.ownedCount > 1) {
      const host = box("Other constants owned by this command");
      pages(host, t, async (offset, limit) => {
        const found = await listNodes({ kind: "constant", scope: "all", owner: owner.id, offset, limit });
        return {
          ...found,
          rows: found.rows.map((c) => ({ name: c.name, url: graphTarget("constant", c.id) })),
        };
      });
    }
    const edges = await import("../june-map/node-edges.js"),
      names = await import("../june-map/node-records.js");
    await graphDiagram(
      "Checked submission · kernel dependency graph",
      "Direct dependencies",
      r.name,
      t,
      async (offset, limit) => {
        const out = await edges.constantEdges(r.id, { offset, limit });
        const rows = await Promise.all(
          out.items.map(async (e) => ({
            name: e.frontier?.name || (await names.constantSummary(e.id)).name,
            meta: edgeRoles(e.flags),
            url: e.frontier ? null : graphTarget("constant", e.id),
          })),
        );
        return { total: out.total, rows };
      },
    );
    return;
  }
  const api = await rec();
  let historicSource, provided;
  if (wantsConstant && constantID != null) {
    provided = await constantRecord(constantID);
    if (provided?.owner != null) {
      const joined = await api.resolveSnapshot(BASE, pin, provided.owner);
      if (joined.status === "present") writtenID = joined.id;
    }
  }
  if (!hasSelection && externalEdition(pin)) {
    writtenID = rev?.rootWritten ?? (await api.snapshotStats(pin)).rootWritten;
  } else if (!hasSelection) {
    historicSource = await api.snapshotRecord(pin, root.written);
    if (historicSource?.present) writtenID = historicSource.id;
    else {
      const found = await api.findSnapshotNodes(pin, root.name, { match: "spelling", limit: 2 });
      if (found.total === 1) writtenID = found.rows[0].id;
    }
  }
  if (writtenID != null && (!historicSource?.present || historicSource.id !== writtenID))
    historicSource = await api.snapshotRecord(pin, writtenID);
  if (!active(t)) return;
  const compiled = new URLSearchParams({ graph: "1" });
  if (provided) compiled.set("constant", provided.id);
  else if (historicSource?.baseId != null) compiled.set("written", historicSource.baseId);
  else compiled.set("constant", root.constant);
  const compiledLabel =
    provided || historicSource?.baseId != null
      ? "Open corresponding compiled submission graph"
      : "Open classical RH’s compiled submission graph";
  const compiledURL = locationURL(BASE, compiled, "daily").href;
  if (!historicSource?.present) {
    const title = provided?.name || (hasSelection ? "Source declaration unavailable" : root.name);
    heading("Source references · " + revisionName(pin), title, "graph-empty", writtenID ?? constantID);
    const msg = "This revision has no verified written source for this selection.";
    panel.append(node("p", msg), a(compiledLabel, compiledURL, "time-button"));
    graphMessage(title, msg, a(compiledLabel, compiledURL, "time-graph-action"));
    return;
  }
  heading("Source references · " + revisionName(pin), historicSource.name, "source-graph", historicSource.id);
  panel.append(
    node(
      "p",
      "These links follow named identifiers in the selected source revision. The checked type and value edges are available in the compiled submission graph.",
    ),
  );
  if (historicSource.sourceUrl)
    panel.append(a("Read pinned Lean source", historicSource.sourceUrl, "time-button"));
  panel.append(
    a("Open this written declaration", route("written", historicSource.id), "time-link"),
    a(compiledLabel, compiledURL, "time-link"),
  );
  const refs = await api.snapshotReferences(pin, historicSource.id);
  const rows = refs.map((ref) => ({
    name: ref.name,
    meta: ref.targetId == null ? "literal source identifier" : (ref.relation || "unique source-name candidate"),
    url: ref.targetId == null ? null : graphTarget("written", ref.targetId),
    source: ref.sourceUrl,
    line: ref.line,
  }));
  await graphDiagram(
    "Source references · " + revisionName(pin),
    "Named references in this command",
    historicSource.name,
    t,
    slice(rows),
  );
}
export function placementText(host, p) {
  if (!p) return;
  const basis = {
    "graph-neighbor": "a directly connected written owner",
    "graph-path": "a path to written owners",
    "namespace-context": "recorded namespace context",
    "graph-navigation": "a graph navigation witness",
  };
  const text =
    p.status === "foundation"
      ? "Foundational Lean constant · excluded from the mathematical map."
      : p.plotted
        ? "Paper placement · " + (basis[p.route] || String(p.route || "recorded evidence"))
        : "Unpositioned · the available evidence supplies no paper coordinate.";
  host.append(node("p", text, "time-meta"));
  if (p.support) {
    const s = p.support;
    host.append(
      node(
        "p",
        fmt(s.winningOwners) +
          " of " +
          fmt(s.distinctOwners) +
          " supporting owners point toward this paper. " +
          "Its score is " +
          fmt(s.winningScore) +
          " of " +
          fmt(s.totalScore) +
          " across " +
          fmt(s.candidatePapers) +
          " candidate papers. " +
          fmt(s.tiedPapers) +
          " share the highest score.",
        "time-note",
      ),
    );
  }
  if (p.direction) {
    const roles = [
      [1, "type"],
      [2, "value"],
      [4, "compiler support"],
    ]
      .filter(([mask]) => p.edgeFlags & mask)
      .map(([, label]) => label)
      .join(" + ");
    host.append(
      node(
        "p",
        (p.direction === "uses" ? "Uses the witness" : "Used by the witness") +
          (roles ? " · " + roles : "") +
          ".",
        "time-note",
      ),
    );
  }
  if (p.compilerOnPath || p.ambiguousOnPath)
    host.append(
      node(
        "p",
        [
          p.compilerOnPath ? "The path includes compiler support." : "",
          p.ambiguousOnPath ? "An intermediate placement has tied evidence." : "",
        ]
          .filter(Boolean)
          .join(" "),
        "time-note",
      ),
    );
  if (p.witnessOwner != null)
    host.append(a("Inspect written placement witness", route("written", p.witnessOwner), "time-link"));
  if (p.via != null && p.via !== p.id)
    host.append(a("Inspect graph witness " + p.via, route("constant", p.via), "time-link"));
  if (p.runnerUp) host.append(a("Second-ranked paper", route("placement", p.runnerUp), "time-link"));
}
async function anchor(id, t) {
  const m = markerFor(id);
  if (!m) {
    heading("Paper anchor", "Unknown anchor", "absent", id);
    return;
  }
  heading("Supporting paper · " + m.anchor.arxivId, m.anchor.title, "placement", id);
  focusMarker(m);
  const p = currentRow(m.anchor);
  panel.append(
    node(
      "p",
      fmt(m.count) +
        " written declarations · " +
        (sky ? "Paper Sky" : "Original map") +
        " paper row " +
        p.row,
      "time-meta",
    ),
  );
  panel.append(a("Open paper on arXiv", "https://arxiv.org/abs/" + m.anchor.arxivId, "time-link"));
  const groups = historical
    ? await (await rec()).snapshotBundlesAt(pin, m.index)
    : await bundlesAt(m.index, presentScope());
  if (!active(t)) return;
  const read = slice(
    groups.map((g) => ({
      name: g.label,
      meta: fmt(g.written) + " written",
      url: route("proofBundle", g.id),
    })),
  );
  pages(box("Proof bundles at this paper"), t, read);
  mapPage(m, "Proof bundles", read, t);
  if (!historical)
    panel.append(a("Browse graph constants at this paper", route("anchorConstants", id), "time-link"));
}
async function bundle(id, t) {
  const b = historical ? await (await rec()).snapshotBundle(pin, id) : await proofBundle(id);
  if (!active(t)) return;
  if (!b) {
    heading("Proof bundle", "Bundle absent from this snapshot", "absent", id);
    return;
  }
  heading("Proof bundle", b.label, "proofBundle", id);
  const m = markerFor(b.marker);
  focusMarker(m);
  anchorLink(m);
  const host = box("Written declarations in this bundle");
  const read = async (offset, limit) => {
    const options = { kind: "written", scope: presentScope(), bundle: id, offset, limit };
    const result = historical
      ? await (await rec()).listSnapshotNodes(pin, options)
      : await listNodes(options);
    return { ...result, rows: result.rows.map(recordItem) };
  };
  pages(host, t, read);
  mapPage(m, "Written declarations", read, t);
}
async function groups(k, id, t) {
  const isAnchor = k === "anchorConstants",
    m = isAnchor ? markerFor(id) : null;
  const group = isAnchor ? id : k === "foundation" ? "foundation" : "unpositioned";
  heading(
    "Proof catalogue",
    isAnchor
      ? "Graph constants at this paper"
      : group === "foundation"
        ? "Foundational constants"
        : historical
          ? "Source index"
          : "Unpositioned declarations and constants",
    k,
    id,
  );
  if (m) {
    focusMarker(m);
    anchorLink(m);
  }
  if (historical && group === "foundation") {
    panel.append(node("p", "The historical source register contains no foundational kernel constants."));
    return;
  }
  if (historical && isAnchor) {
    panel.append(
      node(
        "p",
        "Checked graph constants belong to the submission. This revision lists its written commands at the paper.",
      ),
      a("Open this revision’s paper group", route("placement", id), "time-link"),
      a(
        "Open compiled submission constants",
        route("anchorConstants", id, {}, locationURL(BASE)),
        "time-link",
      ),
    );
    return;
  }
  if (historical)
    panel.append(
      node(
        "p",
        "These commands have pinned Lean source lines. The paper map has no recorded coordinate for them.",
      ),
    );
  const q = hash().get("q") || "",
    form = node("form", null, "time-filter"),
    field = node("input");
  field.type = "search";
  field.value = q;
  field.autocomplete = "off";
  field.placeholder = "Lean name prefix";
  field.setAttribute("aria-label", "Filter these records by name");
  const go = node("button", "Find");
  go.type = "submit";
  form.append(field, go);
  if (!isAnchor) panel.append(form);
  form.onsubmit = (e) => {
    e.preventDefault();
    navigate(k, id, field.value.trim() ? { q: field.value.trim() } : {});
  };
  const host = box(historical ? "Written declarations" : "Graph constants");
  const read = async (offset, limit) => {
    const o = { kind: historical ? "written" : "constant", scope: presentScope(), offset, limit };
    let result;
    if (historical)
      result = q
        ? await (await rec()).findSnapshotNodes(pin, q, { ...o, unplaced: true })
        : await (await rec()).listSnapshotNodes(pin, { ...o, unplaced: true });
    else if (q && !isAnchor) result = await (await placement()).findPlaced(q, { ...o, status: group });
    else result = await (await placement()).placementMembers(group, o);
    if (historical) {
      const api = await rec();
      const cards = await Promise.all(result.rows.map((row) => api.snapshotRecord(pin, row.id)));
      return {
        ...result,
        rows: cards
          .filter((r) => r?.present)
          .map((r) => ({
            name: r.name,
            url: route("written", r.id, { via: "sourceIndex" }),
            source: r.sourceUrl,
            path: r.path,
            meta: r.path?.split("/").pop() + " · line " + r.line,
          })),
      };
    }
    return { ...result, rows: result.rows.map(recordItem) };
  };
  pages(host, t, read);
  if (historical && stats?.unplaced > 0) mapPage(null, "Source index", read, t, true);
}
async function searchRows(q, t) {
  heading(historical ? "Snapshot source index" : "Proof catalogue", "Search results", "search", q);
  const input = $("search");
  if (input) input.value = q;
  const host = box("Names matching “" + q + "”");
  if (!sky && !historical)
    panel.append(a("Search the original theorem index", route("search", q), "time-link"));
  const id = realId(q);
  pages(
    host,
    t,
    async (offset, limit) => {
      if (id != null) {
        const result = historical
          ? [await (await rec()).snapshotRecord(pin, id)]
          : await Promise.all([writtenRecord(id), constantRecord(id)]);
        return slice(result.filter((r) => r && r.present !== false).map(recordItem))(offset, limit);
      }
      const result = historical
        ? await (await rec()).findSnapshotNodes(pin, q, { offset, limit })
        : await (
            await placement()
          ).findPlaced(q, { status: "all", scope: presentScope(), kind: "both", offset, limit });
      return { ...result, rows: result.rows.map(recordItem) };
    },
    "No matching name in this snapshot.",
  );
  const topics = bridge.topicSearch?.(q) || [];
  if (topics.length) {
    const disclosure = node("details");
    disclosure.append(node("summary", "Paper regions matching this search"));
    const body = node("div");
    disclosure.append(body);
    panel.append(disclosure);
    pages(body, t, slice(topics));
  }
}
function overview(t) {
  heading(rev?.label || "Revision", "Proof in this snapshot", "overview");
  if (externalEdition(pin)) {
    const directory = a(rev.sourceRepository + " · " + rev.sourcePath, sourceTreeURL(rev), "time-link");
    panel.append(directory);
    panel.append(node("p", "Green points group written declarations around their supporting papers. Select a group to zoom in or an individual point to read its Lean source. With the map focused, D selects the nearest green point. The Original map also shows verified positions inherited from the submission.", "time-note"));
    const endpoints = rev.endpoints || stats?.endpoints || [];
    if (endpoints.length) {
      const host = box("Statements in this edition");
      pages(host, t, slice(endpoints.map((entry) => ({
        name: entry.name, url: route("written", entry.id),
      }))));
    }
  }
  const count = historical ? stats?.written : markers.reduce((n, m) => n + m.count, 0);
  if (count != null)
    panel.append(
      node(
        "p",
        fmt(count) +
          " written declarations · " +
          fmt(markers.filter((m) => m.count).length) +
          " paper anchors.",
        "time-meta",
      ),
    );
  if (historical)
    panel.append(
      node(
        "p",
        "Choose a paper anchor to inspect the source commands present at this revision and their recorded placements.",
      ),
    );
  const host = box("Paper anchors");
  pages(
    host,
    t,
    slice(
      markers
        .filter((m) => m.count)
        .sort((a, b) => b.count - a.count)
        .map((m) => ({ name: m.anchor.title, meta: fmt(m.count), url: route("placement", m.anchor.id) })),
    ),
  );
  if (historical ? stats?.unplaced > 0 : true)
    panel.append(
      a(
        historical
          ? "Source index · " + fmt(stats.unplaced) + " commands without paper coordinates"
          : "Unpositioned records",
        route("unpositioned", 1),
        "time-link",
      ),
    );
  if (!historical) panel.append(a("Foundational constants", route("foundation", 1), "time-link"));
}
export async function restoreTime() {
  if (!bridge) return;
  refreshEdition();
  const t = ++restoring;
  syncSwitch();
  selected = null;
  exactSelection = null;
  preview = null;
  if (popup) popup.hidden = true;
  sourceIndexLink.setAttribute("aria-expanded", "false");
  const inGraph = hash().has("graph");
  document.body.classList.toggle("time-graph-active", inGraph);
  graphView.hidden = !inGraph;
  for (const el of graphView.parentElement.children) {
    if (el === graphView) continue;
    if (inGraph && !beforeGraph.has(el)) {
      beforeGraph.set(el, el.inert);
      el.inert = true;
    } else if (!inGraph && beforeGraph.has(el)) {
      el.inert = beforeGraph.get(el);
      beforeGraph.delete(el);
    }
  }
  if (inGraph) graphView.replaceChildren(node("p", "Loading dependencies…", "time-graph-relation"));
  draw();
  if (!handlesRoute()) {
    showPanel(false);
    return;
  }
  showPanel(true);
  if (!sky) document.body.dataset.ready = "true";
  panel.replaceChildren(node("p", "Loading snapshot…"));
  panel.dataset.state = "loading";
  try {
    await initialized;
    if (!active(t)) return;
    if (!rev) {
      heading("Snapshot catalogue", "Unknown snapshot", "invalid");
      panel.append(
        a("Open original submission", locationURL(BASE, new URLSearchParams(), "daily").href, "time-button"),
      );
      return;
    }
    const h = hash();
    if (h.has("graph")) return await dependencyGraph(h, t);
    if (!h.size && historical && !stats) {
      heading(rev.label || "Revision", "Proof in this snapshot", "overview");
      const summary = node("p", "Reading source counts…", "time-meta");
      panel.append(summary, node("p", "Loading paper anchors…", "time-note"));
      rec()
        .then((m) => m.snapshotIndex())
        .then((c) => {
          const n = c.snapshots.find((s) => s.pin === pin)?.counts?.written;
          if (active(t) && summary.isConnected && Number.isFinite(n))
            summary.textContent = fmt(n) + " written commands";
        })
        .catch(() => {});
    }
    await markersReady;
    if (!active(t)) return;
    if (h.has("otherMap")) {
      const name = h.get("otherMap") === "sky" ? "Paper Sky" : "Original map",
        u = new URL(h.get("otherMap") === "sky" ? "june-map.html" : "index.html", location.href);
      u.search = location.search;
      u.hash = h.get("selection") || "";
      heading("Map selection", "This record belongs to " + name, "otherMap");
      panel.append(a("Open its map and selection", u.href, "time-button"));
      return;
    }
    if (h.has("missing")) return await missing(h, t);
    if (h.has("native")) {
      const id = realId(h.get("native")),
        record = await nativeSelection(id);
      if (!active(t)) return;
      if (record?.kind === "constant") return await constant(record.id, t);
      if (record?.kind === "written") return await written(record.id, t);
      heading(
        "Original compiled theorem register",
        record?.name || "Compiled theorem directory",
        "native",
        id,
      );
      panel.append(
        a(
          "Open the pinned Original map register",
          route("native", h.get("native"), {}, new URL("index.html?snapshot=" + BASE, location.href)),
          "time-link",
        ),
      );
      return;
    }
    if (h.has("constant")) return await constant(realId(h.get("constant")), t);
    if (h.has("written") || h.has("context") || h.has("theorem")) {
      let id = realId(h.get("written") ?? h.get("context") ?? h.get("theorem"));
      if (h.has("theorem") && id != null) id = await writtenFromAtlas(id);
      if (active(t)) return await written(id, t);
      return;
    }
    if (h.has("proofBundle") || h.has("bundle"))
      return await bundle(h.get("proofBundle") ?? h.get("bundle"), t);
    if (/^a-\d+$/.test(h.get("placement") || "")) return await anchor(h.get("placement"), t);
    if (!sky && (h.has("paper") || h.has("label"))) {
      const which = h.has("paper") ? "paper" : "label",
        id = h.get(which);
      if (which === "paper") {
        const row = realId(id),
          r = row == null ? null : await bridge.paper(row);
        if (!active(t)) return;
        if (!r) {
          heading("Original map paper", "Unknown paper", "absent", id);
          return;
        }
        heading("Original paper · " + r[0], r[1], "paper", id);
        panel.append(node("p", r[2]), a("Read on arXiv", "https://arxiv.org/abs/" + r[0], "time-link"));
        const m = markers.find((x) => x.anchor.original?.row === row);
        anchorLink(m);
      } else {
        const l = await bridge.label(id);
        if (!active(t)) return;
        heading("Original topic region", l?.label || l?.name || id, "label", id);
        if (l?.count != null) panel.append(node("p", fmt(l.count) + " paper rows."));
      }
      return;
    }
    if (h.has("search") || h.has("proofSearch"))
      return await searchRows(h.get("search") ?? h.get("proofSearch"), t);
    for (const k of ["foundation", "unpositioned", "unplaced", "anchorConstants"])
      if (h.has(k)) return await groups(k, h.get(k), t);
    if (h.size) {
      heading("Historical reader", "This view belongs to the published submission", "submission-view");
      panel.append(a("Open the original view at the submission", locationURL(BASE).href, "time-link"));
      return;
    }
    overview(t);
  } catch (e) {
    if (active(t)) {
      failure(e, panel);
      if (inGraph) graphMessage("Graph data unavailable", e.message);
    }
  }
}
export function searchInput(value) {
  if (!handlesSearch()) return false;
  const key = value.trim();
  const target = key ? route(!sky && !historical ? "proofSearch" : "search", key) : route();
  if (location.href !== target) {
    if (hash().has("search") || hash().has("proofSearch")) history.replaceState(null, "", target);
    else history.pushState(null, "", target);
  }
  if (handlesRoute()) restoreTime();
  else window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  return true;
}
let initialized, markersReady;
export function mapSummaryReady() {
  return markersReady;
}
export function keepCamera() {
  refreshEdition();
  return keep?.href === location.href ? keep : null;
}
export function restoreCamera(saved) {
  if (saved && saved.href === location.href) bridge?.restoreCamera(saved.camera);
}
function refreshEdition() {
  if (!bridge || readSearch === location.search) return;
  const before = pin,
    oldTrack = query.get("track");
  readSearch = location.search;
  query = new URLSearchParams(readSearch);
  const wanted = snapshotSelector(query) || BASE;
  if (wanted === before && oldTrack === query.get("track")) {
    syncSwitch();
    return;
  }
  const camera = history.state?.skyCamera || bridge.camera();
  keep = { href: location.href, camera };
  pin = wanted;
  historical = pin !== BASE;
  rev = null;
  stats = null;
  selected = null;
  exactSelection = null;
  preview = null;
  ++restoring;
  for (const m of markers) m.element?.remove();
  markers = [];
  if (popup) popup.hidden = true;
  bridge.clearSelection?.();
  controlsForRevision();
  bridge.redraw();
  startEdition();
}
function startEdition() {
  const token = ++editionToken,
    wanted = pin;
  initialized = (async () => {
    const c = await catalog();
    if (token !== editionToken) return;
    prepareChrome(c);
    syncSwitch();
  })();
  markersReady = initialized.then(() => (token === editionToken && rev ? loadMarkers(wanted, token) : null));
  markersReady.catch((e) => {
    if (token === editionToken) {
      const status = $("time-announce");
      if (status) status.textContent = "Snapshot data unavailable. " + e.message;
    }
  });
}
export function mountTime(api) {
  bridge = api;
  {
    const mapControls=bridge.viewport.parentElement;
    for(const event of ["pointerdown","wheel","keydown"]) {
      mapControls.addEventListener(event,e=>{
        if(sky && !externalEdition(pin))return;
        if(!e.target.closest("#viewport,#zoomIn,#zoomOut,#zoom-in,#zoom-out,#fit"))return;
        if(event==="pointerdown" && e.button!==0)return;
        if(event==="keydown" && !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","+","=","-","Enter"," "].includes(e.key))return;
        cameraGesture++;
      }, {capture:true,passive:true});
    }
  }
  panel = node("div", null, "time-reader");
  panel.id = "time-content";
  panel.tabIndex = -1;
  panel.hidden = true;
  const old = $(sky ? "inspector-content" : "content");
  old.after(panel);
  addLayer(bridge.viewport.parentElement);
  bridge.viewport.addEventListener("keydown", inspectNearest, true);
  $("search").addEventListener(
    "keydown",
    (e) => {
      if (!panelOpen) return;
      if (e.key === "ArrowDown") {
        const first = panel.querySelector(".time-list a");
        if (first) {
          e.preventDefault();
          e.stopImmediatePropagation();
          first.focus();
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        $("search").value = "";
        searchInput("");
      }
    },
    true,
  );
  controlsForRevision();
  if (historical && handlesRoute()) showPanel(true);
  startEdition();
  window.addEventListener("atlas-address-change", () => {
    syncSwitch();
    if (panelOpen !== handlesRoute()) restoreTime();
    else draw();
  });
  window.addEventListener("hashchange", restoreTime);
  window.addEventListener("popstate", restoreTime);
  const other = $("time-switch-other");
  for (const e of ["focus", "pointerdown", "click"]) other.addEventListener(e, syncSwitch);
  $("time-graph").addEventListener("click", () =>
    toggleGraph().catch((e) => {
      $("time-announce").textContent = e.message;
    }),
  );
  restoreTime();
}
export const historicalPin = () => historical;
export const activeHistoricalPin = () => (historical && rev ? pin : null);
export async function actualPlacement(id) {
  return (await placement()).constantPlacement(id, { pin: BASE });
}
export async function addPlacementLinks(host, scope) {
  const wrap = node("p");
  host.append(wrap);
  try {
    const p = await atlas(),
      counts = p.counts?.[scope] || {};
    for (const [key, name] of [
      ["unpositioned", "Unpositioned constants"],
      ["foundation", "Foundational constants"],
    ]) {
      const n = counts[key];
      wrap.append(a(name + (Number.isFinite(n) ? " · " + fmt(n) : ""), route(key, 1), "time-link"));
    }
  } catch (e) {
    wrap.textContent = e.message;
  }
}
export async function originalPaperHit(hit, map) {
  if (hit?.type === "time-node") {
    if (hit.route.kind === "external-written") {
      inspectExternalPoint(hit.route);
      return;
    }
    const { kind, id, sx, sy, count } = hit.route;
    if (count > 1 && map.zoom < 1500 && Number.isFinite(sx) && Number.isFinite(sy)) {
      const p = hit.route.world || map.project(sx, sy);
      map.go(p[0], p[1], Math.min(200000, map.zoom * 4));
      return;
    }
    if (externalEdition(pin) && (kind === "theorem" || kind === "written")) {
      const address = location.href;
      const physical = kind === "theorem" ? await writtenFromAtlas(id) : id;
      const row = physical == null ? null : await (await rec()).snapshotRecord(pin, physical);
      if (location.href === address && row?.present) navigate("written", row.id);
      return;
    }
    if (["theorem", "written", "placement", "proofBundle"].includes(kind)) navigate(kind, id);
    return;
  }
  if (hit?.type === "paper") navigate("paper", hit.row);
  if (hit?.type === "label") navigate("label", hit.l.id);
}

export function inspectExternalPoint(hit) {
  if (!hit || !externalEdition(pin) || hit.pin !== pin) return;
  if (hit.count === 1) {
    navigate("written", hit.id);
    return;
  }
  const maxZoom = sky ? 320 : 1500;
  if (bridge.zoom() < maxZoom) {
    bridge.restoreCamera([...hit.world, Math.min(maxZoom, 4 * bridge.zoom())]);
    return;
  }
  const ticket = restoring;
  exactSelection = { x: hit.world[0], y: hit.world[1], paperLayout: true };
  mapPage(markerFor(hit.marker), fmt(hit.count) + " declarations at this position", async (offset, limit) => {
    const api = await rec();
    const members = hit.members.subarray(offset, offset + limit);
    const cards = await Promise.all(Array.from(members, (i) => api.snapshotRecord(pin, hit.records[i].id)));
    return { total: hit.count, rows: cards.map(recordItem) };
  }, ticket);
  draw();
}

export async function placementCounts(records) {
  const index = await atlas();
  if (
    index.pin !== BASE ||
    index.anchors.length !== records.markers.length ||
    index.anchors.some((a, i) => a.id !== records.markers[i].id)
  )
    throw Error("The enriched anchor register belongs to a different map edition.");
  const counts = Object.fromEntries(
    ["rh", "all"].map((scope) => [
      scope,
      { ...records.counts[scope], unplaced: index.counts[scope].unpositioned },
    ]),
  );
  return {
    ...records,
    counts,
    markers: records.markers.map((m, i) => ({
      ...m,
      constant: index.anchors[i].counts.all.constant,
      rhConstant: index.anchors[i].counts.rh.constant,
    })),
  };
}
export async function originalBasePoint(map, id, atlasId) {
  if (Number.isInteger(atlasId) && map.cat && !map.cat.unplaced[atlasId])
    return { x: map.cat.x[atlasId], y: map.cat.y[atlasId] };
  const ctx = map.contextLayer;
  if (!ctx) return null;
  await ctx.load();
  let lo = 0,
    hi = ctx.row.length;
  while (lo < hi) {
    const i = (lo + hi) >>> 1;
    if (ctx.row[i] < id) lo = i + 1;
    else hi = i;
  }
  return ctx.row[lo] === id ? { x: ctx.x[lo], y: ctx.y[lo] } : null;
}

export function topicMatches(rows, q, kind) {
  const query = String(q).trim().toLowerCase();
  if (!query) return [];
  return rows
    .filter((r) => r.label?.toLowerCase().includes(query))
    .sort((a, b) => a.label.length - b.label.length)
    .map((r) => ({ name: r.label, meta: "Level " + (r.level ?? r.depth), url: route(kind, r.key ?? r.id) }));
}
