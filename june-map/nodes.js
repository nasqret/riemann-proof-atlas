// The map holds paper coordinates. Bundle, command and constant links open records at
// the supporting paper; only the paper itself is passed to the map projection.
import {nodeIndex, writtenRecord, constantRecord, constantSummary, findNodes, listNodes, bundlesAt, proofBundle, writtenFromAtlas} from "./node-records.js";

const fmt = n => Number(n).toLocaleString("en-US");
const scopeNames = {rh: "Used by classical RH", written: "All written declarations", graph: "All graph constants"};
const routeLabels = {
  theoremPaper: "The theorem’s proof bundle supplies this paper.",
  contextWithSuggestedTopic: "A source-context witness supplies this paper and a suggested topic.",
  contextNavigationOnly: "A source-context witness supplies a reading location. The fine topic remains open."
};
const idValue = value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const flagNames = flags => [[1, "type"], [2, "value"], [4, "compiler support"]].filter(([bit]) => flags & bit).map(([, label]) => label).join(" + ");

export function createProofReader({map, places, pane, element, link, button, metricRow, viewHeading,
  route, begin, active, showMap}) {
  const select = document.getElementById("node-scope"), card = document.getElementById("proof-callout");
  const line = document.querySelector("#proof-leader line");
  let index, scope = "rh", preview = null;
  const nodeScope = () => scope === "rh" ? "rh" : "all";
  const memberKind = () => scope === "graph" ? "constant" : "written";
  const countKey = () => (scope === "rh" ? "rhWritten" : scope === "graph" ? "constant" : "written");
  const kindLabel = k => k === "written" ? "Written declaration" : "Graph constant";
  const noun = k => k === "written" ? "written declarations" : "graph constants";
  const readScope = () => {
    const requested = new URLSearchParams(location.search).get("scope");
    return Object.hasOwn(scopeNames, requested) ? requested : "rh";
  };
  function scopeURL(next) {
    const url = new URL(location.href);
    if (next === "rh") url.searchParams.delete("scope"); else url.searchParams.set("scope", next);
    return url.pathname + url.search + url.hash;
  }
  function applyScope() {
    scope = readScope();
    select.value = scope;
    const key = countKey();
    map.placements = index ? places.filter((p, i) => index.markers[i]?.[key] > 0) : [];
    map.drawSoon();
    document.body.dataset.proofScope = scope;
  }
  const recordLink = (label, kind, id, css, extra) => link(label, route(kind, id, extra), css);
  const item = (name, detail, href, type) => ({name, detail, href, type});
  const nodeItem = record => item(record.name, kindLabel(record.kind) + " " + record.id + (record.unplaced ? " · unplaced" : ""), route(record.kind, record.id), record.kind);
  const bundleItem = bundle => item(bundle.label, fmt(bundle[countKey()]), route("proofBundle", bundle.id), "bundle");
  function makeRow(record, compact = false) {
    const li = element("li");
    const row = record.href ? link("", record.href, compact ? "proof-map-row" : "item-link") : element("span", "", compact ? "proof-map-row" : "item-link");
    if (record.type) row.dataset.kind = record.type;
    let display = record.name;
    if (compact && record.type === "bundle" && display.includes(" · ")) display = display.split(" · ").at(-1);
    if (compact && ["constant", "written"].includes(record.type) && display.length > 32 && display.includes("."))
      display = "…" + display.slice(display.lastIndexOf("."));
    row.append(element("span", display, "item-name"));
    if (record.detail && !compact) row.append(element("span", record.detail, "item-count"));
    if (compact) {
      row.title = [record.name, record.detail].filter(Boolean).join(" · ");
      row.setAttribute("aria-label", record.name);
    }
    li.append(row);
    return li;
  }
  function navButton(label, disabled, act) {
    const btn = button(label, act, "proof-step");
    btn.disabled = disabled; return btn;
  }
  function clear() {
    preview = null; card.hidden = true; line.parentElement.setAttribute("hidden", "");
  }
  function position() {
    if (!preview || !map.layers.lean) { card.hidden = true; line.parentElement.setAttribute("hidden", ""); return; }
    const [x, y] = map.screen(preview.place.x, preview.place.y);
    if (x < 0 || x > map.width || y < 0 || y > map.height) { card.hidden = true; line.parentElement.setAttribute("hidden", ""); return; }
    card.hidden = false;
    const w = card.offsetWidth, h = card.offsetHeight, pad = 8, gap = map.width < 520 ? 12 : 24;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rightFits = x + gap + w <= map.width - pad;
    const leftFits = x - gap - w >= pad;
    let left, top, endX, endY;
    if (rightFits || leftFits) {
      const overMapTools = rightFits && x + gap + w > map.width - 64 && y - 28 < 205;
      const right = rightFits && (!leftFits || !overMapTools);
      left = right ? x + gap : x - gap - w;
      const minTop = left < 112 && map.height - h > 67 ? 64 : pad;
      top = clamp(y - 28, minTop, map.height - h - pad);
      endX = right ? left : left + w; endY = clamp(y, top + 7, top + h - 7);
    } else {
      left = clamp(x - w / 2, pad, map.width - w - pad);
      const below = y + gap + h <= map.height - pad || y < map.height / 2;
      top = clamp(below ? y + gap : y - h - gap, pad, map.height - h - pad);
      endX = clamp(x, left + 7, left + w - 7); endY = below ? top : top + h;
    }
    card.style.left = Math.round(left) + "px"; card.style.top = Math.round(top) + "px";
    for (const [key, value] of Object.entries({x1: x, y1: y, x2: endX, y2: endY})) line.setAttribute(key, value);
    line.parentElement.removeAttribute("hidden");
  }
  function showInspector() {
    pane.focus({preventScroll: true});
    document.getElementById("inspector").scrollIntoView({block: "nearest"});
  }
  // A keyboard-accessible callout stays attached to the actual paper as the map moves.
  // The inspector and callout read the same group, with independent page sizes.
  function callout(place, title, read, token) {
    if (!place || !active(token)) return;
    const context = {place}; preview = context;
    const header = element("header"), close = button("×", () => { clear(); showMap(); }, "proof-close");
    close.setAttribute("aria-label", "Close map details");
    header.append(element("strong", title), close);
    const sub = element("p", "Paper " + place.papers[0].id, "proof-map-paper");
    const body = element("div");
    card.replaceChildren(header, sub, body); position();
    let pageTicket = 0;
    async function turn(offset, focus = false) {
      const ticket = ++pageTicket, limit = 3;
      try {
        const {total, rows} = await read(offset, limit);
        if (!active(token) || context !== preview || ticket !== pageTicket) return;
        const list = element("ul", null, "proof-map-list");
        rows.forEach(r => list.append(makeRow(r, true)));
        const controls = element("nav", null, "proof-map-controls");
        controls.setAttribute("aria-label", "Map detail pages");
        if (total > limit) {
          const prev = navButton("‹", offset === 0, () => turn(Math.max(0, offset - limit), true));
          const next = navButton("›", offset + rows.length >= total, () => turn(offset + limit, true));
          prev.setAttribute("aria-label", "Previous map detail entries"); next.setAttribute("aria-label", "Next map detail entries");
          controls.append(prev, element("span", fmt(offset + 1) + "–" + fmt(offset + rows.length) + " / " + fmt(total)), next);
        }
        controls.append(button("Inspector", showInspector, "proof-inspect"));
        body.replaceChildren(list, controls); position();
        if (focus) (list.querySelector("a") || controls.querySelector("button:enabled"))?.focus({preventScroll: true});
      } catch (error) {
        if (active(token) && context === preview) { body.replaceChildren(element("p", error.message), button("Retry", () => turn(offset))); position(); }
      }
    }
    turn(0);
  }
  map.proofPosition = position;
  const observer = new ResizeObserver(position); observer.observe(card);

  function pager(host, token, {read, label, empty, limit = 12, initial = 0, pageLink = null}) {
    let seq = 0;
    async function turn(offset, focus = false) {
      if (!active(token)) return;
      const request = ++seq;
      host.setAttribute("aria-busy", "true");
      try {
        const {total, rows} = await read(offset, limit);
        if (!active(token) || request !== seq) return;
        if (offset > 0 && !rows.length && !pageLink) return turn(0);
        const text = total && rows.length ? `${fmt(offset + 1)}–${fmt(offset + rows.length)} of ${fmt(total)} ${label}`
          : empty || "No matching " + label + ".";
        const info = element("p", text, "proof-page-count");
        info.tabIndex = -1;
        if (!rows.length) {
          host.replaceChildren(info);
          if (offset && pageLink) host.append(link("First page", pageLink(0), "text-button"));
        } else {
          const list = element("ul", null, "item-list proof-list");
          rows.forEach(r => list.append(makeRow(r)));
          host.replaceChildren(info, list);
          if (total > limit) {
            const controls = element("nav", null, "proof-paging"); controls.setAttribute("aria-label", label + " pages");
            for (const [title, pos, disabled] of [["Previous", Math.max(0, offset - limit), !offset], ["Next", offset + limit, offset + rows.length >= total]]) {
              controls.append(pageLink && !disabled ? link(title, pageLink(pos), "proof-step") : navButton(title, disabled, () => turn(pos, true)));
            }
            host.append(controls);
          }
        }
        if (focus) info.focus({preventScroll: true});
      } catch (error) {
        if (active(token) && request === seq) host.replaceChildren(element("p", error.message), button("Retry", () => turn(offset)));
      } finally { if (request === seq) host.removeAttribute("aria-busy"); }
    }
    host.append(element("p", "Loading " + label + "…", "muted"));
    return turn(initial);
  }
  function scopedRead(args, convert = nodeItem) {
    return async (offset, limit) => {
      const data = await listNodes({...args, offset, limit});
      return {total: data.total, rows: data.rows.map(convert)};
    };
  }
  const pageOf = rows => async (offset, limit) => ({total: rows.length, rows: rows.slice(offset, offset + limit)});
  function locate(place) {
    if (!place) { map.select(null); return; }
    map.select(place); map.go(place.x, place.y, Math.max(8, Math.min(map.zoom, 32)));
  }
  function section(title) {
    const host = element("div", null, "proof-records");
    host.append(element("h3", title));
    const body = element("div"); host.append(body);
    return [host, body];
  }
  function original(kind, id) { return "index.html#" + new URLSearchParams({[kind]: id}); }
  function paperInfo(record) {
    const place = places[record.marker];
    if (!place) return;
    const block = element("section", null, "proof-paper");
    block.append(element("h3", "June paper anchor"));
    block.append(element("p", routeLabels[record.route] || "The written owner supplies this June reading location."));
    if (record.route === "theoremPaper" && record.theoremBasis)
      block.append(element("p", "Placement evidence · " + [record.theoremBasis, record.theoremConfidence].filter(Boolean).join(" · "), "detail-meta"));
    if (record.route !== "theoremPaper" && record.contextRelation)
      block.append(element("p", "Source-context relation · " + record.contextRelation, "detail-meta"));
    if (record.route !== "theoremPaper" && record.atlas != null && record.originalBundle)
      block.append(link("Original source-family bundle", original("bundle", record.originalBundle), "text-button"));
    const p = place.papers[0];
    block.append(recordLink(p.title, "paper", p.row, "proof-paper-title", {x: String(place.x), y: String(place.y)}));
    const meta = element("p", `arXiv ${p.id} · June row ${fmt(p.row)}`, "detail-meta");
    block.append(meta, recordLink("Browse this paper’s proof bundles", "placement", place.id, "text-button"));
    if (record.bundle) block.append(document.createTextNode(" · "), recordLink("Open this proof bundle", "proofBundle", record.bundle, "text-button"));
    if (record.witnessAtlas != null && record.route !== "theoremPaper") {
      const go = element("p"); go.append(recordLink("Open the source-context witness", "theorem", record.witnessAtlas, "text-button")); block.append(go);
    }
    pane.append(block);
  }
  function source(record, label) {
    if (!record.sourceUrl) return;
    const a = link(label, record.sourceUrl, "soft-button");
    const box = element("div", null, "section-tools");
    box.append(a); pane.append(box);
    if (record.path && record.line) {
      const where = `${record.path} · line ${fmt(record.line)}`;
      pane.append(element("p", where, "proof-source-path"));
    }
  }
  function reach(record) {
    const root = index.root.bit;
    const labels = [];
    if (record.valueMask & root) labels.push("value edges");
    else if (record.termMask & root) labels.push("type and value edges");
    else if (record.mask & root) labels.push("including compiler support");
    const used = record.rooted ?? Boolean(record.mask & root);
    const role = record.kind === "written" ? "Owns a constant used by classical RH" : "Used by classical RH";
    const message = !used ? "Outside the classical RH dependency closure." : role + (labels.length ? " · " + labels.join(", ") : "") + ".";
    pane.append(element("p", message, "proof-reach"));
  }
  function directEdges(id) {
    return async (offset, limit) => {
      const {constantEdges} = await import("./node-edges.js");
      const {total, items} = await constantEdges(id, {offset, limit});
      const rows = await Promise.all(items.map(async edge => {
        if (edge.frontier) return item(edge.frontier.name, flagNames(edge.flags) + " · undeclared export name", null, "frontier");
        const target = await constantSummary(edge.id);
        if (!target) throw Error("A declared dependency is missing from the graph index.");
        return item(target.name, flagNames(edge.flags), route("constant", edge.id), "constant");
      }));
      return {total, rows};
    };
  }
  async function renderWritten(id, token) {
    const w = await writtenRecord(id);
    if (!active(token)) return;
    if (!w) return unavailable("Written declaration", id);
    pane.replaceChildren(); pane.dataset.state = "written"; pane.dataset.item = String(id);
    viewHeading("Written declaration · " + (w.commandKind || "Lean command") + " · row " + w.id, w.name);
    reach(w);
    source(w, "Read pinned Lean source");
    if (w.atlas != null) {
      const a = link("Original Explorer theorem", original("theorem", w.atlas), "text-button");
      pane.append(a); document.querySelector(".edition-link").href = a.href;
    }
    const place = places[w.marker]; locate(place);
    const [host, body] = section("Graph constants owned by this declaration");
    pane.append(host);
    const read = scopedRead({kind: "constant", scope: "all", owner: w.id});
    pager(body, token, {read, label: "owned constants", empty: "The ownership register links no graph constants to this command."});
    callout(place, "Owned graph constants", read, token);
    paperInfo(w);
    if (w.ownedCount) {
      const c = w.primaryConstant != null ? {id: w.primaryConstant, name: w.name} :
        (await listNodes({kind: "constant", owner: w.id, scope: "all", offset: 0, limit: 1})).rows[0];
      if (!active(token) || !c) return;
      const [edgeHost, edgeBody] = section("Direct dependencies of " + c.name);
      edgeBody.before(recordLink("Open graph constant", "constant", c.id, "text-button"));
      pane.append(edgeHost);
      pager(edgeBody, token, {read: directEdges(c.id), label: "direct dependencies", empty: "This constant has no outgoing dependency edges.", limit: 8});
    }
  }
  async function renderConstant(id, token) {
    const c = await constantRecord(id);
    if (!active(token)) return;
    if (!c) return unavailable("Graph constant", id);
    pane.replaceChildren(); pane.dataset.state = "constant"; pane.dataset.item = String(id);
    viewHeading("Graph constant · " + (c.constantKind || "Lean export") + " · export name ID " + c.id, c.name);
    reach(c);
    const place = places[c.marker]; locate(place);
    if (c.owner != null) {
      const box = element("section", null, "proof-owner");
      box.append(element("h3", "Written owner"));
      const owner = await writtenRecord(c.owner);
      if (!active(token)) return;
      box.append(recordLink(owner?.name || "Written declaration " + c.owner, "written", c.owner, "proof-paper-title"));
      if (c.ownerBasis) box.append(element("p", "Ownership evidence · " + c.ownerBasis, "detail-meta"));
      pane.append(box); source(c, "Read owner’s pinned Lean source");
    } else {
      const why = c.ownerStatus === "project-owner-unresolved" ? "The project ownership register leaves this constant unresolved." : "This name is external to the project or absent from its written ownership register.";
      pane.append(element("h3", "Unplaced graph constant"), element("p", why + " Its graph edges are available here."),
        recordLink("Browse unplaced constants", "unplaced", 1, "text-button"));
    }
    const [host, body] = section("Direct dependencies");
    pane.append(host);
    const read = directEdges(id);
    pager(body, token, {read, label: "direct dependencies", empty: "This constant has no outgoing dependency edges."});
    callout(place, "Direct dependencies", read, token);
    const evidence = element("details", null, "inspector-note export-evidence");
    evidence.append(element("summary", "Lean export evidence"));
    const fields = element("dl");
    for (const [label, value] of [["Export name ID", c.id], ["Type expression ID", c.typeExpr],
      ["Value expression ID", c.valueExpr ?? "No value in this record"], ["Export byte offset", c.byteOffset]]) {
      const field = element("div"); field.append(element("dt", label), element("dd", String(value))); fields.append(field);
    }
    evidence.append(fields); pane.append(evidence);
    if (place) paperInfo(c);
  }
  async function renderBundle(id, token) {
    const b = await proofBundle(id);
    if (!active(token)) return;
    if (!b) return unavailable("Proof bundle", id);
    pane.replaceChildren(); pane.dataset.state = "proofBundle"; pane.dataset.item = id;
    viewHeading("Proof bundle", b.label);
    const place = places[b.marker]; locate(place);
    const kind = memberKind(), read = scopedRead({kind, scope: nodeScope(), bundle: id});
    const [host, body] = section(scope === "graph" ? "Graph constants in this bundle" : "Written declarations in this bundle");
    pane.append(host);
    pager(body, token, {read, label: noun(kind), empty: "This bundle has no members in the selected proof scope."});
    callout(place, scope === "graph" ? "Graph constants in bundle" : "Declarations in bundle", read, token);
    if (place) pane.append(element("h3", "Supporting paper"), element("p", place.papers[0].title),
      recordLink("Back to this paper’s proof bundles", "placement", place.id, "text-button"));
    const a = link("Original Explorer bundle", original("bundle", id), "text-button");
    const p = element("p"); p.append(a); pane.append(p); document.querySelector(".edition-link").href = a.href;
  }
  function unavailable(label, id) {
    pane.replaceChildren(); pane.dataset.state = "unknown";
    viewHeading(label, "Selection unavailable"); pane.append(element("p", "This edition has no " + label.toLowerCase() + " with ID " + id + "."));
  }
  function open(kind, value, params = new URLSearchParams()) {
    const token = begin(); map.select(null);
    if (kind === "unplaced") return unplaced(params, token);
    const id = kind === "proofBundle" ? value : idValue(value);
    if (id === null || id === "") return unavailable(kind, value);
    pane.append(element("p", "Opening proof record…", "muted"));
    const render = kind === "written" ? renderWritten : kind === "constant" ? renderConstant : renderBundle;
    render(id, token).catch(error => {
      if (!active(token)) return;
      pane.dataset.state = "error"; pane.replaceChildren(element("h2", "Proof record unavailable"),
        element("p", error.message), button("Retry", () => open(kind, value, params)));
    });
  }
  function unplaced(params, token) {
    pane.dataset.state = "unplaced-constants";
    viewHeading("Dependency graph", "Unplaced constants");
    pane.append(element("p", "These graph constants have no recorded written owner with a June paper anchor. Open a name to follow its dependency edges."));
    if (scope === "written") {
      const next = new URL(scopeURL("graph"), location.href);
      pane.append(element("p", "All written declarations have a paper or source-context route."),
        link("Show all unplaced graph constants", next.pathname + next.search + next.hash, "soft-button")); return;
    }
    const q = params.get("q") || "", limit = 18, page = Math.min(idValue(params.get("page")) || 1, 1000000);
    const url = (query, n) => route("unplaced", 1, {...(query ? {q: query} : {}), ...(n > 1 ? {page: String(n)} : {})});
    const form = element("form", null, "proof-filter"), field = element("input"), go = element("button", "Find");
    field.type = "search"; field.id = "unplaced-search"; field.value = q; field.placeholder = "Lean name prefix"; field.autocomplete = "off";
    const label = element("label", "Find an unplaced constant"); label.htmlFor = field.id; go.type = "submit";
    form.append(label, field, go);
    form.onsubmit = e => { e.preventDefault(); location.hash = new URL(url(field.value.trim(), 1), location.href).hash; };
    pane.append(form);
    const host = element("div"); pane.append(host);
    const args = {kind: "constant", scope: nodeScope(), unplaced: true};
    const number = idValue(q);
    const read = async (offset, limit) => {
      if (number != null) {
        const c = await constantRecord(number);
        const matches = c && c.owner == null && (args.scope !== "rh" || c.rooted) ? [nodeItem({...c, unplaced: true})] : [];
        return pageOf(matches)(offset, limit);
      }
      const opts = {...args, offset, limit};
      const result = q ? await findNodes(q, opts) : await listNodes(opts);
      return {total: result.total, rows: result.rows.map(nodeItem)};
    };
    pager(host, token, {read, label: "unplaced constants", limit, initial: (page - 1) * limit, pageLink: offset => url(q, 1 + Math.floor(offset / limit))});
  }
  function search(value, host, token) {
    const kind = scope === "rh" ? "both" : memberKind(), selectedScope = nodeScope();
    const number = idValue(value);
    host.append(element("h3", "Lean proof nodes"));
    const body = element("div"); host.append(body);
    const read = async (offset, limit) => {
      if (number != null) {
        const possible = await Promise.all([kind === "constant" ? null : writtenRecord(number),
          kind === "written" ? null : constantSummary(number)]);
        const rows = possible.filter(r => r && (selectedScope !== "rh" || r.rooted)).map(nodeItem);
        return pageOf(rows)(offset, limit);
      }
      const data = await findNodes(value, {kind, scope: selectedScope, offset, limit});
      return {total: data.total, rows: data.rows.map(nodeItem)};
    };
    const empty = number != null ? "No proof node with this ID in the selected scope." : "No Lean names begin with this query in the selected scope.";
    pager(body, token, {read, label: "matching proof nodes", empty, limit: 10});
  }
  function overview(host) {
    const stats = index.counts[nodeScope()];
    const intro = element("section", null, "proof-overview");
    intro.append(element("h3", "Proof nodes"));
    intro.append(metricRow(scope === "written" ? [["written declarations", stats.written]] :
      scope === "graph" ? [["graph constants", stats.constant], ["unplaced", stats.unplaced]] :
      [["written owners", stats.written], ["graph constants", stats.constant]]));
    const rootKind = scope === "graph" ? "constant" : "written";
    intro.append(recordLink("Open " + index.root.name, rootKind, index.root[rootKind], "soft-button"));
    if (scope !== "written") {
      const p = element("p"); p.append(recordLink("Browse " + fmt(stats.unplaced) + " unplaced constants", "unplaced", 1, "text-button")); intro.append(p);
    }
    host.append(intro);
  }
  async function placement(host, place, origin, token) {
    const marker = places.indexOf(place), [sectionHost, body] = section("Proof bundles at this paper");
    const stats = index.markers[marker];
    if (stats) sectionHost.prepend(element("p", scopeNames[scope] + " · " + fmt(stats[countKey()]) + " " + noun(memberKind()), "detail-meta"));
    host.append(sectionHost);
    if (origin) {
      const jump = element("div", null, "proof-jump"); sectionHost.before(jump);
      if (origin.kind === "bundle") jump.append(recordLink("Open this bundle’s proof nodes", "proofBundle", origin.id, "soft-button"));
      else if (origin.kind === "context") jump.append(recordLink("Inspect written declaration", "written", origin.id, "soft-button"));
      else if (origin.kind === "theorem") {
        const written = await writtenFromAtlas(Number(origin.id));
        if (!active(token)) return;
        if (written != null) jump.append(recordLink("Inspect written declaration", "written", written, "soft-button"));
      }
    }
    const groups = await bundlesAt(marker, nodeScope());
    if (!active(token)) return;
    const list = groups.filter(b => b[countKey()] > 0).map(bundleItem);
    const read = pageOf(list);
    pager(body, token, {read, label: "proof bundles", empty: "This paper has no bundles in the selected proof scope."});
    if (!list.length && scope === "rh") sectionHost.append(link("Show all written declarations at this paper", scopeURL("written"), "text-button"));
    callout(place, "Proof bundles at this paper", read, token);
  }
  async function initialize() {
    const records = await nodeIndex();
    if (records.markers.length !== places.length || places.some((place, i) => records.markers[i].id !== place.id))
      throw Error("The proof index and June paper anchors belong to different map editions.");
    index = records; applyScope(); select.disabled = false;
  }
  return {initialize, applyScope, scopeURL, open, search, clear, overview, placement, writtenFromAtlas,
    get available() { return !!index; }, get places() { return map.placements; }};
}
