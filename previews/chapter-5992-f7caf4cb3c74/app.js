import { methodText } from "./attribution.js";
import { Catalog, json, fmt, scopePass, merc } from "./data.js";
import { AtlasMap } from "./map.js";
import { NativeLayer } from "./native-layer.js";
import { nativeDetail, openNative } from "./native.js";
import { mountScreen } from "./screen.js";
import { readingLinks } from "./links.js";
const $ = (s) => document.querySelector(s),
  pane = $("#content"),
  panel = $("#panel"),
  search = $("#search");
const paperURL = "https://lmcinnes.github.io/datamapplot_examples/arXiv/";
const screenMode = mountScreen($("#fullScreen"), $("#inspectToggle"), panel);
const shortRoots = [
  "Classical RH",
  "Explicit zeta",
  "Dirichlet half-plane",
  "Dirichlet strip",
  "Primitive strip",
];
const longRoots = [
  "Classical Riemann hypothesis",
  "Zeros of the zeta function",
  "Dirichlet nonvanishing right of one half",
  "Dirichlet zeros in the open strip",
  "Primitive Dirichlet zeros in the open strip",
];
const cat = new Catalog();
let ready = false,
  active = { mode: "overview" },
  worker,
  timer,
  renderToken = 0,
  scope = "all",
  subject = "";
