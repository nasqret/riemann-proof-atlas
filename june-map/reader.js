/* versioned proof map */
import {bytes as geometryBytes} from "../time-map/original-io.js?atlas=8f96d1aab28fcadc";
import {mountTime, handlesRoute, restoreTime, searchInput, topicMatches, historicalPin, keepCamera, restoreCamera} from "../time-map/sky.js?atlas=8f96d1aab28fcadc";
import {JuneMap} from "./map.js?atlas=8f96d1aab28fcadc";
import {dataURL, paperURL, PaperShards, readBytes, readJSON, readURL} from "./papers.js?atlas=8f96d1aab28fcadc";
import {renderPaletteLegend, indexPalette, paperPaletteTopic} from "./palette.js";
import {createProofReader} from "./nodes.js?atlas=8f96d1aab28fcadc";

const $ = id => document.getElementById(id);
const pane = $("inspector-content"), search = $("search");
const fmt = number => Number(number).toLocaleString("en-US");
const norm = value => String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const cache = new Map(), regionById = new Map(), regionByCode = new Map(), placeById = new Map();
const exampleByRoute = new Map();
let manifest, levels, regionList, placementData, places, papers, map, legend, proof, routeToken = 0, lastAddress;
let browseLevel = 0, browseLimit = 7, timer, noticeTimer, queryTicket = 0, searchWorker, directoryBoot, markerTable;

