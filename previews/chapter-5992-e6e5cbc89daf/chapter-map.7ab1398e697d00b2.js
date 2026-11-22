// The chapter geometry is in the same Mercator plane as the original atlas.
const NS = "http://www.w3.org/2000/svg";
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
function svg(tag, attrs, parent, text) {
  const e = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs || {})) e.setAttribute(name, value);
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}
function mapLink(parent, href, label, attrs = {}) {
  const a = svg("a", { href, tabindex: 0, "aria-label": label, "data-map-action": "", ...attrs }, parent);
  svg("title", {}, a, label);
  return a;
}
function setAttrs(e, attrs) {
  for (const [name, value] of Object.entries(attrs)) e.setAttribute(name, value);
}
function medoid(rows, cat) {
  const placed = rows.filter((i) => Number.isInteger(i) && i >= 0 && i < cat.x.length && !cat.unplaced[i]);
  if (!placed.length) return null;
  const cx = placed.reduce((s, i) => s + cat.x[i], 0) / placed.length;
  const cy = placed.reduce((s, i) => s + cat.y[i], 0) / placed.length;
  const dist = (i) => (cat.x[i] - cx) ** 2 + (cat.y[i] - cy) ** 2;
  const id = placed.reduce((best, i) => dist(i) < dist(best) ? i : best);
  return [cat.x[id], cat.y[id]];
}
function shortText(name, limit) {
  return name.length > limit ? name.slice(0, limit - 1) + "…" : name;
}
function outlineTitle(parent, title, x, y, width) {
  const text = svg("text", { "text-anchor": "middle", "dominant-baseline": "central" }, parent);
  const spans = [svg("tspan", { x }, text)];
  const words = title.match(/(?:Theorem|Corollary|Lemma|Proposition)\s+\S+|\S+/g);
  for (const word of words) {
    const span = spans.at(-1), previous = span.textContent;
    span.textContent = previous ? previous + " " + word : word;
    if (previous && span.getComputedTextLength() > width) {
      span.textContent = previous;
      spans.push(svg("tspan", { x }, text, word));
    }
  }
  const leading = parseFloat(getComputedStyle(text).fontSize) * 1.08;
  spans.forEach((span, n) => span.setAttribute("y", y + (n - (spans.length - 1) / 2) * leading));
}
function memberName(chapter, id) {
  return chapter.note?.declarations?.[id]?.label || chapter.members[id]?.name || id;
}
const chapterHref = (id) => "#chapter=" + encodeURIComponent(id);
const proofHref = (id) => "#proof=" + encodeURIComponent(id);

