import { bytes, json } from "../io.js";
import { Placements, ordinalOf, routes } from "./placements.js";

const modes = new Map([["all", "All contextual placements"], ["suggested", "Suggested topics"],
  ["remaining", "Subject open"], ["remaining-theorems", "Subject open · theorems and lemmas"],
  ["theorems", "Written theorems and lemmas"], ["directory", "Source directory only"]]);
const titles = ["Direct Lean reference", "Same Lean file", "Same proof unit", "Same source directory"];
const fmt = n => n.toLocaleString("en-US");
const $ = id => document.getElementById(id);
function elem(tag, text, cls) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function anchor(label, href, cls) {
  const a = elem("a", label, cls);
  a.href = href;
  return a;
}
function selectButton(label, fn) {
  const b = elem("button", label, "quiet");
  b.type = "button"; b.onclick = fn;
  return b;
}
function status(text) { return elem("p", text, "small"); }
function leanName(text) {
  const fragment = document.createDocumentFragment();
  for (const part of text.split(/(?<=[._])/)) {
    fragment.append(part, document.createElement("wbr"));
  }
  return fragment;
}
function group(...items) { const n = elem("div", null, "actions"); n.append(...items); return n; }
function crumb() { return anchor("Contextual placements", "#contexts=all", "back"); }
function rowLink(label, row) { return anchor(label, "#context=" + row, "context-row"); }

export class ContextExplorer {
  constructor(cat, map, hooks) {
    this.cat = cat; this.map = map; this.hooks = hooks;
    this.guideOnly = document.body.dataset.contextCohort === "rubinstein-v2";
    this.data = new Placements(cat);
    this.data.scopePass = hooks.scopePass;
    map.contextLayer = this.data;
  }

  mount() {
    const field = elem("label", null, "context-toggle"), checkbox = document.createElement("input");
    checkbox.type = "checkbox"; checkbox.id = "contextToggle"; checkbox.checked = true;
    field.append(checkbox, this.guideOnly ? " Contextual dots from the guide" : " Contextual placements");
    const browse = anchor(this.guideOnly ? "Browse the guide’s contextual dots" : "Browse placements", "#contexts=all", "context-browse");
    const native = $("nativeLayer");
    native.before(field, browse);
    this.toggle = checkbox;
    const legend = elem("span", null, "layerkey context-key");
    legend.id = "contextLegend"; legend.append(elem("i"), " Context");
    $("mapbarBottom").append(legend); this.legend = legend;
    const label = document.querySelector('label[for="search"]');
    if (label) label.textContent = "Find a Lean declaration";
    const change = () => {
      this.data.enabled = checkbox.checked;
      legend.hidden = !checkbox.checked;
      if (checkbox.checked) this.load().catch(this.hooks.error);
      this.map.drawSoon();
    };
    checkbox.onchange = change;
    // The main map paints without waiting for this independent layer.
    this.load().catch(error => { if (this.data.enabled) this.hooks.error(error); });
  }

  async load() {
    await this.data.load();
    this.map.drawSoon();
  }

  enable() {
    this.data.enabled = true;
    if (this.toggle) this.toggle.checked = true;
    if (this.legend) this.legend.hidden = false;
  }

  home() {
    this.enable(); this.data.mode = "all"; this.clear();
  }

  clear() {
    if (this.data.selected !== -1) { this.data.selected = -1; this.map.drawSoon(); }
  }

  async search(query, target, current) {
    this.data.mode = "all";
    this.map.drawSoon();
    target.replaceChildren(status("Looking up contextual placements…"));
    try {
      const ids = await this.data.names(query);
      if (!current()) return;
      const match = ids.map(id => ordinalOf(this.data.row, id)).filter(i => i >= 0 && this.data.pass(i, this.map, this.hooks.scopePass));
      const list = elem("div");
      target.replaceChildren(elem("h3", "Contextual placements"), status(fmt(match.length) + " matching names in this scope."), list);
      if (match.length) await this.list(list, match, 0, current);
    } catch (error) {
      if (current()) target.replaceChildren(status(error.message), selectButton("Retry placement search", () => this.search(query, target, current)));
    }
  }

  async list(host, ids, offset, current) {
    const page = Array.from(ids.slice(offset, offset + 12));
    const records = await Promise.all(page.map(i => this.data.record(i)));
    if (!current()) return;
    const fragment = document.createDocumentFragment();
    records.forEach((r, j) => {
      const i = page[j], mark = this.data.supported[i] ? "Suggested topic" : "Subject open";
      const a = rowLink("", r.row);
      a.append(elem("strong", r.name || "Unnamed " + r.kind), elem("small", [r.kind, titles[this.data.route[i]], mark].join(" · ")));
      fragment.append(a);
    });
    const pager = group();
    if (offset > 0) pager.append(selectButton("Previous", () => this.list(host, ids, offset-12, current).catch(this.hooks.error)));
    if (ids.length > 12) pager.append(status(fmt(offset+1) + "–" + fmt(offset+page.length) + " of " + fmt(ids.length)));
    if (offset+12 < ids.length) pager.append(selectButton("Next", () => this.list(host, ids, offset+12, current).catch(this.hooks.error)));
    host.replaceChildren(fragment, pager);
  }