function element(tag, content, css) {
  const node = document.createElement(tag);
  if (content !== undefined && content !== null) node.textContent = content;
  if (css) node.className = css;
  return node;
}
function link(label, href, css) {
  const a = element("a", label, css);
  a.href = href;
  return a;
}
function button(label, callback, css = "text-button") {
  const node = element("button", label, css);
  node.type = "button"; node.addEventListener("click", callback);
  return node;
}
function details(label, ...children) {
  const d = element("details", null, "inspector-note");
  d.append(element("summary", label), ...children);
  return d;
}
function metricRow(entries) {
  const dl = element("dl", null, "metric-row");
  for (const [key, value] of entries) {
    if (!Number.isFinite(value)) continue;
    const group = element("div"); group.append(element("dt", key), element("dd", fmt(value))); dl.append(group);
  }
  return dl;
}
function itemList() { return element("ul", null, "item-list"); }
function addRow(list, title, hint, action) {
  const li = element("li");
  const row = typeof action === "string" ? link("", action, "item-link") : button("", action, "item-link");
  row.append(element("span", title, "item-name"));
  if (hint) row.append(element("span", hint, "item-count"));
  li.append(row); list.append(li);
  return row;
}
function addMember(list, paper, locate) {
  const li = element("li"); li.className = "member";
  const url = paperURL(paper.id);
  const title = url ? link("", url, "item-link") : element("span", null, "item-link");
  title.append(element("span", paper.title || paper.id, "paper-title"), element("span", paper.id, "paper-id"));
  li.append(title);
  if (locate) li.append(button("On map", () => choose("paper", paper, {focusMap: true})));
  list.append(li);
}
function cached(path) {
  if (!cache.has(path)) cache.set(path, readJSON(path).catch(e => { cache.delete(path); throw e; }));
  return cache.get(path);
}
function explorer(kind, id) { return "index.html#" + new URLSearchParams({[kind]: id}); }
function route(kind, id, extra = {}) {
  const hash = kind ? "#" + new URLSearchParams({[kind]: String(id), ...extra}) : "";
  return location.pathname + location.search + hash;
}
function setAddress(href, replace = false) {
  if (href !== location.pathname + location.search + location.hash) history[replace ? "replaceState" : "pushState"](null, "", href);
  lastAddress = location.href;
  window.dispatchEvent(new Event("atlas-address-change"));
}
function flash(message) {
  clearTimeout(noticeTimer);
  $("map-notice").hidden = false; $("map-notice").textContent = message;
  noticeTimer = setTimeout(() => { $("map-notice").hidden = true; }, 3800);
}
function diagnostic(error) {
  flash(error.message || "Could not read map data.");
  $("reader-status").textContent = error.message || String(error);
}
function begin(clearSearch = true) {
  proof?.clear();
  if (clearSearch) search.value = "";
  document.querySelector(".edition-link").href = "index.html";
  clearTimeout(timer); queryTicket++;
  pane.dataset.state = "loading";
  delete pane.dataset.item; pane.replaceChildren(); pane.scrollTop = 0;
  return ++routeToken;
}
function mobileDetail() {
  if (matchMedia("(max-width:800px)").matches) $("inspector").scrollIntoView({block: "start"});
}
function showMap(focus = true) {
  if (focus) $("viewport").focus({preventScroll: true});
  $("map-panel").scrollIntoView({block: "nearest"});
}
async function copySelection() {
  try {
    await navigator.clipboard.writeText(location.href);
    $("reader-status").textContent = "Link copied.";
    const copy = $("copy-link"); if (copy) copy.textContent = "Link copied";
  } catch {
    const box = element("input");
    box.value = location.href; box.readOnly = true; box.setAttribute("aria-label", "Selection link");
    pane.prepend(box); box.focus(); box.select();
  }
}
function detailNav() {
  const nav = element("div", null, "detail-nav"), copy = button("Copy link", copySelection);
  copy.id = "copy-link"; nav.append(button("Map overview", () => overview(true)), copy); return nav;
}
function viewHeading(kind, name, counts = null) {
  pane.append(detailNav(), element("p", kind, "detail-meta"), element("h2", name));
  if (counts) pane.append(metricRow(counts));
  $("reader-status").textContent = name;
}
function choose(kind, item, options = {}) {
  const id = kind === "region" ? item.key : kind === "paper" ? item.row : item.id;
  const extra = kind === "paper" ? {x: String(item.x), y: String(item.y)} : {};
  setAddress(route(kind, id, extra));
  openItem(kind, item, options);
}
function openItem(kind, item, {focusMap = false, fromMap = false, origin = null} = {}) {
  const token = begin();
  map.select(item);
  if (focusMap) {
    const zoom = kind === "region" ? map.regionZoom(item) : kind === "paper" ? map.pointZoom * 2 : 12;
    map.go(item.x, item.y, zoom);
  } else if (kind === "placement" && fromMap) {
    map.go(item.x, item.y, Math.max(8, map.zoom));
  }
  if (kind === "region") renderRegion(item, token).catch(diagnostic);
  if (kind === "placement") renderPlacement(item, token, origin).catch(diagnostic);
  if (kind === "paper") renderPaper(item, token).catch(diagnostic);
  if (fromMap && kind !== "placement") mobileDetail();
}
function levelTitle(index) {
  const group = levels[index];
  const qualifier = index === 0 ? " · broadest" : index === levels.length - 1 ? " · finest" : "";
  return `Level ${group.level}${qualifier}`;
}
function overview(write = false) {
  begin();
  if (write) setAddress(route());
  map.select(null); map.fit();
  pane.dataset.state = "overview";
  pane.append(element("h2", "Map overview"), element("p", "Select a topic label to read about a region. Select a gold diamond to open a paper’s proof bundles and their Lean declarations."));
  pane.append(metricRow([["topic regions", regionList.length], ["topic levels", levels.length], ["proof anchors in scope", map.placements.length]]));
  if (proof?.available) proof.overview(pane);
  pane.append(element("h3", "Browse regions"));
  const select = element("select"); select.className = "browse-select"; select.setAttribute("aria-label", "Browse regions at topic level");
  levels.forEach((_, i) => { const opt = element("option", levelTitle(i)); opt.value = i; select.append(opt); });
  select.value = browseLevel; pane.append(select);
  const rows = element("div"); pane.append(rows);
  const update = () => {
    const group = levels[browseLevel];
    const list = itemList();
    for (const reg of group.regions.slice(0, browseLimit)) addRow(list, reg.label, fmt(reg.count), () => choose("region", reg, {focusMap: true}));
    rows.replaceChildren(list);
    if (browseLimit < group.regions.length) rows.append(button("More regions", () => { browseLimit += 15; update(); }));
  };
  select.onchange = () => { browseLevel = Number(select.value); browseLimit = 7; update(); };
  update();
  if (map.placements.length) {
    const anchors = itemList();
    const ordered = [...map.placements].sort((a, b) => b.theorems - a.theorems || a.label.localeCompare(b.label));
    for (const p of ordered) addRow(anchors, p.label, p.papers?.[0]?.id || "", () => choose("placement", p, {focusMap: true}));
    pane.append(details("Browse Lean anchors", anchors));
  }
  if (legend) pane.append(renderPaletteLegend(legend, () => map.layers.math, key => {
    const reg = regionById.get(key); if (reg) choose("region", reg, {focusMap: true});
  }));
  const guide = details("Map method and controls",
    element("p", "The background counts papers at their supplied F2LLM coordinates. Each region label sits on a member nearest the region’s mean position. Zoom in to see finer labels and select individual papers."),
    element("p", "Drag or use arrow keys to pan. Scroll, pinch or use plus and minus to zoom. Home fits the map. The crosshair finds papers near the center."),
    link("June edition manifest", dataURL("manifest.json")));
  if (manifest.mathTiles) guide.append(element("p", `The math filter shows ${fmt(manifest.mathTiles.paperCount)} papers with a mathematical primary category. Exact arXiv-ID matches to the historical atlas provide categories for ${fmt(manifest.mathTiles.knownPrimaryCategory)} June rows. Region counts describe the complete June edition.`));
  pane.append(guide);
}
const sourceText = value => Array.isArray(value) ? value.join("\n") : typeof value === "string" ? value : "";
async function renderRegion(reg, token) {
  pane.dataset.state = "region"; pane.dataset.item = reg.key;
  viewHeading("Paper region · level " + reg.level, reg.label, [["paper rows", reg.count]]);
  const tools = element("div", null, "section-tools");
  tools.append(button("Zoom to region", () => { map.go(reg.x, reg.y, map.regionZoom(reg)); showMap(); }, "soft-button"));
  pane.append(tools);
  const section = element("div"); section.append(element("p", "Reading region details…", "muted")); pane.append(section);
  try {
    const part = await cached(reg.detail);
    if (token !== routeToken) return;
    const detail = part[reg.key];
    if (!detail) throw Error("Region details are missing from this edition.");
    section.replaceChildren();
    const candidates = detail.metadata || [];
    if (detail.metadataStatus === "unique" && candidates.length) {
      const summary = sourceText(candidates[0].summaries), explanation = sourceText(candidates[0].explanations);
      if (summary) section.append(element("h3", "Toponymy summary"), element("p", summary, "region-summary"));
      if (explanation) section.append(details("Toponymy explanation", element("p", explanation, "region-summary")));
    } else if (candidates.length) {
      const group = details("Source descriptions for this name",
        element("p", "Toponymy supplies multiple entries with this name at the same topic level. The paper assignments identify the shared name. Each candidate description appears below."));
      for (const candidate of candidates) {
        const s = sourceText(candidate.summaries), e = sourceText(candidate.explanations);
        group.append(element("h3", "Metadata row " + fmt(candidate.sourceRow)));
        if (s) group.append(element("p", s, "region-summary")); if (e) group.append(element("p", e, "region-summary"));
      }
      section.append(group);
    } else section.append(element("p", "The source supplies no description for this label.", "muted"));
    if (detail.representative) {
      section.append(element("h3", "Representative paper"), element("p", "The member nearest this region’s mean map position.", "quiet"));
      const list = itemList(); addMember(list, detail.representative, true); section.append(list);
    }
    const others = (detail.samples || []).filter(p => p.row !== detail.representative?.row);
    if (others.length) {
      const list = itemList(); others.forEach(p => addMember(list, p, true));
      section.append(element("h3", "Sample member papers"), list);
    }
    for (const [key, label] of [["coarser", "Membership at the next broader level"], ["finer", "Membership at the next finer level"]]) {
      const neighbors = detail.adjacent?.[key];
      if (!neighbors?.length) continue;
      const list = itemList();
      for (const n of neighbors) {
        const region = regionById.get(n.key);
        if (region) addRow(list, n.label, fmt(n.count), () => choose("region", region, {focusMap: true}));
        else list.append(element("li", (n.label || "Unlabelled") + " · " + fmt(n.count), "legend-static"));
      }
      section.append(details(label, element("p", "Counts give the papers this region shares with each label."), list));
    }
  } catch (error) {
    if (token === routeToken) section.replaceChildren(element("p", error.message), button("Retry region details", () => openItem("region", reg)));
  }
}