// The underlying camera and point tree stay intact. This SVG adds focusable
// anchors at measured coordinates. Camera updates move existing anchors so a
// keyboard or pointer selection survives a pan or zoom within the same level.
export class ChapterMap {
  constructor(map, index) {
    this.map = map;
    this.index = index;
    this.components = index.components.map((component) => ({ ...component, anchor: medoid(component.atlasRows || [], map.cat) }));
    this.svg = svg("svg", { class: "chapter-map", role: "group", "aria-label": "Chapter regions and proof outline" });
  }
  show(chapter, node = null) {
    const map = this.map;
    const previous = map.chapterLayer === this ? this.chapter?.id || "directory" : null;
    this.chapter = chapter;
    this.pinned = node;
    this.hovered = null;
    this.nodeGeometry = null;
    this.renderKey = "";
    if (!this.svg.isConnected) map.view.append(this.svg);
    map.chapterLayer = this;
    map.setScene(false);
    const scene = document.querySelector("#scene"), bottom = document.querySelector("#mapbarBottom");
    bottom.classList.toggle("chapter-location", Boolean(chapter));
    if (chapter) {
      const label = document.createElement("strong"), position = document.createElement("small");
      label.textContent = chapter.title;
      const component = this.index.components.find((c) => c.id === chapter.component);
      position.textContent = (component?.title || chapter.component) + " · " + chapter.regions.clusters.map((r) => r.count + " near " + r.subject).concat(chapter.regions.outliers.length + " elsewhere", chapter.regions.unplaced.length + " unplaced").join(" · ");
      scene.replaceChildren(label, position);
    }
    const changed = previous !== (chapter?.id || "directory");
    if (changed) {
      if (chapter?.regions.clusters.length) this.locate(chapter.regions.clusters[0], false);
      else map.fit();
    }
    map.drawSoon();
  }
  locate(cluster, near) {
    const map = this.map, baseline = map.unit / map.zoom;
    const zoom = cluster.radius > 0 ? Math.min(map.width, map.height) * .30 / (baseline * cluster.radius) : 160;
    map.go(...cluster.center, near ? clamp(zoom, 24, 10000) : clamp(zoom, 3.1, 9));
  }
  detach() {
    this.svg.remove();
    this.map.chapterLayer = null;
    this.map.setScene(this.map.unplaced);
    document.querySelector("#mapbarBottom").classList.remove("chapter-location");
    delete this.map.view.dataset.mapMode;
    delete this.map.view.dataset.outsideOpacity;
    this.map.drawSoon();
  }
  highlight(id) {
    if (id === this.hovered) return;
    this.hovered = id;
    this.map.drawSoon();
  }
  draw(map) {
    if (this.chapter) {
      // Dim the completely composed paper, written and native layers together.
      // Every placed member is drawn at full strength on the original coordinate.
      map.ctx.fillStyle = "rgba(16,26,28,0.75)";
      map.ctx.fillRect(0, 0, map.width, map.height);
    }
    const mode = map.zoom < 2.4 ? "far" : map.zoom < 20 ? "middle" : "near";
    map.view.dataset.mapMode = mode;
    map.view.dataset.outsideOpacity = this.chapter ? "0.25" : "1";
    const key = [mode, this.chapter?.id, map.width, map.height, map.show.lean, map.show.labels].join("|");
    if (key !== this.renderKey) {
      this.build(map, mode);
      this.renderKey = key;
      this.cameraKey = "";
    }
    const camera = [map.unit, map.left, map.top, this.hovered, this.pinned].join("|");
    if (camera === this.cameraKey) return;
    this.cameraKey = camera;
    this.position(map, mode);
  }
  build(map, mode) {
    this.svg.replaceChildren();
    this.regions = [];
    this.dots = [];
    this.labels = [];
    this.nodePositions = new Map();
    this.nodeGeometry = null;
    setAttrs(this.svg, { viewBox: "0 0 " + map.width + " " + map.height, "data-map-mode": mode });
    const defs = svg("defs", {}, this.svg);
    const arrow = svg("marker", { id: "chapter-arrow", viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 5, markerHeight: 5, orient: "auto" }, defs);
    svg("path", { d: "M0 0L8 4L0 8Z", fill: "#9bb4a6" }, arrow);
    if (map.show.lean) for (const entry of this.chapter ? [this.chapter] : this.index.chapters) {
      for (const [index, region] of entry.regions.clusters.entries()) {
        const label = entry.title + " · " + region.count + " placed near " + region.subject;
        const g = mapLink(this.svg, chapterHref(entry.id), label, { class: "chapter-region", "data-region": index, "data-count": region.count });
        g.addEventListener("click", (event) => {
          if (this.chapter?.id === entry.id && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
            event.preventDefault();
            this.locate(region, false);
          }
        });
        const circle = svg("circle", { class: "region-circle" }, g);
        let text;
        if (map.show.labels && mode !== "near") text = svg("text", { class: "region-label", "text-anchor": "middle" }, g,
          this.chapter ? region.count + " · " + shortText(region.subject, 32) : entry.title + " · " + region.count);
        this.regions.push({ region, g, circle, text });
      }
      if (!this.chapter) continue;
      const outliers = new Set(entry.regions.outliers);
      const outsideReach = new Set(entry.regions.outsideReach);
      for (const [id, member] of Object.entries(entry.members)) {
        if (!member.placed || !member.point || outsideReach.has(id)) continue;
        const href = Number.isInteger(member.atlasRow) ? "#theorem=" + member.atlasRow : proofHref(id);
        const name = memberName(entry, id);
        const g = mapLink(this.svg, href, name, {
          class: "chapter-dot" + (outliers.has(id) ? " is-outlier" : ""), "data-map-member": id,
          "data-outlier": outliers.has(id),
        });
        svg("circle", { r: 7.5, class: "point-target" }, g);
        svg("circle", { r: mode === "near" ? 4 : 3.3, class: "member-mark" }, g);
        this.dots.push({ id, g, point: member.point });
      }
    }
    if (mode === "far" && map.show.labels) this.buildComponents(map);
    if (this.chapter && mode === "middle" && map.show.lean) this.buildOutline(map);
  }
  buildComponents(map) {
    const ordered = this.components.filter((c) => c.anchor).sort((a, b) => a.anchor[0] - b.anchor[0]);
    // Give each label its own slot and connect it to a real blueprint declaration.
    const mid = Math.ceil(ordered.length / 2);
    for (const [side, half] of [ordered.slice(0, mid), ordered.slice(mid)].entries()) {
      half.sort((a, b) => b.anchor[1] - a.anchor[1]);
      for (const [slot, c] of half.entries()) {
        const g = mapLink(this.svg, "#component=" + encodeURIComponent(c.id), c.title + " · blueprint component", {
          class: "component-label", "data-map-component": c.id,
        });
        const line = svg("line", {}, g);
        const dot = svg("circle", { r: 2 }, g);
        const width = Math.min(157, map.width * .34);
        const back = svg("rect", { width, height: 19, rx: 3 }, g);
        const title = svg("text", {}, g, shortText(c.title, Math.floor(width / 6.5)));
        this.labels.push({ side, slot, total: half.length, anchor: c.anchor, line, dot, back, title, width });
      }
    }
  }
  buildOutline(map) {
    const chapter = this.chapter, nodes = chapter.outline.nodes;
    const body = nodes.filter((n) => n.id !== "setting"), setting = nodes.find((n) => n.id === "setting");
    const compact = map.width < 620;
    const width = Math.min(640, map.width - (compact ? 57 : 94));
    const height = Math.min(270, map.height - (compact ? 130 : 145));
    if (width < 140 || height < 112) return;
    const root = svg("g", { class: "map-outline", "aria-label": "Chapter proof outline" }, this.svg);
    this.memberLines = svg("g", { class: "member-connectors", "aria-hidden": true }, this.svg);
    svg("rect", { width, height, rx: 9, class: "outline-paper" }, root);
    const gap = 7, columns = compact ? 3 : 4, rows = Math.ceil(body.length / columns);
    const top = 31, bottom = 36;
    const colWidth = (width - 2 * gap) / columns;
    const rowHeight = (height - top - bottom) / rows;
    const boxW = colWidth - 8, boxH = clamp(rowHeight - 4, 18, 43);
    const positions = this.nodePositions;
    const addNode = (node, idx) => {
      const x = gap + colWidth * (idx % columns + .5), y = top + rowHeight * (Math.floor(idx / columns) + .5);
      positions.set(node.id, { x, y, width: boxW, height: boxH });
    };
    body.forEach(addNode);
    this.edgeEls = [];
    const edges = svg("g", { class: "outline-edges", "aria-hidden": true }, root);
    for (const edge of chapter.outline.edges) {
      const a = positions.get(edge.from), b = positions.get(edge.to);
      if (!a || !b) continue; // Setting is the legend.
      const dx = b.x - a.x, dy = b.y - a.y;
      const stop = Math.min(Math.abs((boxW / 2 + 1) / dx), Math.abs((boxH / 2 + 1) / dy));
      const line = svg("line", { x1: a.x + dx * stop, y1: a.y + dy * stop, x2: b.x - dx * stop, y2: b.y - dy * stop, "marker-end": "url(#chapter-arrow)" }, edges);
      this.edgeEls.push({ line, edge });
    }
    for (const node of nodes) {
      const isSetting = node === setting;
      const g = mapLink(root, chapterHref(chapter.id) + "&node=" + encodeURIComponent(node.id),
        node.title + ". " + node.text + " · " + node.declarations.length + " members", {
          "data-outline-node": node.id, class: isSetting ? "outline-setting" : "outline-node",
        });
      g.addEventListener("pointerenter", () => this.highlight(node.id));
      g.addEventListener("pointerleave", () => this.highlight(null));
      g.addEventListener("focus", () => this.highlight(node.id));
      g.addEventListener("blur", () => this.highlight(null));
      if (isSetting) {
        svg("text", { x: 9, y: 18 }, g, "Setting · " + node.declarations.length + " declarations");
        positions.set(node.id, { x: 62, y: 14, g });
      } else {
        const pos = positions.get(node.id);
        pos.g = g;
        svg("rect", { x: pos.x - boxW / 2, y: pos.y - boxH / 2, width: boxW, height: boxH, rx: 4 }, g);
        outlineTitle(g, node.title, pos.x, pos.y, boxW - 7);
      }
    }
    this.buildStubs(root, chapter, width, height, compact, positions);
    this.nodeGeometry = { root, width, height };
  }
  buildStubs(root, chapter, width, height, compact, positions) {
    const cited = new Set(chapter.outline.nodes.flatMap((n) => n.takes_for_granted));
    const imported = chapter.imports.filter((entry) => cited.has(entry.id) && entry.owner);
    if (imported.length) {
      const current = imported.find((e) => e.id === this.stubId) || imported.find((e) => /(?:^|\.)Tower\.desc$/.test(e.name)) || imported[0];
      const inputs = svg("g", { class: "import-stub-lines" }, root);
      const g = mapLink(root, "", "", { class: "map-stub" });
      const label = svg("text", { x: 9, y: height - 12 }, g);
      const choose = (entry) => {
        this.stubId = entry.id;
        const name = chapter.note.declarations[entry.id]?.label || entry.name;
        const meaning = name + " · supplied by chapter " + entry.owner;
        setAttrs(g, { href: chapterHref(entry.owner) + "&via=" + chapter.id + "&decl=" + encodeURIComponent(entry.id), "aria-label": meaning, "data-map-import": entry.id });
        g.querySelector("title").textContent = meaning;
        label.textContent = "← " + shortText(name, compact ? 11 : 25) + " · " + entry.owner;
        inputs.replaceChildren();
        for (const n of chapter.outline.nodes.filter((n) => n.takes_for_granted.includes(entry.id))) {
          const to = positions.get(n.id);
          if (to) svg("line", { x1: 25, y1: height - 28, x2: to.x, y2: to.y + (to.height || 0) / 2, class: "stub-line" }, inputs);
        }
      };
      choose(current);
      const menuWidth = compact ? 94 : 145;
      const menu = svg("foreignObject", { x: width - menuWidth - 6, y: 3, width: menuWidth, height: 24, "data-map-action": "" }, root);
      const select = document.createElement("select");
      select.className = "map-input-select";
      select.setAttribute("aria-label", "Choose an input stub from the note");
      for (const entry of imported) {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = (chapter.note.declarations[entry.id]?.label || entry.name) + " · " + entry.owner;
        select.append(option);
      }
      select.value = current.id;
      select.addEventListener("change", () => choose(imported.find((e) => e.id === select.value)));
      menu.append(select);
    }
    for (const [i, c] of chapter.consumers.entries()) {
      const node = chapter.outline.nodes.findLast((n) => n.declarations.some((id) => c.ids.includes(id)));
      const from = positions.get(node?.id);
      const x = width - 8 - (chapter.consumers.length - 1 - i) * (compact ? 43 : 55);
      if (from) svg("line", { x1: from.x, y1: from.y + (from.height || 0) / 2, x2: x - 12, y2: height - 27, class: "stub-line" }, root);
      const g = mapLink(root, chapterHref(c.owner) + "&via=" + chapter.id, "Used by chapter " + c.owner, {
        class: "map-stub", "data-map-consumer": c.owner,
      });
      svg("text", { x, y: height - 12, "text-anchor": "end" }, g, (compact ? "" : "→ ") + c.owner);
    }
  }
  position(map, mode) {
    for (const { region, g, circle, text } of this.regions) {
      const x = map.px(region.center[0]), y = map.py(region.center[1]), radius = region.radius * map.unit;
      setAttrs(g, { transform: "translate(" + x + " " + y + ")" });
      setAttrs(circle, { r: Math.max(2.2, radius) });
      if (text) setAttrs(text, { y: -Math.min(radius, 48) - 8 });
    }
    for (const { g, point } of this.dots)
      setAttrs(g, { transform: "translate(" + map.px(point[0]) + " " + map.py(point[1]) + ")" });
    for (const { side, slot, total, anchor, line, dot, back, title, width } of this.labels) {
      const x = side ? map.width - width - 9 : 9;
      const y = 78 + slot * Math.min(30, (map.height - 133) / Math.max(1, total - 1));
      const px = map.px(anchor[0]), py = map.py(anchor[1]);
      setAttrs(line, { x1: side ? x : x + width, y1: y, x2: px, y2: py });
      setAttrs(dot, { cx: px, cy: py });
      setAttrs(back, { x, y: y - 9.5 });
      setAttrs(title, { x: x + 6, y: y + 3.5 });
    }
    if (!this.nodeGeometry || mode !== "middle") return;
    const { root, width, height } = this.nodeGeometry;
    const center = this.chapter.regions.clusters[0]?.center;
    if (!center) return;
    const cx = map.px(center[0]), cy = map.py(center[1]);
    const inView = cx >= -20 && cy >= -20 && cx <= map.width + 20 && cy <= map.height + 20;
    root.style.display = inView ? "" : "none";
    this.memberLines.replaceChildren();
    if (!inView) return;
    const left = clamp(cx - width / 2, 5, map.width - width - 49);
    const foot = document.querySelector("#mapbarBottom").offsetHeight + 17;
    const top = clamp(cy - height / 2, 67, map.height - height - foot);
    setAttrs(root, { transform: "translate(" + left + " " + top + ")" });
    const selected = this.hovered || this.pinned;
    for (const [id, pos] of this.nodePositions) pos.g?.classList.toggle("is-selected", selected === id);
    for (const { line, edge } of this.edgeEls) line.classList.toggle("is-selected", selected === edge.from || selected === edge.to);
    const pos = this.nodePositions.get(selected);
    const node = this.chapter.outline.nodes.find((n) => n.id === selected);
    const ids = new Set(node?.declarations);
    for (const { id, g, point } of this.dots) {
      g.classList.toggle("is-selected", ids.has(id));
      if (!pos || !ids.has(id)) continue;
      svg("line", { x1: left + pos.x, y1: top + pos.y, x2: map.px(point[0]), y2: map.py(point[1]), "data-member-line": id }, this.memberLines);
      svg("circle", { cx: map.px(point[0]), cy: map.py(point[1]), r: 3.1 }, this.memberLines);
    }
  }
}