  include(i) {
    const d = this.data, m = this.map;
    this.enable();
    const category = this.cat.index.categories[d.category[i]].id;
    if ($("subject").value && $("subject").value !== category) $("subject").value = "";
    if ($("placement").value === "direct") $("placement").value = "all";
    const mask = m.evidence === "termMask" ? d.masks[2*i] : m.evidence === "valueMask" ? d.masks[2*i+1] : d.mask[i];
    if (!this.hooks.scopePass(mask, $("scope").value)) $("scope").value = "all";
    if (!d.visibleInMode(i, d.mode)) d.mode = "all";
    if (m.scope !== $("scope").value || m.subject !== $("subject").value || m.placement !== $("placement").value)
      this.hooks.sync();
    m.filterBundle = null;
    m.setScene(false);
    d.selected = i;
    m.go(d.x[i], d.y[i], Math.max(115, m.zoom));
  }

  async open(row, write = true) {
    const {map:m, data:d, hooks:h} = this;
    const ticket = h.begin({mode:"context", id:row}, "context", row, write);
    await d.load();
    if (!h.current(ticket)) return;
    const i = ordinalOf(d.row, row);
    if (!Number.isSafeInteger(row) || i < 0) {
      h.pane.replaceChildren(crumb(), elem("h2", "Unknown placement"), status("This source row is outside the contextual register."));
      return;
    }
    this.include(i); m.selected = null; m.edges = [];
    const r = await d.record(i);
    if (!h.current(ticket)) return;
    const supported = Boolean(d.supported[i]), route = d.route[i];
    const state = supported ? "Suggested topic" : "Subject open";
    const caseCard = this.guideOnly ? null : await this.caseReading(row);
    if (!h.current(ticket)) return;
    const card = elem("section", null, "context-evidence");
    card.append(elem("p", state, "context-state" + (supported ? " suggested" : "")),
      elem("h3", supported ? r.topic : "Placed by context"));
    const relation = route === 0 ? ({uses:"This declaration refers to", "used-by":"This declaration is referenced by",
      both:"This declaration shares references in both directions with"}[r.relation] || "A Lean type or proof connects this declaration to") :
      ["", "A mapped declaration in the same file is", "A mapped declaration in the same proof unit is",
        "A mapped declaration in the same source directory is"][route];
    const evidence = elem("p");
    const anchorLink = anchor("", "#theorem=" + d.anchor[i]);
    anchorLink.append(leanName(r.anchorName));
    evidence.append(relation + " ", anchorLink, ".");
    card.append(evidence);
    if (supported) card.append(status("The mapped reference neighbors and the surrounding file or proof unit favor this topic."));
    else card.append(status("The anchor lies in “" + r.topic + "”. The declaration’s own fine-grained topic is open."));
    const first = r.lines[0], last = r.lines[1];
    const source = anchor("Open Lean source", h.sourceURL({file:r.file, line:first}, r.lines), "extlink");
    source.target = "_blank"; source.rel = "noopener";
    const actions = group(source, anchor("Open map anchor", "#theorem=" + d.anchor[i], "context-action"));
    if (d.theorem[i] >= 0) actions.append(anchor("Full theorem record", "#theorem=" + d.theorem[i], "context-action"));
    const byline = r.unit == null ? r.kind : [r.kind, "Proof unit " + r.unit].join(" · ");
    const pieces = [crumb(), elem("p", byline, "meta"),
      elem("h2", r.name.split(".").at(-1) || "Unnamed " + r.kind, "context-name")];
    if (r.name.includes(".")) {
      const qualified = elem("p", null, "meta context-qualified");
      qualified.append(leanName(r.name)); pieces.push(qualified);
    }
    pieces.push(card);
    if (caseCard) pieces.push(caseCard);
    if (r.readingStop) {
      const fragment = new URLSearchParams({page: String(r.readingStop.page), cite: r.readingStop.id});
      actions.append(anchor("Read this citation on page " + r.readingStop.page, "rubinstein.html#" + fragment, "context-action"));
    }
    pieces.push(actions, elem("p", r.file + " · " + (last > first ? "lines " + first + "–" + last : "line " + first), "meta context-path"));
    h.pane.replaceChildren(...pieces);
  }

  async caseReading(row) {
    if (row !== 523078 && row !== 786138) return null;
    const notes = await json("context/source-readings.json");
    if (notes.sourcePin !== this.cat.index.sourcePin) throw Error("The source reading uses a different edition.");
    const note = notes.entries[row];
    const section = elem("section", null, "context-source-note");
    section.append(elem("h3", "What the definition says"), elem("p", note.reading));
    const links = group();
    for (const item of note.sources) {
      const a = anchor(item.title, this.hooks.sourceURL({file:item.file, line:item.lines[0]}, item.lines), "context-action");
      a.target = "_blank"; a.rel = "noopener"; links.append(a);
    }
    links.append(anchor("Related prime-sum argument", "#theorem=" + note.related, "context-action"));
    section.append(links);
    return section;
  }