const perPage = 14;
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function add(parent, ...children) {
  for (const c of children.flat())
    if (c !== null && c !== undefined) parent.append(c);
  return parent;
}
function button(label, fn, cls = "quiet") {
  const b = el("button", label, cls);
  b.type = "button";
  b.onclick = () => Promise.resolve(fn()).catch(showError);
  return b;
}
function link(label, url, cls = "") {
  const a = el("a", label, cls);
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}
function para(t, cls = "") {
  return el("p", t, cls);
}
function heading(t, cls = "") {
  return el("h2", t, cls);
}
function small(t) {
  return el("span", t, "meta");
}
function sub(t) {
  return el("h3", t);
}
function actions(...items) {
  return add(el("div", null, "actions"), ...items);
}
function tag(color) {
  const d = el("i", null, "topicDot");
  d.style.backgroundColor = color;
  return d;
}
function item(t, s, fn) {
  const b = button("", fn, "listItem");
  return add(b, el("strong", t), s ? el("small", s) : null);
}
function plural(n, one, many = one + "s") {
  return fmt(n) + " " + (n === 1 ? one : many);
}
function warn(message) {
  const e = $("#mapMessage");
  e.textContent = message;
  e.hidden = false;
}
function showError(e) {
  warn(e?.message || String(e));
  console.error(e);
}
function back(label = "Explorer overview") {
  return button(label, () => reset(), "back");
}
function jumpPanel() {
  if (screenMode.active) {
    screenMode.openInspector();
    panel.scrollTop = 0;
  } else if (getComputedStyle(panel).overflowY === "visible")
    panel.scrollIntoView({ block: "start" });
  else panel.scrollTop = 0;
}
function stats(pairs) {
  const wrap = el("div", null, "stats");
  for (const [value, label] of pairs)
    add(wrap, add(el("div"), el("strong", fmt(value)), small(label)));
  return wrap;
}
function primaryLink(record, lines = [record.line, record.line]) {
  return (
    cat.index.sourceBase +
    record.file.split("/").map(encodeURIComponent).join("/") +
    "#L" +
    lines[0] + (lines[1] > lines[0] ? "-L" + lines[1] : "")
  );
}
function copyLink() {
  return button("Copy link", async () => {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      const s = $("#copyStatus");
      if (s) s.textContent = "Link copied.";
    } catch {
      openDialog("Link to this selection", para(url));
    }
  });
}
const copyOutcomes = {
  "one-native-candidate-compatible-at-tested-fields":
    "Only this physical proof matches the distinguishing fields of the exported proof.",
  "ruled-out-by-exported-proof-field":
    "The exported proof has a distinguishing field that rules out this physical proof.",
  "one-native-alpha-equivalence-class-compatible":
    "The compatible physical proofs agree up to renaming bound variables. Their terms do not distinguish a source owner.",
  "name-absent-from-export":
    "This name has no declaring entry in the Main export.",
};
const sharedEvidence = () => json("data/shared-sources.json.gz");
async function sharedCounts() {
  const a = await sharedEvidence();
  const table = el("div");
  for (let i = 0; i < shortRoots.length; i++)
    add(
      table,
      item(
        longRoots[i],
        fmt(a.distinct.value_mask.by_endpoint[i]) +
          " distinct written names reached via proof values",
        () => {
          $("#dialog").close();
          return navigatePoint(cat.index.roots[i].row, true);
        },
      ),
    );
  const example = a.sites.find(
    (s) =>
      s.proof_field_status ===
      "one-native-candidate-compatible-at-tested-fields",
  );
  openDialog(
    "Repeated source names",
    para(
      fmt(a.written) +
        " written theorem and lemma commands supply " +
        fmt(a.named) +
        " distinct Lean names. The point-layer counts refer to source locations. This table counts each name once.",
    ),
    table,
    sub("Comparing physical proofs"),
    para(
      "The frozen point index leaves 268 repeated-name occurrences outside its endpoint totals. Comparing the original objects and exported fields identifies 61 sole matching candidates and rules out 63 other physical proofs. In 100 occurrences the compatible proofs agree up to bound-variable renaming. The remaining 44 sites have names absent from the export.",
    ),
    item("Inspect a compared proof", example.kernel, () => {
      $("#dialog").close();
      return navigatePoint(example.row, true);
    }),
    link(
      "Read the source-copy evidence",
      readingLinks.copies,
    ),
  );
}
async function addCopyEvidence(out, r) {
  const a = await sharedEvidence(),
    here = a.sites.find((s) => s.id === r.id);
  if (!here) return;
  add(
    out,
    sub("Physical source-copy audit"),
    para(copyOutcomes[here.proof_field_status], "note"),
  );
  if (here.exported_name_id !== null)
    add(
      out,
      para(
        "Endpoint membership of the shared name · " +
          readMask(here.name_masks[0]),
        "small",
      ),
    );
  for (const copy of a.sites.filter(
    (s) => s.kernel === here.kernel && s.id !== here.id,
  )) {
    add(
      out,
      item("Compare the other source occurrence", copy.module, () =>
        navigatePoint(copy.row, true),
      ),
    );
  }
  add(out, actions(button("See counts by distinct name", sharedCounts)));
}
function readMask(mask) {
  if (mask === 255 || mask === null || mask === undefined)
    return "No joined export entry";
  if (mask === 0) return "Outside all five endpoint closures";
  return shortRoots.filter((s, i) => mask & (1 << i)).join(" · ");
}
const nativeLayer = new NativeLayer();
const map = new AtlasMap(
  (hit, event) => handleHit(hit, event).catch(showError),
  warn,
);
let readerPromise, restoredAddress;
function getReader() {
  return readerPromise ??= import("./chapter-reader.js").then(({ ChapterReader }) => new ChapterReader(cat, map)).catch((error) => {
    readerPromise = undefined;
    throw error;
  });
}
function clearChapterLayer() {
  map.chapterLayer?.detach();
}
function writeHash(mode, id) {
  const h = new URLSearchParams();
  if (mode && mode !== "overview") h.set(mode, String(id));
  if (scope !== "all") h.set("scope", scope);
  if (map.evidence !== "mask") h.set("evidence", map.evidence);
  if (subject) h.set("subject", subject);
  if (map.placement !== "all") h.set("placement", map.placement);
  const s = h.toString();
  const next = location.pathname + location.search + (s ? "#" + s : "");
  if (next !== location.pathname + location.search + location.hash)
    history.pushState(null, "", next);
  restoredAddress = location.href;
}
function syncFilters() {
  scope = $("#scope").value;
  subject = $("#subject").value;
  map.evidence = $("#evidence").value;
  map.placement = $("#placement").value;
  map.setFilters(scope, subject);
}
function reset({ hash = true, fit = false } = {}) {
  clearChapterLayer();
  search.value = "";
  active = { mode: "overview" };
  renderToken++;
  map.filterBundle = null;
  map.selected = null;
  nativeLayer.selected = null;
  map.edges = [];
  map.setScene(subject === "unresolved");
  if (fit) map.fit();
  map.drawSoon();
  if (hash) writeHash("overview", "");
  overview();
}
function showBrowse(view) {
  clearChapterLayer();
  search.value = "";
  active = view;
}
function fitFiltered() {
  if (subject === "unresolved") {
    map.fit();
    return;
  }
  const matches = [];
  for (let b = 0; b < cat.bundles.length; b++)
    if (
      (!subject || cat.bundles[b].category === subject) &&
      cat.bundles[b].category !== "unresolved" &&
      map.counts[b]
    ) {
      const first = cat.members[b].find((i) => map.pass(i));
      if (first !== undefined) matches.push(first);
    }
  if (matches.length) map.frame(matches, 35);
  else map.fit();
}
function changeFilter(newSubject = null) {
  if (newSubject !== null) $("#subject").value = newSubject;
  syncFilters();
  reset({ hash: true });
  fitFiltered();
}
function filteredCategories() {
  const totals = new Map();
  for (let b = 0; b < cat.bundles.length; b++) {
    const code = cat.bundles[b].category;
    totals.set(code, (totals.get(code) || 0) + map.counts[b]);
  }
  return Array.from(totals)
    .filter(([, n]) => n)
    .sort((a, b) => b[1] - a[1]);
}
function overview() {
  if (!ready) return;
  const k = ++renderToken;
  active = { mode: "overview" };
  const frame = document.createDocumentFragment();
  const selected = subject ? cat.categories.get(subject) : null;
  add(
    frame,
    heading(selected ? selected.label : "Proof geography"),
    para(
      selected
        ? subject === "unresolved"
          ? "Each group is an exact section of the Lean source tree. Select a section to inspect declarations whose mathematical subject is still open."
          : "Explore this subject’s proof bundles and their positions among arXiv papers."
        : "Follow a theorem from its mathematical neighborhood to the Lean code and the endpoints that depend on it.",
      "intro",
    ),
  );
  const ranked = filteredCategories(),
    bs = map.counts.reduce((n, v) => n + Number(v > 0), 0);
  add(
    frame,
    stats([
      [map.matched, "source theorems & lemmas"],
      [bs, "proof bundles"],
    ]),
  );
  const unplaced = ranked.find(([c]) => c === "unresolved")?.[1] || 0;
  if (!selected)
    add(
      frame,
      para(
        fmt(map.matched - unplaced) +
          " at an arXiv subject or context · " +
          fmt(unplaced) +
          " indexed by source section.",
        "small",
      ),
    );
  if (map.placement !== "all")
    add(frame, para("Placement evidence · " + $("#placement").selectedOptions[0].textContent, "small"));
  if (scope !== "all")
    add(
      frame,
      para(
        "Dependency evidence · " +
          {
            mask: "all exported references",
            termMask: "types and values",
            valueMask: "values only",
          }[map.evidence],
        "small",
      ),
    );
  if (!selected)
    add(
      frame,
      actions(
        button(
          "Explore classical RH",
          () => {
            $("#scope").value = "1";
            $("#subject").value = "";
            syncFilters();
            return navigatePoint(cat.index.roots[0].row, true);
          },
          "primary",
        ),
        button("Fit Lean layer", fitFiltered),
        button("Browse bundles", () => bundleList(null)),
        link("Daily snapshots and removals", "../../daily.html"),
        link("Compare source editions", "../../editions.html"),
        link("Read structured proofs", "../../structured.html"),
      ),
    );
  else
    add(
      frame,
      actions(
        button("Browse these bundles", () => bundleList(null), "primary"),
        button("All subjects", () => changeFilter("")),
      ),
    );
  if (!selected) {
    add(frame, sub("Mathematical subjects"));
    const subjects = ranked.filter(([c]) => c !== "unresolved");
    const cap = subjects.length ? subjects[0][1] : 1;
    const showSubject = ([code, n]) => {
      const c = cat.categories.get(code);
      const btn = button("", () => changeFilter(code), "subjectRow");
      add(btn, tag(c.color), el("span", c.label), el("small", fmt(n)));
      const meter = el("div", null, "meter"),
        fill = el("i");
      fill.style.width = (100 * n) / cap + "%";
      fill.style.backgroundColor = c.color;
      meter.append(fill);
      return add(el("div"), btn, meter);
    };
    for (const entry of subjects.slice(0, 6)) add(frame, showSubject(entry));
    if (subjects.length > 6) {
      const d = el("details"),
        s = el("summary", "All " + subjects.length + " subjects", "small");
      add(d, s, ...subjects.slice(6).map(showSubject));
      add(frame, d);
    }
    const un = ranked.find(([c]) => c === "unresolved");
    if (un)
      add(
        frame,
        item(
          "Browse source sections",
          fmt(un[1]) + " declarations indexed by their Lean source section",
          () => changeFilter("unresolved"),
        ),
      );
  } else {
    const list = cat.bundles
      .map((b, i) => [b, i])
      .filter(([b, i]) => b.category === subject && map.counts[i])
      .sort((a, b) => map.counts[b[1]] - map.counts[a[1]]);
    add(frame, sub("Largest bundles"));
    for (const [b, i] of list.slice(0, 8))
      add(
        frame,
        item(b.label, plural(map.counts[i], "declaration"), () =>
          navigateBundle(i),
        ),
      );
  }
  add(
    frame,
    actions(
      button("Reading routes", readingRoutes),
      button("Compiled theorem directory", () => nativePanel()),
      button("Count repeated names", sharedCounts),
    ),
  );
  add(frame, sub("Five proof endpoints"));
  for (const [i, r] of cat.index.roots.entries())
    add(
      frame,
      item(longRoots[i], r.name, () => navigatePoint(r.row, true)),
    );
  add(
    frame,
    para(
      "At wide scales, a ring groups nearby declarations. Zoom in or open a bundle to select individual dots.",
      "small",
    ),
  );
  if (k === renderToken) pane.replaceChildren(frame);
}
function startSelection(view, hashKey, key, write) {
  showBrowse(view);
  if (write) writeHash(hashKey, key);
  jumpPanel();
  const ticket = ++renderToken;
  pane.replaceChildren(back(), para("Loading the selection…", "small"));
  return ticket;
}
async function rowsPage(host, ids, options = {}) {
  const { offset = 0, metadata = null, onPage = null } = options;
  const visible = ids.slice(offset, offset + perPage),
    data = await Promise.all(Array.from(visible, (i) => cat.record(i)));
  const frag = document.createDocumentFragment();
  if (!ids.length) {
    add(frag, para("No declarations meet the current filters.", "empty"));
  }
  for (let j = 0; j < visible.length; j++) {
    const i = visible[j],
      r = data[j];
    add(
      frag,
      item(
        r.name,
        metadata ? metadata(i, r) : r.module + " · line " + r.line,
        () => navigatePoint(i, false),
      ),
    );
  }
  if (ids.length > perPage) {
    const p = actions();
    if (offset > 0)
      add(
        p,
        button("Previous", () => onPage(Math.max(0, offset - perPage))),
      );
    add(
      p,
      small(
        fmt(offset + 1) +
          "–" +
          fmt(Math.min(offset + perPage, ids.length)) +
          " of " +
          fmt(ids.length),
      ),
    );
    if (offset + perPage < ids.length)
      add(
        p,
        button("Next", () => onPage(offset + perPage)),
      );
    add(frag, p);
  }
  host.replaceChildren(frag);
}
function collection(host, ids, metadata) {
  let serial = 0;
  const go = async (off) => {
    const j = ++serial,
      inner = el("div");
    await rowsPage(inner, ids, { offset: off, metadata, onPage: go });
    if (j === serial) host.replaceChildren(inner);
  };
  go(0).catch(showError);
}
function bundleList(list = null, title = "Proof bundles") {
  showBrowse({ mode: "bundles" });
  renderToken++;
  writeHash("bundles", "all");
  jumpPanel();
  map.selected = null;
  const ids = (list || cat.bundles.map((_, i) => i))
    .filter((i) => map.counts[i] > 0)
    .sort((a, b) => map.counts[b] - map.counts[a]);
  const container = el("div");
  pane.replaceChildren(
    back(),
    heading(title),
    para(plural(ids.length, "bundle") + " in the current selection.", "small"),
    container,
  );
  const q = el("input");
  q.type = "search";
  q.placeholder = "Filter bundle names";
  q.setAttribute("aria-label", "Filter bundle names");
  q.className = "bundleSearch";
  container.before(q);
  function render(off = 0) {
    const term = q.value.toLowerCase(),
      rows = ids.filter((i) =>
        cat.bundles[i].label.toLowerCase().includes(term),
      );
    container.replaceChildren();
    for (const i of rows.slice(off, off + perPage)) {
      const b = cat.bundles[i];
      add(
        container,
        item(
          b.label,
          cat.categories.get(b.category).label +
            " · " +
            plural(map.counts[i], "declaration"),
          () => navigateBundle(i),
        ),
      );
    }
    if (!rows.length) add(container, para("No matching bundle.", "empty"));
    if (rows.length > perPage) {
      const bar = actions();
      if (off)
        add(
          bar,
          button("Previous", () => render(off - perPage)),
        );
      add(
        bar,
        small(
          fmt(off + 1) +
            "–" +
            fmt(Math.min(off + perPage, rows.length)) +
            " of " +
            fmt(rows.length),
        ),
      );
      if (off + perPage < rows.length)
        add(
          bar,
          button("Next", () => render(off + perPage)),
        );
      add(container, bar);
    }
  }
  q.oninput = () => render();
  render();
}
function showLabel(label) {
  if (!label) return;
  map.selected = null;
  map.drawSoon();
  const ticket = startSelection(
    { mode: "label", id: label.id },
    "label",
    label.id,
    true,
  );
  const out = add(
    document.createDocumentFragment(),
    back(),
    small("arXiv topic · level " + label.depth),
    heading(label.label),
    para(
      "Published center (" +
        label.x.toFixed(3) +
        ", " +
        label.y.toFixed(3) +
        ").",
      "small",
    ),
  );
  const parts = [];
  let n = label;
  for (let t = 0; t < 10 && n; t++) {
    if (n.label && parts[0] !== n.label) parts.unshift(n.label);
    n = map.labelById.get(n.parent);
  }
  if (parts.length > 1) add(out, para(parts.join(" › "), "note"));
  if (label.examples?.length) {
    add(out, sub("Papers at this location"));
    for (const p of label.examples) add(out, paperExample(p));
  }
  const ids = [];
  for (let i = 0; i < cat.bundles.length; i++)
    if (cat.bundles[i].anchor === label.id && map.counts[i]) ids.push(i);
  if (ids.length)
    add(
      out,
      actions(
        button(
          "Explore " + plural(ids.length, "Lean bundle"),
          () => bundleList(ids, "Bundles at this topic"),
          "primary",
        ),
      ),
    );
  else
    add(
      out,
      para(
        "No Lean bundles anchor directly to this label under the current filters.",
        "small",
      ),
    );
  add(
    out,
    actions(
      button("Center on this topic", () => {
        map.setScene(false);
        map.go(label.x, merc(label.y), Math.max(map.zoom, 8));
      }),
    ),
  );
  if (ticket === renderToken) pane.replaceChildren(out);
}
function paperExample(p) {
  return add(
    el("div", null, "listItem"),
    link(p.title, "https://arxiv.org/abs/" + p.id),
    el(
      "small",
      p.id +
        " · " +
        p.category +
        " · " +
        (p.relationship === "upstream_cluster_member"
          ? "original cluster member"
          : "geographic neighbor"),
    ),
  );
}
async function showPaper(row, write = true) {
  const ticket = startSelection(
      { mode: "paper", id: row },
      "paper",
      row,
      write,
    ),
    meta = map.base.paper_metadata;
  const ar = await json(
    "data/base/" +
      meta.template.replace("{part}", Math.floor(row / meta.rows_per_shard)),
  );
  const [id, title, category] = ar[row % meta.rows_per_shard];
  if (ticket === renderToken)
    pane.replaceChildren(
      back(),
      small("Original arXiv paper"),
      heading(title),
      para(id + " · " + category, "small"),
      actions(
        link("Read on arXiv", "https://arxiv.org/abs/" + id, "extlink"),
        copyLink(),
      ),
      el("span", null, "meta"),
    );
}
function explainGeo(b) {
  const label = b.anchor && map.labelById?.get(b.anchor),
    topic = cat.topic.get(b.topic);
  const block = el("section", null, "section");
  add(block, sub("arXiv neighborhood"));
  if (!label) {
    add(
      block,
      para(
        "Its source section is known. The available evidence leaves the arXiv subject open.",
        "note",
      ),
    );
    return block;
  }
  if (topic?.anchorNote) add(block, para(topic.anchorNote, "note"));
  add(
    block,
    para(topic?.label || b.label),
    item(
      label.label,
      "Original map label · " + label.x.toFixed(3) + ", " + label.y.toFixed(3),
      () => showLabel(label),
    ),
  );
  if (label.examples?.length) add(block, paperExample(label.examples[0]));
  return block;
}
function fitEdges() {
  const hold = map.filterBundle;
  map.filterBundle = null;
  const ids = [...new Set(map.edges.flatMap(([a, b]) => [a, b]))].filter(
    (i) => Boolean(cat.unplaced[i]) === map.unplaced && map.pass(i),
  );
  if (ids.length) map.frame(ids, 900);
  map.filterBundle = hold;
  map.drawSoon();
}
function edgeName(bits) {
  return [
    [1, "type"],
    [2, "proof / value"],
    [4, "kernel metadata"],
  ]
    .filter(([b]) => bits & b)
    .map(([, n]) => n)
    .join(" + ");
}
function aboutConfidence(code) {
  return (
    {
      high: "High",
      medium: "Medium",
      low: "Low",
      unresolved: "Unplaced",
      reviewed: "Reviewed",
      none: "Unplaced",
    }[code] || code
  );
}
function basisName(s) {
  return methodText[s] || String(s || "")
    .replaceAll("-", " ")
    .replaceAll("_", " ");
}
function includePoint(i) {
  let changed = false;
  const b = cat.bundles[cat.bundle[i]];
  if (subject && subject !== b.category) {
    $("#subject").value = "";
    changed = true;
  }
  if (!scopePass(cat[map.evidence][i], scope)) {
    $("#scope").value = "all";
    changed = true;
  }
  if (!map.placementPass(i)) { $("#placement").value = "all"; changed = true; }
  if (changed) syncFilters();
  if (map.filterBundle !== null && map.filterBundle !== cat.bundle[i])
    map.filterBundle = null;
  $("#lean").checked = true;
  map.show.lean = true;
}
async function navigatePoint(i, frame = true, write = true) {
  if (!Number.isInteger(i) || i < 0 || i >= cat.index.count)
    throw Error("Unknown theorem identifier");
  includePoint(i);
  nativeLayer.selected = null;
  map.edges = [];
  const view = { mode: "theorem", id: i };
  const ticket = startSelection(view, "theorem", i, write);
  if (frame || map.selected !== i) {
    map.gotoPoint(i);
  } else {
    map.selected = i;
    map.drawSoon();
  }
  const [r, adj, reading, readerInfo] = await Promise.all([
    cat.record(i),
    cat.neighbors(i),
    cat.reading(),
    getReader().then((reader) => reader.inspect(i)),
  ]);
  if (ticket !== renderToken) return;
  map.edges = [
    ...adj[0].slice(0, 16).map(([j, k]) => [i, j, k]),
    ...adj[1].slice(0, 8).map(([j, k]) => [j, i, k]),
  ];
  map.drawSoon();
  const b = cat.bundles[cat.bundle[i]],
    c = cat.categories.get(b.category),
    mask = cat.mask[i];
  const out = document.createDocumentFragment();
  const { reader, chapter, range } = readerInfo;
  const lines = Array.isArray(range) ? range : [r.line, range > 0 ? range : r.line];
  add(
    out,
    reader.theoremTrail(r, i, readerInfo),
    add(
      el("div", null, "label"),
      tag(c.color),
      c.label + " · " + cat.index.keywords[cat.kind[i]],
    ),
    reader.declarationTitle(r.name),
    para(r.module + " · " + (lines[1] > lines[0] ? "lines " + lines.join("–") : "line " + lines[0]) + ", column " + r.col, "meta"),
    actions(link("Open Lean source", primaryLink(r, lines), "extlink"), copyLink()),
  );
  if (!range || range === -1) add(out, para(range === -1 ? "Several ledger commands share this source position. The link marks the recorded start." : "The ledger has no verified end for this source position. The link marks the recorded start.", "small"));
  const copied = el("span", null, "meta");
  copied.id = "copyStatus";
  add(out, copied);
  if (r.signature) add(out, reader.inspectorSource(r, readerInfo));
  if (chapter) add(out, reader.theoremReading(r, readerInfo));
  const rev = r.review.map((id) => reading.nodes[id]).filter(Boolean);
  for (const n of rev) {
    if (n.contract) add(out, sub("Mathematical statement"), para(n.contract));
    if (n.idea) add(out, sub("Proof idea"), para(n.idea));
  }
  add(
    out,
    sub("Endpoint use"),
    para(readMask(mask), mask === 0 || mask === 255 ? "note" : ""),
  );
  if (mask === 255) {
    await addCopyEvidence(out, r);
    if (ticket !== renderToken) return;
  }
  if (mask > 0 && mask !== 255)
    add(
      out,
      para(
        "The checked export links this declaration transitively to the named endpoints. The closure follows types, proof values and kernel support.",
        "small",
      ),
    );
  if (cat.index.paths && mask > 0 && mask !== 255) {
    const targets = el("select");
    targets.className = "witnessSelect";
    targets.setAttribute("aria-label", "Choose witness endpoint");
    for (let bit = 0; bit < 5; bit++)
      if (mask & (1 << bit)) {
        const o = el("option", shortRoots[bit]);
        o.value = bit;
        targets.append(o);
      }
    if (Number(scope) > 0 && mask & Number(scope))
      targets.value = Math.log2(Number(scope));
    const trace = button("Trace full graph path", async () => {
      trace.disabled = true;
      trace.textContent = "Reading proof path…";
      try {
        const nodes = await cat.witness(r.kernelId, Number(targets.value)),
          list = el("ol", null, "routeList");
        for (const [name, row, kind] of nodes) {
          const entry = el("li");
          if (Number.isInteger(row))
            add(
              entry,
              button(
                name,
                () => {
                  $("#dialog").close();
                  return navigatePoint(row, true);
                },
                "pathButton",
              ),
            );
          else add(entry, el("code", name), small(" · exported " + kind));
          list.append(entry);
        }
        openDialog(
          "Dependency path",
          para(
            plural(nodes.length - 1, "direct edge") +
              " from " +
              nodes[0][0] +
              " to this declaration in the full export. Each step follows a type, value or kernel-support reference.",
            "small",
          ),
          list,
        );
      } finally {
        trace.disabled = false;
        trace.textContent = "Trace full graph path";
      }
    });
    add(out, actions(targets, trace));
  }
  const d = el("details");
  add(
    d,
    el("summary", "Export identity and reachability", "small"),
    para(
      (r.kernelId == null && r.kernel
        ? "Original object, absent from the Main export · "
        : "Joined declaration · ") +
        (r.kernel || "unresolved") +
        " (" +
        basisName(r.match) +
        ")",
      "small",
    ),
    para("Type and value references · " + readMask(r.termMask), "small"),
    para("Value-only references · " + readMask(r.valueMask), "small"),
  );
  if (r.frontierMask)
    add(
      d,
      para(
        "The export also mentions this name in support metadata for " +
          readMask(r.frontierMask) +
          ". It has no standalone exported declaration.",
        "small",
      ),
    );
  add(
    out,
    d,
    sub("Proof bundle"),
    item(b.label, plural(b.count, "source declaration"), () =>
      navigateBundle(cat.bundle[i]),
    ),
  );
  const tabs = el("div", null, "tabline"),
    near = el("div"),
    neighbors = [adj[0], adj[1]];
  function setTab(k) {
    tabs
      .querySelectorAll("button")
      .forEach((a, j) => a.setAttribute("aria-pressed", String(j === k)));
    const edges = neighbors[k],
      kinds = new Map(edges);
    near.replaceChildren();
    if (!edges.length) {
      near.append(
        para(
          "No direct edge to another indexed source theorem in this direction.",
          "small",
        ),
      );
      return;
    }
    collection(
      near,
      edges.map((a) => a[0]),
      (id, rec) => edgeName(kinds.get(id)) + " · " + rec.module,
    );
  }
  add(
    tabs,
    button("Uses (" + fmt(adj[0].length) + ")", () => setTab(0), "chip"),
    button("Used by (" + fmt(adj[1].length) + ")", () => setTab(1), "chip"),
  );
  add(out, sub("Direct theorem dependencies"), tabs, near);
  setTab(0);
  if (map.edges.length)
    add(
      out,
      actions(button("Fit proof links", () => fitEdges())),
      para(
        "Map lines point from a consumer to a dependency. Solid lines include value references. Dashed lines show other direct references. Up to 24 links are drawn.",
        "small",
      ),
    );
  if (rev.length) {
    const call = reading.edges.filter(
      (e) =>
        r.review.includes(e.from) &&
        ["calls", "component"].includes(e.relation),
    );
    if (call.length) {
      add(out, sub("Reading blueprint"));
      for (const e of call) {
        const n = reading.nodes[e.to];
        if (!n) continue;
        if (Number.isInteger(n.row))
          add(
            out,
            item(n.title, n.name + " · " + e.relation, () =>
              navigatePoint(n.row, true),
            ),
          );
        else if (n.url)
          add(out, link(n.title, n.url), para(n.name || e.token, "small"));
      }
    }
  }
  add(
    out,
    explainGeo({ ...b, anchor: r.anchor ?? b.anchor, topic: r.topic }),
    sub("Placement evidence"),
    para(
      aboutConfidence(cat.index.confidences[cat.conf[i]]) +
        " · " +
        basisName(cat.index.bases[cat.basis[i]]),
      "small",
    ),
  );
  if (r.family) add(out, para("Source section · " + r.family, "small"));
  if (r.terms?.length)
    add(
      out,
      add(el("div", null, "pills"), ...r.terms.map((t) => el("span", t))),
    );
  add(out, actions(button("Read the method", method)), small(r.id));
  if (ticket === renderToken) pane.replaceChildren(out);
}
async function navigateBundle(i, write = true) {
  if (!Number.isInteger(i) || i < 0 || i >= cat.bundles.length)
    throw Error("Unknown proof bundle");
  const b = cat.bundles[i],
    c = cat.categories.get(b.category);
  if (subject && subject !== b.category) {
    $("#subject").value = "";
    syncFilters();
  }
  map.filterBundle = i;
  map.selected = null;
  map.edges = [];
  map.setScene(b.category === "unresolved");
  map.show.lean = true;
  $("#lean").checked = true;
  const ids = cat.members[i].filter((id) => map.pass(id));
  if (ids.length) map.frame(ids);
  const ticket = startSelection(
    { mode: "bundle", id: i },
    "bundle",
    b.id,
    write,
  );
  const out = add(
    document.createDocumentFragment(),
    back(),
    add(el("div", null, "label"), tag(c.color), c.label + " · proof bundle"),
    heading(b.label),
    para(
      plural(ids.length, "declaration") +
        " in the current scope, " +
        fmt(b.count) +
        " in the whole project.",
      "small",
    ),
  );
  add(
    out,
    actions(
      button("Show nearby bundles", () => {
        map.filterBundle = null;
        map.zoomAt(0.5, map.width / 2, map.height / 2);
        bundleList(null);
      }),
      copyLink(),
    ),
  );
  if (b.family) add(out, para("Source section · " + b.family, "small"));
  if (b.basis)
    add(out, para("Grouping evidence · " + basisName(b.basis), "note"));
  add(out, sub("Member theorems"));
  const members = el("div");
  add(out, members);
  collection(members, ids);
  add(out, explainGeo(b));
  const edges = await cat.proofLinks();
  if (ticket !== renderToken) return;
  const related = edges
    .filter((e) => e[0] === i || e[1] === i)
    .sort((a, b) => b[2] - a[2]);
  map.edges = related.slice(0, 16).map((e) => e[3]);
  map.drawSoon();
  if (map.edges.length)
    add(out, actions(button("Fit bundle connections", fitEdges)));
  add(out, sub("Connections to other bundles"));
  if (!related.length)
    add(
      out,
      para(
        "The index contains no direct source-theorem edge to a different bundle.",
        "small",
      ),
    );
  else {
    const show = el("div");
    add(out, show);
    const draw = (off) => {
      show.replaceChildren();
      for (const e of related.slice(off, off + 6)) {
        const peer = e[0] === i ? e[1] : e[0],
          [from, to, kind] = e[3];
        add(
          show,
          item(
            cat.bundles[peer].label,
            (e[0] === i ? "Uses" : "Used by") +
              " · " +
              plural(e[2], "direct edge"),
            () => navigateBundle(peer),
          ),
          button(
            "Inspect witness · " + edgeName(kind),
            () => edgeWitness(from, to, kind),
            "back",
          ),
        );
      }
      if (off || off + 6 < related.length) {
        const row = actions();
        if (off)
          add(
            row,
            button("Previous links", () => draw(off - 6)),
          );
        if (off + 6 < related.length)
          add(
            row,
            button("More links", () => draw(off + 6)),
          );
        add(show, row);
      }
    };
    draw(0);
  }
  pane.replaceChildren(out);
}
async function edgeWitness(i, j, k) {
  const [a, b] = await Promise.all([cat.record(i), cat.record(j)]);
  openDialog(
    "Direct declaration edge",
    para(edgeName(k), "small"),
    para("The first declaration refers to the second in the checked export."),
    item(a.name, a.module + " · " + a.line, () => {
      $("#dialog").close();
      return navigatePoint(i, true);
    }),
    item(b.name, b.module + " · " + b.line, () => {
      $("#dialog").close();
      return navigatePoint(j, true);
    }),
  );
}
async function handleHit(h, e) {
  if (!ready) return;
  if (h.type === "native") {
    if (h.ids.length === 1) {
      await nativePanel(nativeLayer.data.id[h.ids[0]], true, false);
      return;
    }
    showBrowse({ mode: "native-group" });
    const ticket = ++renderToken,
      list = el("div");
    pane.replaceChildren(
      back(),
      heading("Nearby native theorems"),
      para(
        plural(h.count, "source-addressable declaration") + " at this scale.",
        "small",
      ),
      list,
    );
    jumpPanel();
    async function show(off) {
      const ids = h.ids.slice(off, off + perPage),
        rows = await Promise.all(
          Array.from(ids, (i) => nativeDetail(nativeLayer.data.id[i])),
        );
      if (ticket !== renderToken) return;
      list.replaceChildren();
      rows.forEach((r) =>
        add(
          list,
          item(r.kernel, r.module + " · " + basisName(r.sourceBasis), () =>
            nativePanel(r.id, true, true),
          ),
        ),
      );
      const bar = actions();
      if (off)
        add(
          bar,
          button("Previous", () => show(off - perPage)),
        );
      if (off + perPage < h.ids.length)
        add(
          bar,
          button("Next", () => show(off + perPage)),
        );
      add(list, bar);
    }
    await show(0);
    return;
  }
  if (h.type === "label") {
    showLabel(h.l);
    return;
  }
  if (h.type === "paper") {
    await showPaper(h.row);
    return;
  }
  if (h.type === "bundles") {
    if (h.ids.length === 1) await navigateBundle(h.ids[0]);
    else bundleList(h.ids, "Bundles at this location");
    return;
  }
  if (h.ids.length === 1) {
    if (e.metaKey || e.ctrlKey) {
      const id = h.ids[0];
      const [r, { range }] = await Promise.all([cat.record(id), getReader().then((reader) => reader.inspect(id))]);
      location.assign(primaryLink(r, Array.isArray(range) ? range : [r.line, range > 0 ? range : r.line]));
      return;
    }
    await navigatePoint(h.ids[0], false);
    return;
  }
  showBrowse({ mode: "nearby" });
  renderToken++;
  const hold = el("div"),
    ids = h.ids;
  pane.replaceChildren(
    back(),
    heading("Nearby declarations"),
    para(plural(ids.length, "dot") + " overlap at this scale.", "small"),
    actions(
      button("Zoom to these dots", () => map.frame(ids, 200000), "primary"),
    ),
    hold,
  );
  collection(hold, ids);
  jumpPanel();
}
async function enableNative() {
  const check = $("#generated");
  map.show.generated = check.checked;
  if (check.checked) {
    check.disabled = true;
    try {
      await nativeLayer.load();
      map.nativeLayer = nativeLayer;
    } finally {
      check.disabled = false;
    }
  }
  map.drawSoon();
}
async function locateNative(d) {
  if (d.written !== null && d.written !== undefined)
    return navigatePoint(d.written, true);
  const ticket = renderToken;
  $("#generated").checked = true;
  await enableNative();
  if (ticket !== renderToken || !map.show.generated) return;
  const i = nativeLayer.indexOf(d.id);
  if (i < 0) return;
  const n = nativeLayer.data;
  if (subject && subject !== n.index.topics[n.topic[i]].category)
    $("#subject").value = "";
  if (!scopePass(n[map.evidence][i], scope)) $("#scope").value = "all";
  if (!nativeLayer.placementPass(i, map)) $("#placement").value = "all";
  syncFilters();
  nativeLayer.locate(map, d.id);
}
async function nativePanel(id, write = true, locate = false) {
  map.selected = null;
  map.edges = [];
  map.filterBundle = null;
  const ticket = startSelection(
    { mode: "native", id },
    "native",
    id ?? "directory",
    write,
  );
  const content = el("div");
  pane.replaceChildren(back(), content);
  await openNative(content, {
    id,
    primary: (i) => navigatePoint(i, true),
    native: (i) => nativePanel(i),
    locate: (d) => locateNative(d).catch(showError),
    isCurrent: () => ticket === renderToken,
  });
  if (id !== undefined && locate && ticket === renderToken)
    await locateNative(await nativeDetail(id));
}
async function readingRoutes() {
  const reading = await cat.reading();
  const entries = reading.itineraries || [];
  openDialog(
    "Guided reading routes",
    para(
      "Each route follows one mathematical question through the reviewed blueprint. Source links include supporting definitions and propositions.",
    ),
    ...entries.map((route) => {
      const group = el("details");
      add(group, el("summary", route.title), para(route.question, "small"));
      for (const key of route.nodes) {
        const n = reading.nodes[key];
        if (!n) continue;
        if (Number.isInteger(n.row))
          add(
            group,
            item(n.title, n.name, () => {
              $("#dialog").close();
              return navigatePoint(n.row, true);
            }),
          );
        else if (n.url) add(group, add(el("p"), link(n.title, n.url)));
      }
      return group;
    }),
  );
}
function openDialog(title, ...children) {
  $("#dialogBody").replaceChildren(heading(title), ...children);
  if (!$("#dialog").open) $("#dialog").showModal();
}
function method() {
  openDialog(
    "Reading the map",
    sub("The paper layer"),
    para(
      "Each paper keeps the position and color from Leland McInnes’s UMAP of arXiv papers. The overview accumulates every paper into density tiles. At high zoom, individual papers are drawn from their original coordinates. Click a paper to open its arXiv record.",
    ),
    sub("Where a Lean dot belongs"),
    para(
      "Original Lean types, proof references, written identifiers and reviewed blueprint passages supply subject evidence. An attribution marked as namespace or module context describes the surrounding mathematics. Source sections without a supported paper-map anchor open in their own index. Each inspector shows the assignment basis and the matched terms. Small offsets separate declarations near a topic. Proximity describes a reading assignment. Logical dependencies have separate evidence from the export.",
    ),
    sub("Which theorems the proof uses"),
    para(
      "Choose one of the five endpoints under Proof scope. The checked export supplies direct references from types, proof values and kernel support, including intermediate definitions, generated constants and imported library declarations. A zero mask means the joined declaration is outside all five closures. An unmatched source identity has its own filter.",
    ),
    sub("How accurate are the subjects?"),
    para(
      "Eleven of twelve mathematical controls agreed with the review assignment. A finite-group character lemma in an Artin-conductor file inherited a low-confidence number-theory label. You can inspect the evidence directly.",
    ),
    link(
      "Read the controls and the counterexample",
      readingLinks.controls,
    ),
    sub("Reading bundles"),
    para(
      "A bundle groups related statements for reading. Its member list opens the individual declarations. Connections between bundles have named witnesses in the export. The inspector distinguishes references through a type, a value and kernel metadata.",
    ),
    sub("Navigation"),
    para(
      "Drag to pan. Scroll or pinch to zoom. Use / to focus search, the arrow keys to pan a focused map and Home to restore the original paper view. Select a dot, then use Open Lean source. Unplaced declarations appear in a separate index.",
    ),
    link(
      "Data, classification rules and verification",
      readingLinks.data,
    ),
  );
}
function sources() {
  openDialog(
    "Sources and evidence",
    sub("Original arXiv data map"),
    para(
      "The atlas uses the published paper coordinates, color hierarchy, labels and local paper records.",
    ),
    link("Open the original map", paperURL),
    para(
      "Map data revision · 551adb0d3c54a11eaec0d64874370f435b8cc195",
      "small",
    ),
    sub("Lean formalization"),
    para(
      "The source overlay indexes explicit theorem and lemma commands in the supplied 175,187 Lean modules. The export also contains imported Mathlib, core declarations and compiler-generated names. These can mediate a proof dependency.",
    ),
    link(
      "Open the pinned Lean source",
      "https://github.com/leanprover-community/riemann-hypothesis/tree/40e56bab026552e089d7afcfeff08d2defb9c005/src",
    ),
    sub("Project reading materials"),
    actions(
      link("Reading dashboard", readingLinks.dashboard),
      link(
        "Theorem blueprint",
        readingLinks.blueprint,
      ),
      link(
        "Mathematical findings",
        readingLinks.findings,
      ),
      link("Coverage and build receipts", readingLinks.data),
    ),
  );
}
function doSearch() {
  const q = search.value.trim();
  if (!ready) return;
  if (!q) {
    reset({ hash: true });
    return;
  }
  clearChapterLayer();
  map.filterBundle = null;
  map.selected = null;
  map.drawSoon();
  active = { mode: "search" };
  renderToken++;
  writeHash("search", q);
  pane.replaceChildren(
    heading("Theorem search"),
    para("Searching the full source index…", "small"),
  );
  if (!worker) {
    worker = new Worker("search.js", { type: "module" });
    worker.onerror = () =>
      showError(Error("Could not load the search worker."));
    worker.onmessage = ({ data }) => {
      if (search.value.trim() !== data.q) return;
      if (data.error) {
        showError(Error(data.error));
        return;
      }
      const found = data.results.filter((i) => map.pass(i));
      const list = el("div");
      pane.replaceChildren(
        back(),
        heading("Theorem search"),
        para(
          plural(found.length, "match", "matches") +
            " for “" +
            data.q +
            "” in this scope.",
          "small",
        ),
        list,
      );
      collection(list, found);
    };
  }
  worker.postMessage({ q });
}
async function restore() {
  if (!ready) return;
  restoredAddress = location.href;
  const h = new URLSearchParams(location.hash.slice(1));
  const sc = h.get("scope") || "all",
    su = h.get("subject") || "";
  $("#evidence").value = ["termMask", "valueMask"].includes(h.get("evidence"))
    ? h.get("evidence")
    : "mask";
  $("#scope").value = Array.from($("#scope").options).some(
    (x) => x.value === sc,
  )
    ? sc
    : "all";
  $("#subject").value = cat.categories.has(su) ? su : "";
  $("#placement").value = ["direct", "context"].includes(h.get("placement")) ? h.get("placement") : "all";
  syncFilters();
  const chapterRoute = ["proof", "chapter", "component", "statement"].find((key) => h.has(key));
  if (chapterRoute) {
    await showReaderAddress(h, chapterRoute);
  } else if (h.has("theorem") && /^\d+$/.test(h.get("theorem")) && Number(h.get("theorem")) < cat.index.count)
    await navigatePoint(Number(h.get("theorem")), true, false);
  else if (h.has("native"))
    await nativePanel(
      h.get("native") === "directory" ? undefined : Number(h.get("native")),
      false,
      false,
    );
  else if (h.get("bundle") === "unplaced") changeFilter("unresolved");
  else if (h.has("bundle") && cat.bundleMap.has(h.get("bundle")))
    await navigateBundle(cat.bundleMap.get(h.get("bundle")), false);
  else if (h.has("label") && map.labelById.has(h.get("label"))) {
    const l = map.labelById.get(h.get("label"));
    map.go(l.x, merc(l.y), 12);
    showLabel(l);
  } else if (h.has("paper")) await showPaper(Number(h.get("paper")), false);
  else if (h.has("search")) {
    search.value = h.get("search");
    doSearch();
  } else if (h.has("bundles")) bundleList(null);
  else if ([...h.keys()].some((key) => !["scope", "subject", "evidence", "placement"].includes(key))) {
    await showReaderAddress(h, "unknown");
  }
  else {
    reset({ hash: false, fit: true });
    if (subject) fitFiltered();
  }
}
async function showReaderAddress(params, route) {
  const ticket = ++renderToken;
  active = { mode: "reader" };
  search.value = "";
  map.selected = null;
  map.edges = [];
  map.filterBundle = null;
  nativeLayer.selected = null;
  jumpPanel();
  try {
    const reader = await getReader();
    if (ticket === renderToken) await reader.open(route, params, pane, () => ticket === renderToken);
  } catch (error) {
    if (ticket !== renderToken) return;
    clearChapterLayer();
    pane.replaceChildren(back(), heading("Reading unavailable"), para(error.message, "warn"),
      button("Try again", () => showReaderAddress(params, route), "primary"));
  }
}
$("#layersBtn").onclick = () => {
  const b = $("#layersPanel");
  b.hidden = !b.hidden;
  $("#layersBtn").setAttribute("aria-expanded", String(!b.hidden));
};
for (const id of ["papers", "lean", "labels", "relations"])
  $("#" + id).onchange = (e) => {
    map.show[id] = e.target.checked;
    map.drawSoon();
  };
