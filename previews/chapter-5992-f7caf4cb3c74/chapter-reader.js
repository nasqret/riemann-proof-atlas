import { json } from "./io.js";
import { ChapterMap } from "./chapter-map.js";
import { leanPreview, signatureStart } from "./lean-preview.js";

const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = new URL("chapter-reader.css", import.meta.url).href;
document.head.append(stylesheet);

function element(tag, cls, ...children) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  node.append(...children.flat().filter((c) => c !== undefined && c !== null));
  return node;
}
function anchor(text, href, cls) {
  const a = element("a", cls, text);
  a.href = href;
  return a;
}
function address(view, id, extra = {}) {
  let result = "#" + view + (id === undefined || id === "" ? "" : "=" + encodeURIComponent(id));
  for (const [key, value] of Object.entries(extra)) if (value !== undefined && value !== null && value !== "") {
    result += "&" + key + "=" + encodeURIComponent(value);
  }
  return result;
}
function viewer(item, proof, step) {
  const p = new URLSearchParams();
  if (item) p.set("item", item);
  if (proof) p.set("proof", proof);
  if (step) p.set("step", step);
  return "companion/index.html" + (p.size ? "#" + p : "");
}
function codeWords(text) {
  const body = document.createDocumentFragment();
  for (const [i, part] of String(text || "").split("`").entries()) {
    body.append(i % 2 ? element("code", "", part) : part);
  }
  return body;
}
const p = (text, cls = "") => element("p", cls, codeWords(text));
const title = (text) => element("h2", "reader-title", text);
function declarationTitle(name) {
  const heading = element("h2", "reader-title bigcode declaration-title");
  for (const [i, part] of name.split(".").entries()) {
    if (i) heading.append(".", document.createElement("wbr"));
    heading.append(part);
  }
  return heading;
}
function expand(label, ...body) {
  return element("details", "reader-details", element("summary", "", label), ...body);
}
function action(label, fn, cls = "quiet") {
  const button = element("button", cls, label);
  button.type = "button";
  button.addEventListener("click", fn);
  return button;
}
function row(label, href, description) {
  const a = anchor(element("strong", "", label), href, "reader-row");
  if (description) a.append(element("span", "", codeWords(description)));
  return a;
}
function card(id, name, ...children) {
  const section = element("section", "reader-card", element("h3", "", name), ...children);
  section.dataset.card = id;
  return section;
}
function view(kind) {
  const section = element("article", "chapter-reader");
  section.dataset.readerView = kind;
  return section;
}
function trail(parts) {
  const nav = element("nav", "reader-trail");
  nav.setAttribute("aria-label", "Proof reading trail");
  const links = [["Atlas", "#"], ...parts];
  for (const [i, [label, href]] of links.entries()) {
    if (i) nav.append(element("span", "reader-separator", "›"));
    const a = anchor(label, href);
    if (i === links.length - 1) a.setAttribute("aria-current", "page");
    nav.append(a);
  }
  const parent = links.at(-2);
  const up = anchor("↑ Up", parent[1], "reader-up");
  up.setAttribute("aria-label", "Up to " + parent[0]);
  return element("div", "reader-navigation", nav, up);
}
function portion(entries, visible, noun, render) {
  const list = element("div", "reader-list");
  for (const entry of entries.slice(0, visible)) list.append(render(entry));
  if (entries.length > visible) {
    list.append(expand("Show " + (entries.length - visible) + " more " + noun, ...entries.slice(visible).map(render)));
  }
  return list;
}
function rangeName([first, last]) {
  return first === last ? "line " + first : "lines " + first + "–" + last;
}
function sourceURL(cat, file, [first, last]) {
  return cat.index.sourceBase + file.split("/").map(encodeURIComponent).join("/") + "#L" + first + (last > first ? "-L" + last : "");
}
function sourceLink(cat, file, lines, label = "Open Lean source") {
  const a = anchor(label, sourceURL(cat, file, lines), "source-link");
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}
function noteEntry(chapter, id) {
  return chapter.note?.declarations?.[id];
}
function nameOf(chapter, entry) {
  return noteEntry(chapter, entry.id)?.label || entry.name;
}
function chapterState(entry) {
  if (entry.state === "note" || entry.note) return "Note and structured proofs";
  if (entry.state === "structured") return "Structured proofs";
  if (entry.state === "statements") return "Statements only";
  return "Archive only";
}
function reviewCounts(counts) {
  return "A second reader compared " + counts.secondRead + " of " + counts.steps + " steps with the Lean source.";
}
function kernelText(value) {
  if (value && typeof value === "string" && value !== "unknown") return value;
  if (value?.description) return value.description;
  return "Independent kernel replay status is unknown.";
}
function outsideHref(owner, via, decl) {
  return address("chapter", owner, { via, decl });
}
function byId(entries, id) {
  return entries.find((entry) => entry.id === id);
}
function memberHref(chapter, entry) {
  if (entry.proof) return address("proof", entry.id);
  if (Number.isInteger(entry.atlasRow)) return address("theorem", entry.atlasRow);
  return address("chapter", chapter.id, { member: entry.id });
}
function knownReference(cat, chapter, entry) {
  if (chapter.members?.[entry.id]) return memberHref(chapter, chapter.members[entry.id]);
  if (chapter.proofIndex && Object.hasOwn(chapter.proofIndex, entry.id)) return address("proof", entry.id);
  if (Number.isInteger(entry.atlasRow)) return address("theorem", entry.atlasRow);
  if (entry.owner === chapter.id) return address("chapter", chapter.id, { member: entry.id });
  if (entry.owner) return outsideHref(entry.owner, chapter.id, entry.id);
  return sourceURL(cat, entry.file, entry.lines);
}
function chaptersIn(index, component) {
  return index.chapters.filter((c) => c.component === component.id);
}
const shortEndpoint = (entry) => entry.shortTitle || entry.title;
const setup = ["Statement", address("statement")];