  async browse(mode, write = true) {
    const {data:d, hooks:h} = this;
    if (!modes.has(mode)) mode = "all";
    const ticket = h.begin({mode:"contexts", id:mode}, "contexts", mode, write);
    await d.load();
    if (!h.current(ticket)) return;
    this.enable(); d.mode = mode; this.map.selected = null; this.map.edges = []; this.map.filterBundle = null;
    if (this.map.unplaced || this.map.placement === "direct") {
      if (this.map.unplaced) $("subject").value = "";
      if (this.map.placement === "direct") $("placement").value = "all";
      h.sync();
    }
    this.map.setScene(false); this.map.drawSoon();
    const choose = elem("select");
    choose.id = "contextKind";
    for (const [value, label] of modes) choose.add(new Option(label, value));
    choose.value = mode;
    choose.onchange = () => this.browse(choose.value, true).catch(h.error);
    const filter = elem("label", "Show ", "context-filter"); filter.append(choose);
    const ids = [], routeCounts = [0,0,0,0];
    for (let i=0; i<d.row.length; i++) {
      if (d.pass(i, this.map, h.scopePass)) { ids.push(i); routeCounts[d.route[i]]++; }
    }
    const list = elem("div"), count = fmt(ids.length);
    const openSubjects = mode === "remaining" || mode === "remaining-theorems";
    const intro = openSubjects ? "These declarations have a mapped source or reference neighbor. Their own mathematical topic remains open." :
      mode === "suggested" ? "Here the mapped reference neighbors and the surrounding proof unit or file agree on a topic." :
      "An outlined marker opens the declaration and the evidence linking it to an existing dot. A gold center marks a suggested topic.";
    const overview = [anchor("Explorer overview", "#", "back"), elem("h2", this.guideOnly ? "Contextual dots in Rubinstein’s guide" : "Contextual placements"),
      elem("p", intro, "intro"), filter, status(count + " declarations in this view.")];
    if (openSubjects) {
      const counts = elem("dl", null, "context-counts");
      titles.forEach((label, i) => counts.append(elem("dt",label), elem("dd",fmt(routeCounts[i]))));
      overview.push(counts);
    }
    h.pane.replaceChildren(...overview, list);
    if (ids.length) await this.list(list, ids, 0, () => h.current(ticket));
  }

  async hit(marker) {
    if (marker.count === 1) return this.open(this.data.row[marker.i]);
    const {hooks:h, data:d} = this;
    const key = d.row[marker.i], ticket = h.begin({mode:"context-group"}, "context", key, false);
    const ids = marker.members.slice(), list = elem("div"), map = this.map;
    const zoom = selectButton("Zoom to this group", () => map.go(d.x[marker.i], d.y[marker.i], map.zoom * 3));
    h.pane.replaceChildren(crumb(), elem("h2", "Nearby contextual placements"), status(fmt(ids.length) + " declarations at this scale."),
      group(zoom, rowLink("Open the marker’s declaration", key)), list);
    await this.list(list, ids, 0, () => h.current(ticket));
  }

  async original(theorem, host, current) {
    if (!this.cat.unplaced[theorem]) return;
    await this.data.load();
    if (!current()) return;
    const i = this.data.fromTheorem.get(theorem);
    if (i === undefined) return;
    const link = rowLink("Open contextual placement", this.data.row[i]);
    link.className = "context-action";
    host.replaceChildren(link);
    if (this.data.enabled && !this.map.subject && this.map.placement !== "direct" && this.data.visibleInMode(i, this.data.mode)) this.include(i);
  }

  async native(id, host, current) {
    if (this.guideOnly) return;
    if (!this.nativeLoad) this.nativeLoad = (async () => {
      const meta = await json("data/context/native-parents.json");
      if (meta.sourcePin !== this.cat.index.sourcePin) throw Error("The native context index uses a different edition.");
      const packs = await Promise.all(["native-parents", "native-modules"].map(name => bytes("data/context/" + name + ".bin.gz")));
      return packs.map(raw => {
        if (raw.byteLength % 12) throw Error("Incomplete native context index.");
        const view = new DataView(raw), ids = new Uint32Array(raw.byteLength / 12);
        for (let j=0; j<ids.length; j++) ids[j] = view.getUint32(j*12, true);
        return {ids,view};
      });
    })().catch(error => { this.nativeLoad = null; throw error; });
    const tables = await this.nativeLoad;
    if (!current()) return;
    for (const [k, {ids,view}] of tables.entries()) {
      const i = ordinalOf(ids, id);
      if (i < 0) continue;
      const row = view.getUint32(i*12+4, true), theorem = view.getInt32(i*12+8, true);
      const label = k ? "Open a mapped declaration in this module" : "Open the written parent on the map";
      host.append(elem("h3", k ? "Module context" : "Written parent"), status(k ?
        "The source module is known. The exact written parent and this entry’s mathematical topic are open." :
        "The ownership table traces this compiler entry to a specific written command."),
        anchor(label, theorem >= 0 ? "#theorem=" + theorem : "#context=" + row, "context-action"));
      return;
    }
  }
}