function exampleLink(ex) {
  const section = element("li", null, "example");
  const hash = /^#(?:theorem|context)=\d+$/.test(ex.explorerHash) ? ex.explorerHash : null;
  const name = hash ? link(ex.name, "index.html" + hash, "declaration-name") : element("span", ex.name, "declaration-name");
  section.append(name);
  const info = element("div", null, "example-info");
  if (ex.basis) info.append(element("span", [ex.basisClass, ex.basis].filter(Boolean).join(" · ")));
  if (ex.sourceUrl && /^https:\/\//.test(ex.sourceUrl)) info.append(link("Lean source", ex.sourceUrl));
  if (info.childNodes.length) section.append(info);
  return section;
}
async function renderPlacement(place, token, origin) {
  pane.dataset.state = "placement"; pane.dataset.item = place.id;
  const archived = [["archived theorem rows", place.theorems], ["with direct evidence", place.directEvidenceTheorems], ["archived bundles", place.bundleCount]];
  viewHeading("June paper anchor", place.label, proof?.available ? null : archived);
  if (origin) {
    document.querySelector(".edition-link").href = explorer(origin.kind, origin.id);
    const box = element("div", null, "origin-record");
    if (origin.name) box.append(element("p", origin.name, "declaration-name"));
    box.append(link("Open this " + origin.kind + " in the original Explorer", explorer(origin.kind, origin.id)));
    if (origin.kind === "context" && origin.info)
      box.append(element("p", origin.info.supported ? "Source context supports a suggested topic." : "This source context provides a reading location. Its fine topic remains open.", "quiet"));
    pane.append(box);
  }
  if (proof?.available) {
    const nodes = element("section", null, "proof-at-anchor"); pane.append(nodes);
    if (!historicalPin()) nodes.append(link("Browse graph constants at this paper", route("anchorConstants",place.id), "text-button"));
    proof.placement(nodes, place, origin, token).catch(error => { if (token === routeToken) nodes.append(element("p", error.message)); });
  }
  pane.append(element("p", "The diamond marks the supporting paper’s exact June coordinate. Written declarations share it through a proof bundle or a source-context witness."));
  for (const topic of place.topics || []) {
    const note = topic.anchorNote;
    if (note) pane.append(element("p", note, "muted"));
  }
  if (place.papers?.length) {
    const list = itemList();
    place.papers.forEach(p => addMember(list, {...p, x: place.x, y: place.y}, true));
    pane.append(element("h3", "Supporting papers"), list);
    pane.append(element("p", `June paper row ${fmt(place.papers[0].row)} · x = ${place.x}, y = ${place.y}`, "detail-meta"));
  }
  if (place.examples?.length) {
    const list = itemList();
    for (const example of place.examples) list.append(exampleLink(example));
    pane.append(element("h3", "Declarations in the original Explorer"), list);
  }
  if (proof?.available) pane.append(details("Archived theorem counts", metricRow(archived)));
  if (place.contextSuggested || place.contextOnly) pane.append(details("Contextual placements",
    metricRow([["with a suggested topic", place.contextSuggested], ["context only", place.contextOnly]]),
    element("p", "Context-only records use a source connection for navigation. Their fine topic remains open.")));
  if (place.detail) {
    const box = details("Bundle and placement evidence");
    pane.append(box);
    box.addEventListener("toggle", async () => {
      if (!box.open || box.dataset.loaded) return;
      try {
        const d = await cached(place.detail);
        if (routeToken !== token || box.dataset.loaded) return;
        const bundles = d.bundles || [];
        if (d.basisCounts) {
          const basis = itemList();
          for (const [key, count] of Object.entries(d.basisCounts).sort((a,b) => b[1] - a[1]))
            basis.append(element("li", key + " · " + fmt(count), "legend-static"));
          box.append(element("h3", "Theorem placement evidence"), basis);
        }
        if (d.papers?.length) {
          for (const p of d.papers) {
            const previous = itemList();
            for (const e of p.oldEvidence || []) addRow(previous, e.clusterLabel + " · " + e.relationship, "", explorer("paper", e.oldPaperRow));
            if (previous.childNodes.length) box.append(element("h3", "Archived paper " + p.id), previous);
          }
        }
        if (bundles.length) {
          const list = itemList();
          for (const b of bundles) addRow(list, b.label || b.id, fmt(b.count), explorer("bundle", b.id));
          box.append(element("h3", "Bundles in the original Explorer"), list);
        }
        box.append(link("Open the placement data", dataURL(place.detail)));
        box.dataset.loaded = "true";
      } catch (error) { diagnostic(error); }
    });
  }
}

async function renderPaper(seed, token) {
  pane.dataset.state = "paper"; pane.dataset.item = String(seed.row);
  viewHeading("arXiv paper", seed.title || seed.id);
  const url = paperURL(seed.id);
  if (url) pane.append(link("arXiv " + seed.id, url, "soft-button"));
  pane.append(element("p", "June source row " + fmt(seed.row), "detail-meta"));
  const paper = seed.levels || !papers ? seed : await papers.lookup(seed.row, seed.x, seed.y);
  if (token !== routeToken || !paper) return;
  const colorTopic = paperPaletteTopic(map.topicPalette, paper);
  if (colorTopic) pane.append(element("p", "Map color · " + colorTopic.label + (Number.isInteger(colorTopic.level) ? " · level " + colorTopic.level : ""), "detail-meta"));
  if (paper.category) pane.append(element("p", "Primary category · " + paper.category, "muted"));
  const anchor = places.find(place => place.papers?.some(p => p.row === paper.row));
  if (anchor) pane.append(link("Browse this paper’s proof bundles", route("placement", anchor.id), "soft-button"));
  if (paper.levels) {
    const list = itemList();
    for (const group of levels) {
      const r = regionByCode.get(group.level + "/" + paper.levels[group.level]);
      if (r) addRow(list, r.label, "Level " + group.level, () => choose("region", r, {focusMap: true}));
      else list.append(element("li", "Unlabelled · level " + group.level, "legend-static"));
    }
    pane.append(element("h3", "This paper’s topic labels"), list);
  }
}

function nearby(rows) {
  begin(); map.select(null); setAddress(route());
  pane.dataset.state = "nearby"; pane.append(button("Map overview", () => overview(true)), element("h2", "Papers near the center"));
  if (!rows.length) pane.append(element("p", "No paper in the search radius. Pan toward a denser area and try again."));
  else {
    const list = itemList();
    for (const p of rows) addRow(list, p.title || p.id, "", () => choose("paper", p, {focusMap: true}));
    pane.append(list);
  }
  mobileDetail();
}

const localNames = [];
function score(key, query, parts) {
  if (key === query) return 0;
  if (key.startsWith(query)) return 1;
  if (key.includes(query)) return 2;
  return parts.every(word => key.includes(word)) ? 3 : Infinity;
}
function searchResults(value, write = true) {
  const token = begin(false);
  map.select(null); search.value = value;
  const previous = new URLSearchParams(location.hash.slice(1)).has("search");
  if (write) setAddress(route("search", value), previous);
  const query = norm(value), parts = query.split(/\s+/).filter(Boolean);
  pane.dataset.state = "search"; pane.append(element("h2", "Search results"));
  if (proof?.available) {
    const proofResults = element("section"); pane.append(proofResults);
    timer = setTimeout(() => { if (token === routeToken) proof.search(value, proofResults, token); }, 160);
    pane.append(element("h3", "June regions and paper anchors"));
  }
  const matches = localNames.filter(entry => !proof?.available || entry.kind === "region" ||
    (entry.kind === "placement" && map.placements.includes(entry.item))).map(entry => ({entry, rank: Math.min(score(entry.normal, query, parts),
    entry.alias ? score(entry.alias, query, parts) : Infinity)}))
    .filter(m => Number.isFinite(m.rank)).sort((a,b) => a.rank - b.rank || a.entry.label.length - b.entry.label.length);
  const list = itemList();
  for (const {entry} of matches.slice(0, 36)) {
    if (entry.kind === "name") addRow(list, entry.label, entry.ex.kind === "context" ? "Lean context" : "Lean name", () => openOrigin(entry.ex.kind, entry.ex.row));
    else addRow(list, entry.label, entry.kind === "region" ? "Level " + entry.item.level : "Lean · " + (entry.item.papers?.[0]?.id || "anchor"),
      () => choose(entry.kind, entry.item, {focusMap: true}));
  }
  if (list.childNodes.length) pane.append(list);
  else pane.append(element("p", "No matching region or indexed anchor example.", "muted"));
  const directory = element("div"); pane.append(directory);
  if (!proof?.available && query.length >= 2) {
    directory.append(button("Search the full Lean name index", () => fullSearch(value, directory, token)));
    if (!matches.length || /[_.]/.test(value)) timer = setTimeout(() => fullSearch(value, directory, token), 420);
  }
  const other = element("p"); other.append(link("Search this name in the original Explorer", explorer("search", value)));
  pane.append(other);
}
function oldJSON(path) { return readURL(new URL("data/lean/" + path, document.baseURI).href); }
const nameShards = new Map();
async function fullSearch(value, host, token) {
  if (host.dataset.started || token !== routeToken) return;
  host.dataset.started = "true"; const ticket = ++queryTicket;
  host.replaceChildren(element("p", "Searching the full Lean name index…", "muted"));
  try {
    directoryBoot ??= oldJSON("index.json").catch(e => { directoryBoot = null; throw e; });
    const index = await directoryBoot;
    if (token !== routeToken || ticket !== queryTicket) return;
    searchWorker ??= new Worker(new URL("../search.js", import.meta.url), {type: "module"});
    searchWorker.onerror = () => { if (token === routeToken) host.replaceChildren(link("Open the Lean name index in the original Explorer", explorer("search", value))); };
    searchWorker.onmessage = async ({data}) => {
      if (data.q !== value || token !== routeToken || ticket !== queryTicket) return;
      try {
        if (data.error) throw Error(data.error);
        const ids = [...data.results.slice(0, 20)];
        const names = await Promise.all(ids.map(async id => {
          const shard = Math.floor(id / index.nameStride);
          if (!nameShards.has(shard)) nameShards.set(shard, oldJSON(`names/${shard}.json.gz`).catch(e => { nameShards.delete(shard); throw e; }));
          return (await nameShards.get(shard))[id % index.nameStride];
        }));
        if (token !== routeToken || ticket !== queryTicket) return;
        const list = itemList();
        ids.forEach((id, i) => addRow(list, names[i], "", () => openOrigin("theorem", id)));
        host.replaceChildren(element("h3", `Lean declarations · ${fmt(data.results.length)}`), list);
        if (data.results.length > ids.length) host.append(element("p", "Showing the first " + ids.length + " matches.", "muted"));
      } catch (error) { if (token === routeToken) host.replaceChildren(element("p", error.message)); }
    };
    searchWorker.postMessage({q: value});
  } catch (error) { if (token === routeToken) host.replaceChildren(element("p", error.message)); }
}

async function resolveOrigin(kind, id) {
  if (kind === "theorem" && placementData?.theoremLookup) {
    const lookup = placementData.theoremLookup;
    if (!/^\d+$/.test(id) || Number(id) >= lookup.rows) return null;
    markerTable ??= readBytes(dataURL(lookup.file)).then(raw => {
      if (raw.byteLength !== 2 * lookup.rows) throw Error("The theorem placement index has an unexpected size.");
      return new DataView(raw);
    }).catch(error => { markerTable = null; throw error; });
    const marker = (await markerTable).getUint16(2 * Number(id), true);
    return marker === lookup.missing ? null : {anchor: places[marker]};
  }
  if (placementData?.targetLookup && (kind === "context" || kind === "bundle")) {
    const targets = await cached(placementData.targetLookup);
    const record = kind === "context" ? targets.contexts[id] : null;
    const marker = kind === "bundle" ? targets.bundles[id] : record?.marker;
    return Number.isInteger(marker) && places[marker] ? {anchor: places[marker], name: record?.name, info: record} : null;
  }
  if (exampleByRoute.has(kind + "/" + id)) return {anchor: exampleByRoute.get(kind + "/" + id)};
  return null;
}
async function theoremName(id) {
  directoryBoot ??= oldJSON("index.json").catch(e => { directoryBoot = null; throw e; });
  const index = await directoryBoot, shard = Math.floor(Number(id) / index.nameStride);
  if (!nameShards.has(shard)) nameShards.set(shard, oldJSON(`names/${shard}.json.gz`).catch(e => { nameShards.delete(shard); throw e; }));
  return (await nameShards.get(shard))[Number(id) % index.nameStride];
}
async function openOrigin(kind, id, write = true) {
  const token = begin();
  if (write) setAddress(route(kind, id));
  map.select(null); pane.append(element("p", "Locating this " + kind + " in Paper Sky…"));
  try {
    const [found, name] = await Promise.all([
      resolveOrigin(kind, String(id)),
      kind === "theorem" && /^\d+$/.test(String(id)) && Number(id) < (placementData?.theoremLookup?.rows ?? 0) ? theoremName(id) : null
    ]);
    if (token !== routeToken) return;
    if (found?.anchor) { openItem("placement", found.anchor, {focusMap: true, origin: {kind, id, name: found.name || name, info: found.info}}); return; }
    pane.dataset.state = "unplaced"; pane.replaceChildren();
    document.querySelector(".edition-link").href = explorer(kind, id);
    viewHeading("Original Explorer", "No June paper anchor");
    if (name) pane.append(element("p", name, "declaration-name"));
    pane.append(element("p", kind === "theorem" ? "This theorem has no direct paper transfer in the June edition." : "The June placement index has no paper coordinate for this " + kind + "."),
      link("Open the " + kind + " in the original Explorer", explorer(kind, id), "soft-button"));
    if (proof?.available && kind === "theorem" && /^\d+$/.test(id)) {
      const written = await proof.writtenFromAtlas(Number(id));
      if (token === routeToken && written != null) {
        const section = element("p"); section.append(link("Inspect its written declaration and June context", route("written", written), "text-button")); pane.append(section);
      }
    }
  } catch (error) { if (token === routeToken) pane.replaceChildren(element("p", error.message), link("Open the original record", explorer(kind, id))); }
}
function unknown() {
  begin(); map.select(null); pane.dataset.state = "unknown";
  pane.append(element("h2", "Selection unavailable"), element("p", "This link does not identify a record in the June edition."), button("Map overview", () => overview(true)));
}
async function restore() { const held=keepCamera(); try { return await restoreNative(); } finally { restoreCamera(held); } }
async function restoreNative() {
  if (!map || lastAddress === location.href) return;
  if (handlesRoute()) { lastAddress = location.href; mathLens(new URLSearchParams(location.search).get("papers") === "math", false); return restoreTime(); }
  lastAddress = location.href;
  mathLens(new URLSearchParams(location.search).get("papers") === "math", false);
  if (proof?.available) proof.applyScope();
  const params = new URLSearchParams(location.hash.slice(1));
  const go = {focusMap: true};
  for (const kind of ["written", "constant", "proofBundle", "unplaced"]) if (params.has(kind)) {
    if (proof?.available) return proof.open(kind, params.get(kind), params);
    return unknown();
  }
  if (params.has("region")) { const r = regionById.get(params.get("region")); return r ? openItem("region", r, go) : unknown(); }
  if (params.has("placement")) { const p = placeById.get(params.get("placement")); return p ? openItem("placement", p, go) : unknown(); }
  for (const kind of ["theorem", "context", "bundle"]) if (params.has(kind)) return openOrigin(kind, params.get(kind), false);
  if (params.has("paper")) {
    const token = begin(), row = Number(params.get("paper")), x = Number(params.get("x")), y = Number(params.get("y"));
    if (!papers || !/^\d+$/.test(params.get("paper")) || !params.has("x") || !params.has("y") || !Number.isFinite(x) || !Number.isFinite(y)) return unknown();
    pane.append(element("p", "Locating the June paper row…"));
    try {
      const paper = await papers.lookup(row, x, y);
      if (token === routeToken) return paper ? openItem("paper", paper, go) : unknown();
    } catch (error) { if (token === routeToken) { unknown(); diagnostic(error); } }
    return;
  }
  if (params.get("search")) return searchResults(params.get("search"), false);
  if (params.size) return unknown();
  overview();
}
function mathLens(requested, write = true) {
  const enabled = !!manifest.mathTiles && requested;
  if (map.layers.math !== enabled) map.setLayer("math", enabled);
  $("show-math").checked = enabled;
  document.dispatchEvent(new Event("june-palette-lens"));
  $("paper-key").textContent = enabled ? "Confirmed math" : "Papers";
  $("math-coverage").hidden = !enabled;
  const text = enabled ? fmt(manifest.mathTiles.paperCount) + " papers with a matched primary math category" : "All June papers";
  if (enabled) $("math-coverage").textContent = text + ". The original atlas supplies categories for " + fmt(manifest.mathTiles.knownPrimaryCategory) + " June rows.";
  if (write) {
    const address = new URL(location.href);
    if (enabled) address.searchParams.set("papers", "math"); else address.searchParams.delete("papers");
    setAddress(address.pathname + address.search + address.hash);
    flash(text);
  }
}
async function init() {
  manifest = await readJSON("manifest.json");
  const [regionData, lean, palette] = await Promise.all([cached(manifest.regions), manifest.placements ? cached(manifest.placements) : null,
    manifest.legend ? cached(manifest.legend) : null]);
  legend = palette;
  levels = regionData.levels;
  levels.forEach((group, i) => {
    group.regions.sort((a,b) => b.count - a.count || a.label.localeCompare(b.label));
    for (const r of group.regions) {
      r.level = group.level; regionById.set(r.key, r);
      regionByCode.set(group.level + "/" + r.code, r);
      localNames.push({kind: "region", item: r, label: r.label, normal: norm(r.label)});
    }
    const opt = element("option", levelTitle(i)); opt.value = group.level; $("label-level").append(opt);
  });
  regionList = [...regionById.values()];
  placementData = lean; places = lean?.regions || [];
  places.forEach(place => {
    placeById.set(place.id, place);
    localNames.push({kind: "placement", item: place, label: place.label, normal: norm(place.label)});
    for (const ex of place.examples || []) {
      exampleByRoute.set(ex.kind + "/" + ex.row, place);
      if (ex.kind === "context" && lean.targetLookup) continue;
      localNames.push({kind: "name", item: place, ex, label: ex.name, normal: norm(ex.name)});
    }
  });
  if (lean?.targetLookup) {
    const {contexts} = await cached(lean.targetLookup);
    for (const [row, context] of Object.entries(contexts)) {
      localNames.push({kind: "name", ex: {kind: "context", row}, label: context.name,
        normal: norm(context.name), alias: norm(context.printed)});
    }
  }
  papers = manifest.papers ? new PaperShards(manifest.papers, manifest.world, manifest.categories?.labels,
    async path => JSON.parse(new TextDecoder().decode(await geometryBytes(dataURL(path))))) : null;
  map = new JuneMap($("viewport"), manifest, levels, [], papers, {
    camera(m) {
      const label = m.levels[m.levelIndex]?.level;
      $("scale").textContent = (m.zoom >= 10 ? Math.round(m.zoom) : Number(m.zoom.toFixed(1))) + "×" + (m.layers.labels && label !== undefined ? " · Level " + label : "");
      $("zoom-in").disabled = m.zoom >= 320; $("zoom-out").disabled = m.zoom <= 1;
      $("pick-center").disabled = !m.papers;
    },
    select: (kind, item) => choose(kind, item, {fromMap: true}),
    near: nearby, notice: flash, error: diagnostic
  });
  map.topicPalette = indexPalette(legend);
  proof = createProofReader({map, places, pane, element, link, button, metricRow, viewHeading, route,
    begin, active: token => token === routeToken, showMap});
  try { await proof.initialize(); }
  catch (error) {
    map.placements = []; map.drawSoon();
    $("node-scope").disabled = true; $("node-scope").title = error.message;
    $("reader-status").textContent = "Proof index unavailable. " + error.message;
  }
  $("node-scope").onchange = event => {
    const url = proof.scopeURL(event.target.value);
    setAddress(url); lastAddress = null; restore();
  };
  $("edition-caption").textContent = fmt(manifest.paperCount) + " arXiv paper rows in the F2LLM embedding";
  if (manifest.source?.credit) $("map-credit").textContent = "Paper map by " + manifest.source.credit;
  $("show-lean").disabled = !places.length; $("lean-key").hidden = !places.length;
  $("math-option").hidden = !manifest.mathTiles;
  $("zoom-in").onclick = () => map.zoomAt(1.6); $("zoom-out").onclick = () => map.zoomAt(1 / 1.6);
  $("fit").onclick = () => map.fit(); $("show-map").onclick = () => showMap();
  $("pick-center").onclick = () => map.pick([map.width / 2, map.height / 2], true).catch(diagnostic);
  $("show-math").onchange = event => mathLens(event.target.checked);
  for (const key of ["density", "labels", "lean"]) {
    $("show-" + key).onchange = event => {
      map.setLayer(key, event.target.checked);
      if (key === "lean") $("lean-key").hidden = !event.target.checked || !places.length;
    };
  }
  $("label-level").onchange = e => map.setLayer("level", e.target.value);
  document.addEventListener("pointerdown", e => { if (!$("layers").contains(e.target)) $("layers").open = false; });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && $("layers").open) { $("layers").open = false; $("layers").querySelector("summary").focus(); }
    if (e.key === "/" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.target.closest("input,textarea,select,[contenteditable]")) {
      e.preventDefault(); search.focus();
    }
  });
  mountTime({viewport:map.el, camera:()=>[map.x,map.y,map.zoom],pointerActive:()=>map.pointer.size>0,restoreCamera:([x,y,z])=>map.go(x,y,z),clearSelection:()=>{map.select(null);proof?.clear();},zoom:()=>map.zoom, width:()=>map.width, height:()=>map.height, redraw:()=>map.drawSoon(), visible:()=>map.layers.lean,
    topicSearch:q=>topicMatches(regionList,q,"region"),screen:(x,y)=>map.screen(x,y),go:(x,y)=>map.go(x,y,Math.max(8,Math.min(32,map.zoom)))});
  search.disabled = false;
  search.oninput = () => {
    if (searchInput(search.value)) return;
    const value = search.value.trim();
    if (value) searchResults(value); else overview(true);
  };
  search.onkeydown = e => {
    if (historicalPin() && e.key === "Escape") { e.preventDefault(); search.value = ""; searchInput(""); return; }
    if (e.key === "Escape") { e.preventDefault(); if (search.value) overview(true); else search.blur(); }
    if (e.key === "ArrowDown") { const first = pane.querySelector(".item-link"); if (first) { e.preventDefault(); first.focus(); } }
  };
  window.addEventListener("hashchange", restore); window.addEventListener("popstate", restore);
  $("map-notice").hidden = true; document.body.dataset.ready = "true";
  await restore();
}
init().catch(error => {
  $("map-notice").textContent = "The June edition could not be loaded.";
  pane.replaceChildren(element("h2", "Map data unavailable"), element("p", error.message),
    button("Retry", () => location.reload(), "soft-button"), element("p"), link("Original Explorer", "index.html"));
});