export class ChapterReader {
  constructor(cat, map) {
    this.cat = cat;
    this.map = map;
  }
  index() {
    return json("chapters/index.json");
  }
  chapter(id) {
    return json("chapters/" + encodeURIComponent(id) + ".json");
  }
  async inspect(rowNumber) {
    const [index, ranges] = await Promise.all([
      this.index(), json("chapters/ranges/" + Math.floor(rowNumber / 16384) + ".json.gz"),
    ]);
    const key = index.memberRows[rowNumber];
    let chapter = null;
    if (key) {
      for (const entry of index.chapters) {
        const candidate = await this.chapter(entry.id);
        if (Object.hasOwn(candidate.members, key)) { chapter = candidate; break; }
      }
    }
    return { reader: this, row: rowNumber, key, chapter, index, range: ranges[rowNumber % 16384] };
  }
  path(index, chapter, endpointId) {
    const component = byId(index.components, chapter.component);
    const endpoint = byId(index.endpoints, endpointId) || index.endpoints.find((e) => e.components.includes(chapter.component));
    return [setup,
      ...(endpoint ? [[shortEndpoint(endpoint), address("statement", endpoint.id)]] : []),
      ...(component ? [[component.title, address("component", component.id, this.endpointParam(index, endpoint))]] : []),
      [chapter.title, address("chapter", chapter.id, this.endpointParam(index, endpoint))],
    ];
  }
  endpointParam(index, endpoint) {
    return endpoint && endpoint.id !== index.endpoints[0].id ? { endpoint: endpoint.id } : {};
  }
  theoremTrail(r, rowNumber, { chapter, index }) {
    const prefix = chapter ? this.path(index, chapter) : [setup];
    return trail([...prefix, [chapter ? nameOf(chapter, r) : r.name, address("theorem", rowNumber)]]);
  }
  declarationTitle(name) { return declarationTitle(name); }
  inspectorSource(r, { chapter, key }) {
    const statement = leanPreview({ name: r.name, label: "Lean statement", lines: r.signature.split("\n"), first: signatureStart(r), copyLabel: "Copy statement" });
    const member = chapter?.members[key];
    if (!member?.proof) return statement;
    const complete = expand("Complete Lean declaration · " + rangeName(member.lines));
    const source = element("div");
    complete.append(source);
    complete.addEventListener("toggle", async () => {
      if (!complete.open || source.dataset.state === "ready") return;
      source.textContent = "Loading the numbered Lean source…";
      try {
        const proof = await json(member.proof);
        source.replaceChildren(leanPreview({ name: r.name, label: "Lean declaration", lines: proof.source, first: proof.lines[0], complete: true, copyLabel: "Copy all" }));
        source.dataset.state = "ready";
      } catch {
        source.replaceChildren(p("The source shard could not be loaded. Close and reopen to retry."), sourceLink(this.cat, member.file, member.lines));
      }
    });
    return element("div", "inspector-source", statement, complete);
  }
  theoremReading(r, { key, chapter }) {
    const member = chapter.members[key], place = noteEntry(chapter, key);
    const box = card("membership", "Chapter reading", row(chapter.title, address("chapter", chapter.id), "Chapter " + chapter.id));
    if (place?.item) box.append(row(place.where + " · page " + place.page, viewer(place.item, key), nameOf(chapter, member) + " in the note"));
    if (member.proof) box.append(row("Open structured proof", address("proof", key), nameOf(chapter, member)));
    box.append(this.usage(chapter, member));
    return box;
  }
  usage(chapter, member) {
    const users = member.users || [];
    if (!users.length) return p("The chapter ledger lists no direct source users.", "small");
    const list = element("div", "reader-list", ...users.map((u) =>
      row(nameOf(chapter, u), Number.isInteger(u.atlasRow) ? address("theorem", u.atlasRow) : knownReference(this.cat, chapter, u), "Chapter " + u.owner)));
    return expand("Used by " + users.length + " direct " + (users.length === 1 ? "declaration" : "declarations"), list);
  }
  async open(route, params, host, current) {
    const index = await this.index();
    if (!current()) return;
    const id = params.get(route);
    let page, layerChapter = null, mapDirectory = false, pin = null, proofRow;
    const context = params.get("endpoint");
    if (route === "statement") {
      const endpoint = index.endpoints.find((e) => [e.id, e.name, String(e.atlasRow)].includes(id));
      page = !id ? this.statements(index) : endpoint ? this.endpoint(index, endpoint) : this.missing(index, "statement", id);
      mapDirectory = true;
    } else if (route === "component") {
      const component = byId(index.components, id);
      page = component ? this.component(index, component, context) : this.missing(index, "component", id);
      mapDirectory = true;
    } else if (route === "chapter") {
      const record = index.chapters.find((c) => c.id === id || c.slug === id);
      if (record) {
        const c = await this.chapter(record.id);
        if (!current()) return;
        const member = params.get("member");
        pin = params.get("node");
        if (pin && !byId(c.outline.nodes, pin)) page = this.missing(index, "outline node", pin, [c.title, address("chapter", c.id)]);
        else if (member && !c.members[member]) page = this.missing(index, "member", member, [c.title, address("chapter", c.id)]);
        else page = member ? this.member(index, c, c.members[member], context) : this.chapterPage(index, c, pin, context);
        layerChapter = c;
      } else if (Object.hasOwn(index.outside, id)) {
        const adjacent = index.chapters.find((c) => c.id === params.get("via")) || index.chapters[0];
        const from = await this.chapter(adjacent.id);
        if (!current()) return;
        page = this.outside(index, index.outside[id], from, params.get("decl"));
        mapDirectory = true;
      } else page = this.missing(index, "chapter", id);
    } else if (route === "proof" && Object.hasOwn(index.proofs, id)) {
      const proof = await json("proofs/" + index.proofs[id] + ".json");
      const place = proof.notePlace;
      const c = { ...byId(index.chapters, proof.chapter), proofIndex: index.proofs, note: { declarations: {
        [id]: { ...place, label: place.name },
      } } };
      if (!current()) return;
      const step = params.get("step");
      const lookup = new Map();
      function visit(s) { lookup.set(s.id, s); s.children.forEach(visit); }
      proof.steps.forEach(visit);
      page = step && !lookup.has(step) ? this.missing(index, "step", step, ["Structured proof of " + nameOf(c, proof), address("proof", id)])
        : this.proofPage(index, c, proof, step ? lookup.get(step) : null, lookup, context);
      proofRow = proof.atlasRow;
    } else {
      page = this.missing(index, route === "unknown" ? "address" : route, id || location.hash);
    }
    if (!current()) return;
    if (layerChapter || mapDirectory) {
      this.layer ??= new ChapterMap(this.map, index);
      this.layer.show(layerChapter, pin);
    } else {
      this.map.chapterLayer?.detach();
      if (Number.isInteger(proofRow) && this.map.selected !== proofRow) this.map.gotoPoint(proofRow);
    }
    host.replaceChildren(page);
    const heading = page.querySelector("h2");
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  missing(index, kind, id, parent) {
    const result = view("missing");
    const successor = index.successors?.[id];
    const links = successor ? [row("Open successor chapter", address("chapter", successor))] : [];
    if (parent) links.push(row(...parent));
    else for (const c of index.chapters) links.push(row(c.title, address("chapter", c.id), "Chapter " + c.id));
    result.append(trail([setup, ...(parent ? [parent] : []), ["Unavailable " + kind, location.hash]]),
      title("Unrecognized " + kind), p("Requested " + kind + " · " + id, "reader-id"),
      p(successor ? "The ledger records a successor for this address." : "This release has no recorded successor for that address."),
      ...links);
    return result;
  }
  statements(index) {
    const result = view("statement");
    result.append(trail([setup]), title("What is proved"),
      p("Alpöge announced a proof. The five declarations below state the endpoints in Lean. Each reading records the available kernel and source-comparison evidence.", "intro"));
    const endpoints = card("endpoints", "Five final theorems");
    for (const e of index.endpoints) {
      const entry = element("section", "endpoint-summary", row(e.title, address("statement", e.id), e.name),
        p(e.statement), expand("Lean statement and premises", element("pre", "", e.lean), ...this.premises(e)),
        p(kernelText(e.kernel), "small"));
      entry.dataset.endpoint = e.id;
      endpoints.append(entry);
    }
    result.append(endpoints, card("components", "The 14 components",
      ...index.components.map((c) => this.componentRow(index, c))));
    return result;
  }
  premises(endpoint) {
    return [p(endpoint.premiseScope, "small"), ...endpoint.premises.map((s) => p(s, "reader-premise"))];
  }
  componentRow(index, c, endpoint) {
    const chapters = chaptersIn(index, c);
    const label = chapters.length ? chapters.map((r) => r.title + " · " + chapterState(r) + " · " + r.counts.secondRead + "/" + r.counts.steps + " steps compared").join(" · ")
      : "No chapter reading released";
    const a = row(c.title, address("component", c.id, this.endpointParam(index, endpoint)), label);
    a.dataset.component = c.id;
    return a;
  }
  endpoint(index, e) {
    const result = view("endpoint");
    result.append(trail([setup, [shortEndpoint(e), address("statement", e.id)]]),
      title(e.title), p(e.statement, "intro"), element("pre", "", e.lean),
      expand("Expanded proposition", element("pre", "", e.proposition)),
      card("premises", "Explicit premises", ...this.premises(e)), p(kernelText(e.kernel), "small"),
      row("Inspect the Lean declaration", address("theorem", e.atlasRow), e.name),
      card("components", "Proof components", ...e.components.map((id) => byId(index.components, id)).filter(Boolean).map((c) => this.componentRow(index, c, e))));
    return result;
  }
  component(index, c, endpointId) {
    const result = view("component");
    const e = byId(index.endpoints, endpointId) || index.endpoints.find((e) => e.components.includes(c.id));
    result.append(trail([setup, ...(e ? [[shortEndpoint(e), address("statement", e.id)]] : []),
      [c.title, address("component", c.id, this.endpointParam(index, e))]]), title(c.title));
    if (c.description) result.append(p(c.description, "intro"));
    if (e) result.append(p("Component in the blueprint for " + e.title + ".", "small"));
    const released = chaptersIn(index, c);
    const chapters = card("chapters", "Chapters");
    for (const entry of released) {
      chapters.append(row(entry.title, address("chapter", entry.id, this.endpointParam(index, e)), chapterState(entry) + " · chapter " + entry.id),
        p(reviewCounts(entry.counts), "small"));
    }
    if (!released.length) chapters.append(p("This release has no chapter reading for this component."));
    result.append(chapters, p(kernelText(c.kernel), "small"));
    return result;
  }
  importState(entry) {
    if (entry.state === "premise") return "Premise carried to the final theorem";
    const who = entry.owner ? "Proved in chapter " + entry.owner.split(".").at(-1) : "Proved in the archive";
    if (entry.state === "note") return who + " · note available";
    if (entry.state === "structured") return who + " · structured proofs, no note yet";
    return who + " · archive declaration, no public note yet";
  }
  importEntry(chapter, entry) {
    const box = element("article", "import-entry");
    box.dataset.import = entry.id;
    const name = nameOf(chapter, entry);
    const href = entry.owner ? outsideHref(entry.owner, chapter.id, entry.id) : sourceURL(this.cat, entry.file, entry.lines);
    box.append(row(name, href, this.importState(entry)), p(entry.statement));
    if (entry.reach === "unresolved") box.append(p("The archive leaves endpoint ownership unresolved for this declaration.", "small"));
    return box;
  }
  chapterPage(index, c, nodeId, endpointId) {
    const result = view("chapter");
    const path = this.path(index, c, endpointId);
    result.append(trail(nodeId ? [...path, [byId(c.outline.nodes, nodeId).title, address("chapter", c.id, { node: nodeId })]] : path), title(c.title),
      p("Chapter " + c.id + " · " + chapterState(c), "reader-meta"),
      p(c.counts.members + " declarations · " + c.counts.proofs + " structured proofs. " + reviewCounts(c.counts), "reader-evidence"),
      p(kernelText(c.kernel), "small"));
    if (nodeId) result.append(this.nodeDetail(c, byId(c.outline.nodes, nodeId)));
    result.append(card("exports", "Proves", portion(c.exports.map((id) => c.members[id]), 2, "exports", (entry) =>
      row(nameOf(c, entry), memberHref(c, entry), entry.statement))));
    const imports = [...c.imports].sort((a, b) => {
      const priority = (e) => /(?:^|\.)Tower\.desc$/.test(e.name) ? 0 : noteEntry(c, e.id)?.item ? 1 : 2;
      return priority(a) - priority(b);
    });
    result.append(card("imports", "Takes for granted", portion(imports, Math.min(1, imports.length), "imports", (entry) => this.importEntry(c, entry))));
    const read = card("reading", "Read it", anchor("Open the note", viewer(), "primary reader-cta"));
    read.append(p(c.note.items.length + " items in the annotated PDF. Select an item to read its declarations, numbered proof steps and Lean source.", "small"));
    const items = expand("Items in the note", ...c.note.items.map((i) => row(i.title + " · page " + i.page, viewer(i.id),
      i.declarations.map((key) => nameOf(c, c.members[key] || noteEntry(c, key) || { id: key, name: key })).join(", "))));
    read.append(items);
    const glossary = Object.values(c.glossary);
    const terms = expand("Glossary · " + glossary.length + " terms");
    terms.addEventListener("toggle", () => {
      if (!terms.open || terms.dataset.loaded) return;
      terms.dataset.loaded = "true";
      for (const term of glossary) terms.append(expand(term.title + (term.symbol ? " · " + term.symbol : ""), p(term.reading), element("pre", "glossary-source", term.definition)));
    });
    read.append(terms);
    result.append(read, card("consumers", "Used by", ...c.consumers.map((u) => row("Chapter " + u.owner,
      outsideHref(u.owner, c.id), u.ids.map((id) => nameOf(c, c.members[id])).join(", ")))));
    result.append(this.geography(index, c), this.memberList(c));
    return result;
  }
  geography(index, c) {
    const region = c.regions;
    const section = card("geography", "On the map", p("Region sizes come from endpoint-reached declarations at their atlas coordinates.", "small"));
    const component = byId(index.components, c.component);
    if (component) section.append(p(component.title, "reader-meta"));
    region.clusters.forEach((cluster) => {
      const label = cluster.count + " near " + cluster.subject;
      section.append(action(label, () => {
        this.layer.locate(cluster, true);
        this.map.view.scrollIntoView({ block: "nearest" });
        this.map.view.focus({ preventScroll: true });
      }, "region-jump"));
    });
    section.append(p(region.outliers.length + " elsewhere · " + region.unplaced.length + " without a map position" + (region.outsideReach?.length ? " · " + region.outsideReach.length + " outside the endpoint closures" : "") + ".", "small"));
    const list = expand("Chapter outline · " + c.outline.nodes.length + " entries");
    for (const n of c.outline.nodes) {
      const node = row(n.title, address("chapter", c.id, { node: n.id }), n.text + " · " + n.declarations.length + " members");
      node.dataset.listNode = n.id;
      node.addEventListener("focus", () => this.layer?.highlight(n.id));
      node.addEventListener("blur", () => this.layer?.highlight(null));
      node.addEventListener("pointerenter", () => this.layer?.highlight(n.id));
      node.addEventListener("pointerleave", () => this.layer?.highlight(null));
      list.append(node);
    }
    section.append(list);
    if (region.outliers.length) section.append(expand("Outlying declarations · " + region.outliers.length,
      ...region.outliers.map((id) => this.memberRow(c, c.members[id]))));
    if (region.unplaced.length) section.append(expand("Declarations without a map position · " + region.unplaced.length,
      ...region.unplaced.map((id) => this.memberRow(c, c.members[id]))));
    return section;
  }
  nodeDetail(c, node) {
    const box = card("outline-node", node.title, p(node.text));
    box.dataset.selectedNode = node.id;
    box.append(element("h4", "", "Declarations"), ...node.declarations.map((id) => this.memberRow(c, c.members[id])));
    if (node.takes_for_granted.length) {
      const notes = node.takes_for_granted.map((id) => c.imports.find((a) => a.id === id) || noteEntry(c, id)).filter(Boolean);
      box.append(expand("Named inputs · " + notes.length, ...notes.map((entry) => {
        const href = entry.owner ? outsideHref(entry.owner, c.id, entry.id) : sourceURL(this.cat, entry.file, entry.lines);
        return row(nameOf(c, entry), href, entry.statement);
      })));
    }
    const uses = c.outline.edges.filter((edge) => edge.to === node.id || edge.from === node.id);
    if (uses.length) box.append(expand("Outline connections · " + uses.length,
      ...uses.map((edge) => {
        const incoming = edge.to === node.id;
        const neighbour = byId(c.outline.nodes, incoming ? edge.from : edge.to);
        return row(neighbour.title, address("chapter", c.id, { node: neighbour.id }),
          (incoming ? "Supplies this node" : "Uses this node") + " · " + edge.uses + " declaration references");
      })));
    return box;
  }
  memberRow(c, entry) {
    const note = noteEntry(c, entry.id);
    const a = row(nameOf(c, entry), memberHref(c, entry), [entry.kind, note?.where, entry.placed ? "on the map" : "no map position"].filter(Boolean).join(" · "));
    a.dataset.member = entry.id;
    return a;
  }
  memberList(c) {
    const members = Object.values(c.members);
    return card("members", "Chapter members", expand("List all " + members.length + " declarations",
      ...members.map((m) => this.memberRow(c, m))));
  }
  member(index, c, entry, endpointId) {
    const result = view("member");
    const note = noteEntry(c, entry.id);
    result.append(trail([...this.path(index, c, endpointId), [nameOf(c, entry), address("chapter", c.id, { member: entry.id })]]),
      declarationTitle(nameOf(c, entry)), p(entry.kind + " · " + rangeName(entry.lines), "reader-meta"),
      p(entry.statement), sourceLink(this.cat, entry.file, entry.lines));
    if (note?.item) result.append(row(note.where + " · page " + note.page, viewer(note.item, entry.id)));
    if (entry.proof) result.append(row("Structured proof", address("proof", entry.id)));
    result.append(this.usage(c, entry), p(kernelText(entry.kernel), "small"));
    return result;
  }
  outside(index, owner, c, decl) {
    const result = view("outside");
    const inputs = c.imports.filter((x) => x.owner === owner.id);
    const users = c.consumers.find((u) => u.owner === owner.id)?.users || [];
    const selected = [...inputs, ...users].find((entry) => entry.id === decl);
    const chapterAddress = outsideHref(owner.id, c.id, decl);
    result.append(trail([...this.path(index, c), ["Chapter " + owner.id, chapterAddress]]),
      title(owner.title || "Chapter " + owner.id), p("Chapter " + owner.id + " · outside this release", "reader-meta"),
      p("The ledger identifies this chapter as the owner. Its note and chapter sheet have not been published in this release."));
    const showImport = (entry) => element("section", "outside-declaration", element("h4", "", nameOf(c, entry)), p(entry.statement),
      p(this.importState(entry), "small"), sourceLink(this.cat, entry.file, entry.lines, "Open Lean source · " + rangeName(entry.lines)));
    if (selected) {
      if (inputs.includes(selected)) result.append(showImport(selected));
      else result.append(p(nameOf(c, selected)), sourceLink(this.cat, selected.file, selected.lines));
    }
    if (inputs.length) result.append(card("supplies", "Supplies chapter " + c.id, portion(inputs.filter((e) => e.id !== selected?.id), selected ? 0 : 2, "imports", showImport)));
    if (users.length) result.append(card("uses", "Declarations using chapter " + c.id, portion(users, 3, "users", (u) =>
      row(nameOf(c, u), Number.isInteger(u.atlasRow) ? address("theorem", u.atlasRow) : sourceURL(this.cat, u.file, u.lines), rangeName(u.lines)))));
    result.append(row("Return to " + c.title, address("chapter", c.id), "Chapter " + c.id), p(kernelText(owner.kernel), "small"));
    return result;
  }
  proofPage(index, c, proof, selected, lookup, endpointId) {
    const result = view(selected ? "step" : "proof"), name = nameOf(c, proof);
    const href = (step) => address("proof", proof.id, { step: step?.id });
    const path = [...this.path(index, c, endpointId), [name, href()]];
    if (selected) path.push(["Step " + selected.number, href(selected)]);
    const where = noteEntry(c, proof.id);
    result.append(trail(path), declarationTitle(name), p("Structured proof · " + proof.kind + " · " + rangeName(proof.lines), "reader-meta"),
      p("This is an English reading of the Lean proof. The Lean text is the authority. Each step quotes its lines. " + reviewCounts(proof.counts), "reader-evidence"));
    if (selected) {
      result.append(this.stepDetail(c, proof, selected, lookup));
    } else {
      result.append(p(proof.show, "intro"), p(proof.strategy));
      if (proof.assume.length) result.append(expand("Assumptions", ...proof.assume.map((s) => p(s))));
    }
    if (where?.item) result.append(row((selected ? "Read this step in the note" : "Read this proof in the note"),
      viewer(where.item, proof.id, selected?.id), where.where + " · page " + where.page));
    if (selected) {
      const steps = [...lookup.values()], position = steps.indexOf(selected);
      const prev = steps[position - 1], next = steps[position + 1];
      const nav = element("nav", "step-controls");
      nav.setAttribute("aria-label", "Steps in proof order");
      if (prev) nav.append(anchor("← " + prev.number, href(prev), "quiet"));
      if (next) nav.append(anchor(next.number + " →", href(next), "quiet"));
      result.append(nav);
    }
    const tree = (steps) => {
      const list = element("ol", "step-tree");
      for (const step of steps) {
        const a = anchor(element("span", "step-number", step.number), href(step), "step-link");
        a.dataset.step = step.id;
        if (selected?.id === step.id) a.setAttribute("aria-current", "step");
        a.append(element("span", "step-claim", codeWords(step.claim)));
        const li = element("li", "", a, element("span", "step-meta", step.kind + " · ", sourceLink(this.cat, proof.file, step.headLines, rangeName(step.headLines))));
        if (step.children.length) li.append(tree(step.children));
        list.append(li);
      }
      return list;
    };
    result.append(card("steps", "Proof steps", tree(proof.steps)));
    result.append(expand("Complete Lean declaration · " + rangeName(proof.lines), leanPreview({ name, label: "Lean declaration", lines: proof.source,
      first: proof.lines[0], marked: selected?.headLines, complete: true, copyLabel: "Copy all" }),
      sourceLink(this.cat, proof.file, proof.lines)));
    if (proof.uses.length) result.append(expand("References recorded for the declaration · " + proof.uses.length,
      p("These references are attached to the declaration as a whole.", "small"), ...proof.uses.map((u) => this.reference(c, u))));
    result.append(row("Open the theorem inspector", address("theorem", proof.atlasRow), name), p(kernelText(proof.kernel), "small"));
    return result;
  }
  reference(c, use) {
    const a = row(nameOf(c, use), knownReference(this.cat, c, use), [use.kind, use.owner ? "Chapter " + use.owner : null].filter(Boolean).join(" · "));
    a.dataset.use = use.id;
    return a;
  }
  stepDetail(c, proof, step, lookup) {
    const detail = card("step", "Step " + step.number, p(step.claim, "step-prose"));
    detail.dataset.selectedStep = step.id;
    const head = step.headLines;
    detail.append(p(step.kind + " · " + (step.children.length ? "head " : "") + rangeName(head), "reader-meta"),
      leanPreview({ name: nameOf(c, proof), label: "Marked Lean source", lines: step.snippet.split("\n"), first: head[0], marked: head }),
      sourceLink(this.cat, proof.file, head, "Open Lean source · " + rangeName(head)));
    if (step.children.length) detail.append(p("This step with its children spans " + rangeName(step.lines) + ".", "small"));
    if (step.typedFact) detail.append(element("h4", "", "Typed fact"), element("pre", "typed-fact", step.typedFact));
    if (step.uses.length) detail.append(element("h4", "", "Uses"), ...step.uses.map((u) => this.reference(c, u)));
    if (step.refs.length) detail.append(element("h4", "", "Referenced steps"), ...step.refs.map((id) => {
      const other = lookup.get(id);
      return other ? row(other.number, address("proof", proof.id, { step: id }), other.claim) : element("code", "", id);
    }));
    detail.append(p(step.secondRead ? "A second reader compared this claim with these lines." : "A second-reader comparison is unrecorded for this step.", "small"));
    return detail;
  }
}