document.addEventListener("click", (e) => {
  if (!e.target.closest(".layerwrap")) {
    $("#layersPanel").hidden = true;
    $("#layersBtn").setAttribute("aria-expanded", "false");
  }
});
$("#zoomIn").onclick = () => map.zoomAt(1.75, map.width / 2, map.height / 2);
$("#zoomOut").onclick = () =>
  map.zoomAt(1 / 1.75, map.width / 2, map.height / 2);
$("#fit").onclick = () => {
  map.filterBundle = null;
  map.fit();
  map.drawSoon();
};
$("#generated").onchange = () => enableNative().catch(showError);
$("#scope").onchange = () => changeFilter();
$("#subject").onchange = () => changeFilter();
$("#evidence").onchange = () => changeFilter();
$("#placement").onchange = () => changeFilter();
function returnToOrigin() {
  if (!ready) return;
  clearTimeout(timer);
  $("#evidence").value = "mask";
  $("#placement").value = "all";
  $("#scope").value = "all";
  $("#subject").value = "";
  for (const id of ["papers", "lean", "labels", "relations", "generated"]) {
    const enabled = id !== "generated";
    $("#" + id).checked = enabled;
    map.show[id] = enabled;
  }
  $("#layersPanel").hidden = true;
  $("#layersBtn").setAttribute("aria-expanded", "false");
  $("#tip").hidden = true;
  screenMode.home();
  map.size();
  syncFilters();
  reset({ fit: true });
  panel.scrollTop = 0;
  window.scrollTo(0, 0);
}
$("#origin").onclick = returnToOrigin;
$("#home").onclick = returnToOrigin;
$("#method").onclick = method;
$("#sources").onclick = sources;
$("#closeDialog").onclick = () => $("#dialog").close();
$("#dialog").addEventListener("click", (e) => {
  if (e.target === $("#dialog")) $("#dialog").close();
});
search.oninput = () => {
  clearTimeout(timer);
  timer = setTimeout(doSearch, 150);
};
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const editing = e.target.matches("input,textarea,select,[contenteditable=true]");
  if (e.key.toLowerCase() === "f" && !editing && !e.repeat && !$("#dialog").open) {
    e.preventDefault();
    screenMode.toggle();
  }
  if (
    e.key === "/" &&
    !$("#dialog").open &&
    e.target !== search &&
    !editing
  ) {
    e.preventDefault();
    screenMode.openInspector();
    search.focus();
  }
  if (e.key === "Escape") {
    if (screenMode.active && $("#layersPanel").hidden && !$("#dialog").open) {
      e.preventDefault();
      screenMode.toggle();
    }
    $("#layersPanel").hidden = true;
    $("#layersBtn").setAttribute("aria-expanded", "false");
  }
});
function restoreAddress() {
  if (location.href !== restoredAddress) restore().catch(showError);
}
window.addEventListener("popstate", restoreAddress);
window.addEventListener("hashchange", restoreAddress);
document.querySelector(".skip-reader").addEventListener("click", (event) => {
  event.preventDefault();
  jumpPanel();
  pane.focus();
});
(async () => {
  try {
    await Promise.all([map.baseLoad(), cat.load()]);
    for (const c of cat.index.categories.filter(
      (c) => cat.index.categoryCounts[c.id],
    )) {
      const o = el("option", c.label);
      o.value = c.id;
      $("#subject").append(o);
    }
    map.setCatalog(cat);
    ready = true;
    $("#origin").disabled = false;
    $("#scope").disabled = false;
    $("#subject").disabled = false;
    $("#nativeLayer").hidden = false;
    $("#mapMessage").hidden = true;
    await restore();
    map.size();
    map.draw();
    document.body.dataset.ready = "true";
  } catch (e) {
    showError(e);
    pane.replaceChildren(
      heading("Atlas data unavailable"),
      para(e.message, "warn"),
      button("Reload atlas", () => location.reload(), "primary"),
    );
  }
})();
