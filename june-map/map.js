import {dataURL} from "./papers.js";
import {drawPalettePapers} from "./palette.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const inBox = (x, y, b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
export const isMath = category => /^math(?:[.-]|$)/i.test(category || "");
const mathPaper = paper => isMath(paper.category);

class DensityTiles {
  constructor(spec, redraw) {
    this.spec = spec;
    this.redraw = redraw;
    this.cache = new Map();
  }
  request(z, x, y) {
    const key = [z, x, y].join("/");
    let item = this.cache.get(key);
    if (item) return item;
    const image = new Image();
    item = {image, loaded: false};
    this.cache.set(key, item);
    image.onload = () => { item.loaded = true; this.redraw(); };
    image.onerror = () => { item.failed = true; };
    image.src = dataURL(this.spec.template.replace("{z}", z).replace("{x}", x).replace("{y}", y));
    // The root remains an instant fallback throughout a long visit.
    if (this.cache.size > 220) {
      for (const [oldKey, old] of this.cache) {
        if (oldKey !== "0/0/0" && (old.loaded || old.failed)) { this.cache.delete(oldKey); break; }
      }
    }
    return item;
  }
  draw(map) {
    const {ctx, world, dpr} = map;
    const [left, top] = map.screen(world[0], world[3]);
    const side = (world[2] - world[0]) * map.scale;
    const z = clamp(Math.round(Math.log2(side / this.spec.tileSize)), 0, this.spec.maxZoom);
    const n = 2 ** z, step = side / n;
    const x0 = clamp(Math.floor(-left / step), 0, n - 1), x1 = clamp(Math.floor((map.width - left) / step), 0, n - 1);
    const y0 = clamp(Math.floor(-top / step), 0, n - 1), y1 = clamp(Math.floor((map.height - top) / step), 0, n - 1);
    this.request(0, 0, 0);
    const align = value => Math.round(value * dpr) / dpr;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let source = this.request(z, x, y);
      let factor = 1;
      for (let parent = z - 1; !source.loaded && parent >= 0; parent--) {
        factor *= 2;
        source = this.cache.get([parent, Math.floor(x / factor), Math.floor(y / factor)].join("/")) || {};
      }
      if (!source.loaded) continue;
      const width = source.image.naturalWidth / factor;
      const dx = align(left + step * x), dy = align(top + step * y);
      ctx.drawImage(source.image, (x % factor) * width, (y % factor) * width, width, width,
        dx, dy, align(left + step * (x + 1)) - dx, align(top + step * (y + 1)) - dy);
    }
  }
}

function linesFor(ctx, name, limit) {
  const words = name.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && ctx.measureText(line + " " + word).width > limit) {
      lines.push(line);
      if (lines.length === 2) break;
      line = word;
    } else line = line ? line + " " + word : word;
  }
  if (lines.length < 2 && line) lines.push(line);
  if (lines.length && (lines.join(" ") !== words.join(" ") || ctx.measureText(lines.at(-1)).width > limit)) {
    let last = lines.at(-1);
    while (last && ctx.measureText(last + "…").width > limit) last = last.slice(0, -1);
    lines[lines.length - 1] = last.trimEnd() + "…";
  }
  return lines;
}

export class JuneMap {
  constructor(viewport, manifest, levels, placements, papers, events) {
    this.el = viewport;
    this.canvas = viewport.querySelector("canvas");
    this.ctx = this.canvas.getContext("2d", {alpha: false});
    this.manifest = manifest;
    this.world = manifest.world;
    this.levels = levels;
    this.placements = placements;
    this.papers = papers;
    this.events = events;
    this.zoom = 1;
    this.layers = {density: true, math: false, labels: true, lean: true, level: "auto"};
    this.tiles = new DensityTiles(manifest.tiles, () => this.drawSoon());
    if (manifest.mathTiles) this.mathTiles = new DensityTiles(manifest.mathTiles, () => this.drawSoon());
    this.visiblePapers = [];
    this.pointer = new Map();
    this.paperVersion = 0;
    this.labelMetrics = new Map();
    this.fit();
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(viewport);
    this.bind();
  }
  resize() {
    const rect = this.el.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.fitScale = Math.min((this.width * .96) / (this.world[2] - this.world[0]),
      (this.height * .96) / (this.world[3] - this.world[1]));
    this.changed();
  }
  get scale() { return this.fitScale * this.zoom; }
  get levelIndex() {
    return this.layers.level === "auto"
      ? clamp(Math.floor(Math.log2(this.zoom) * 1.2 + .12), 0, this.levels.length - 1)
      : this.levels.findIndex(group => String(group.level) === this.layers.level);
  }
  get pointZoom() {
    return (2 ** (this.manifest.papers?.minZoom ?? 6)) * this.manifest.tiles.tileSize /
      ((this.world[2] - this.world[0]) * this.fitScale);
  }
  get canPick() { return !!this.papers && this.zoom >= this.pointZoom * .999; }
  screen(x, y) {
    return [(x - this.x) * this.scale + this.width / 2, (this.y - y) * this.scale + this.height / 2];
  }
  unproject(px, py) {
    return [this.x + (px - this.width / 2) / this.scale, this.y - (py - this.height / 2) / this.scale];
  }
  worldBox(radius = null, at = [this.width / 2, this.height / 2]) {
    const low = radius === null ? [0, this.height] : [at[0] - radius, at[1] + radius];
    const high = radius === null ? [this.width, 0] : [at[0] + radius, at[1] - radius];
    return [...this.unproject(...low), ...this.unproject(...high)];
  }
  fit() {
    this.x = (this.world[0] + this.world[2]) / 2;
    this.y = (this.world[1] + this.world[3]) / 2;
    this.zoom = 1;
    if (this.fitScale) this.changed();
  }
  go(x, y, zoom) {
    this.x = x; this.y = y; this.zoom = clamp(zoom, 1, 320);
    this.changed();
  }
  regionZoom(region) {
    const [xmin, ymin, xmax, ymax] = region.bbox;
    const byBox = .88 * Math.min(this.width / Math.max(xmax - xmin, 1e-9),
      this.height / Math.max(ymax - ymin, 1e-9)) / this.fitScale;
    const index = this.levels.findIndex(group => group.level === region.level);
    return clamp(Math.max(byBox, 2 ** (index / 1.2)), 1.45, 64);
  }
  zoomAt(factor, before = [this.width / 2, this.height / 2], after = before) {
    const anchor = this.unproject(...before);
    this.zoom = clamp(this.zoom * factor, 1, 320);
    this.x = anchor[0] - (after[0] - this.width / 2) / this.scale;
    this.y = anchor[1] + (after[1] - this.height / 2) / this.scale;
    this.changed();
  }
  changed() {
    this.x = clamp(this.x, this.world[0], this.world[2]);
    this.y = clamp(this.y, this.world[1], this.world[3]);
    this.drawSoon();
    this.events.camera(this);
    this.refreshPapers();
  }
  setLayer(name, value) {
    this.layers[name] = value;
    this.changed();
  }
  refreshPapers() {
    clearTimeout(this.paperTimer);
    const version = ++this.paperVersion;
    if (!this.canPick) { this.visiblePapers = []; return; }
    this.paperTimer = setTimeout(async () => {
      try {
        const points = await this.papers.inBox(this.worldBox(), 26000);
        if (version === this.paperVersion) {
          this.visiblePapers = this.layers.math ? points.filter(mathPaper) : points;
          this.drawSoon();
        }
      } catch (error) { if (version === this.paperVersion) this.events.error(error); }
    }, 140);
  }
  select(item) { this.selected = item; this.drawSoon(); }
  drawSoon() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.draw(); });
  }
  draw() {
    const {ctx, width, height} = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#101a1c"; ctx.fillRect(0, 0, width, height);
    if (this.layers.density) (this.layers.math && this.mathTiles ? this.mathTiles : this.tiles).draw(this);
    this.labelHits = []; this.leanHits = [];
    if (this.canPick && this.layers.density) this.drawPapers();
    if (this.layers.lean) this.drawLean();
    if (this.layers.labels && this.levels.length) this.drawLabels();
    if (this.selected) this.drawSelection();
    this.el.dataset.level = this.levels[this.levelIndex]?.level ?? "";
    this.el.dataset.zoom = this.zoom.toFixed(3);
    this.el.dataset.exact = String(this.canPick);
    this.el.dataset.labels = this.labelHits.length;
    this.el.dataset.anchors = this.leanHits.length;
    this.proofPosition?.();
  }
  drawPapers() {
    if (this.topicPalette && drawPalettePapers(this, mathPaper)) return;
    const {ctx} = this;
    ctx.fillStyle = this.layers.math ? "#c8efd5" : "#dceadf";
    const radius = Math.min(3, 1.35 + Math.log2(this.zoom / this.pointZoom + 1) * .4);
    ctx.beginPath();
    for (const paper of this.visiblePapers) {
      if (this.layers.math && !mathPaper(paper)) continue;
      const [x, y] = this.screen(paper.x, paper.y);
      if (x < -3 || x > this.width + 3 || y < -3 || y > this.height + 3) continue;
      ctx.moveTo(x + radius, y); ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  drawLean() {
    const {ctx} = this;
    for (const place of this.placements) {
      const [x, y] = this.screen(place.x, place.y);
      if (x < -12 || x > this.width + 12 || y < -12 || y > this.height + 12) continue;
      const r = this.zoom < 2 ? 4.2 : 5.0;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
      ctx.lineWidth = 3; ctx.strokeStyle = "#182b25"; ctx.stroke();
      ctx.fillStyle = "#ffc372"; ctx.fill();
      ctx.lineWidth = 1.1; ctx.strokeStyle = "#fff3da"; ctx.stroke();
      this.leanHits.push({x, y, item: place});
    }
  }
  drawLabels() {
    const {ctx} = this;
    const group = this.levels[this.levelIndex];
    if (!group) return;
    const compact = this.width < 520;
    const font = this.levelIndex < 3 ? (compact ? 13 : 15) : (compact ? 12 : 13);
    const maxWidth = compact ? 118 : 160;
    const lineHeight = font + 2;
    ctx.font = `600 ${font}px system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    const avoid = [[0, 0, 115, 63], [this.width - 65, 0, this.width, 205],
      [0, this.height - 45, 191, this.height], [this.width - 65, this.height - 45, this.width, this.height]];
    for (const region of group.regions) {
      const [x, y] = this.screen(region.x, region.y);
      if (x < 6 || x > this.width - 6 || y < 6 || y > this.height - 6) continue;
      const key = [font, maxWidth, region.key].join("/");
      let metrics = this.labelMetrics.get(key);
      if (!metrics) {
        const lines = linesFor(ctx, region.label, maxWidth);
        const w = Math.max(...lines.map(line => ctx.measureText(line).width));
        metrics = {lines, w}; this.labelMetrics.set(key, metrics);
      }
      const {lines, w} = metrics;
      const h = lineHeight * lines.length;
      const center = clamp(x, w / 2 + 5, this.width - w / 2 - 5);
      const broadest = this.levelIndex === 0;
      const distances = broadest ? [7, 19, 35, 54, 78, 102, 132] : [7];
      const options = [];
      for (const gap of distances) {
        options.push([center, y - gap - h / 2], [center, y + gap + h / 2],
          [x + w / 2 + gap, y], [x - w / 2 - gap, y]);
        if (broadest) {
          const offset = Math.min(w * .5, gap);
          for (const side of [-1, 1]) options.push([center + side * offset, y - gap - h / 2],
            [center + side * offset, y + gap + h / 2]);
        }
      }
      let chosen;
      for (const [tx, ty] of options) {
        const box = [tx - w / 2 - 4, ty - h / 2 - 3, tx + w / 2 + 4, ty + h / 2 + 3];
        if (box[0] < 1 || box[2] > this.width - 1 || box[1] < 2 || box[3] > this.height - 2) continue;
        if (avoid.some(other => overlaps(box, other)) || this.leanHits.some(hit => inBox(hit.x, hit.y, box))) continue;
        chosen = {tx, ty, box}; break;
      }
      if (!chosen) continue;
      const {tx, ty, box} = chosen;
      avoid.push([box[0] - 3, box[1] - 3, box[2] + 3, box[3] + 3]);
      this.labelHits.push({box, x, y, item: region});
      const endX = clamp(x, box[0] + 3, box[2] - 3), endY = clamp(y, box[1] + 2, box[3] - 2);
      if (Math.hypot(endX - x, endY - y) > 12) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(endX, endY);
        ctx.strokeStyle = "#19241df2"; ctx.lineWidth = 3; ctx.stroke();
        ctx.strokeStyle = "#e0ead3b8"; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.fillStyle = "#cfe5ce"; ctx.beginPath(); ctx.arc(x, y, 1.9, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = "#f1f7ec"; ctx.strokeStyle = "#15201df2"; ctx.lineWidth = 3.5;
      lines.forEach((line, i) => {
        const rowY = ty + (i - (lines.length - 1) / 2) * lineHeight;
        ctx.strokeText(line, tx, rowY); ctx.fillText(line, tx, rowY);
      });
    }
  }
  drawSelection() {
    const {ctx, selected} = this;
    const [x, y] = this.screen(selected.x, selected.y);
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.lineWidth = 4; ctx.strokeStyle = "#24312b"; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = "#fff2a9"; ctx.stroke();
  }
  hit(x, y) {
    const anchors = (this.leanHits || []).map(hit => ({...hit, distance: Math.hypot(x - hit.x, y - hit.y)}))
      .filter(hit => hit.distance < 9).sort((a, b) => a.distance - b.distance);
    if (anchors.length) return {kind: "placement", item: anchors[0].item};
    const label = (this.labelHits || []).find(hit => inBox(x, y, hit.box) || Math.hypot(x - hit.x, y - hit.y) < 5);
    return label ? {kind: "region", item: label.item} : null;
  }
  async pick(at, centered = false) {
    if (!this.papers) return;
    if (!this.canPick && centered) this.go(this.x, this.y, this.pointZoom * 1.18);
    if (!this.canPick) return;
    const version = this.paperVersion;
    const radius = centered ? Math.min(120, this.width / 4) : 15;
    const papers = await this.papers.inBox(this.worldBox(radius, at));
    if (version !== this.paperVersion) return;
    const [cx, cy] = this.unproject(...at);
    const hits = papers.filter(p => (!this.layers.math || mathPaper(p)) &&
      Math.hypot(p.x - cx, p.y - cy) * this.scale <= radius);
    hits.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy) || a.id.localeCompare(b.id));
    if (centered) this.events.near(hits.slice(0, 12));
    else if (hits[0]) this.events.select("paper", hits[0]);
    else this.events.notice("No paper at this point.");
  }
  point(event) {
    const box = this.el.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  }
  gesture() {
    const points = [...this.pointer.values()].map(p => p.now);
    if (points.length < 2) return {at: points[0], distance: 0};
    return {at: [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2],
      distance: Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1])};
  }
  bind() {
    this.el.addEventListener("wheel", event => {
      event.preventDefault();
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1;
      this.zoomAt(Math.exp(-clamp(event.deltaY * units, -360, 360) * .0028), this.point(event));
    }, {passive: false});
    this.el.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      const at = this.point(event);
      this.el.focus({preventScroll: true});
      this.el.setPointerCapture(event.pointerId);
      this.pointer.set(event.pointerId, {start: at, now: at, moved: false});
      if (this.pointer.size > 1) for (const entry of this.pointer.values()) entry.moved = true;
      this.el.classList.add("dragging");
    });
    this.el.addEventListener("pointermove", event => {
      const at = this.point(event);
      const entry = this.pointer.get(event.pointerId);
      if (!entry) { this.el.classList.toggle("picking", !!this.hit(...at) || this.canPick); return; }
      const before = this.gesture();
      entry.now = at;
      if (Math.hypot(at[0] - entry.start[0], at[1] - entry.start[1]) > 5) entry.moved = true;
      const after = this.gesture();
      if (entry.moved) this.zoomAt(before.distance && after.distance ? after.distance / before.distance : 1, before.at, after.at);
    });
    const release = event => {
      const entry = this.pointer.get(event.pointerId);
      this.pointer.delete(event.pointerId);
      if (!this.pointer.size) this.el.classList.remove("dragging");
      if (!entry || entry.moved || event.type !== "pointerup") return;
      const at = this.point(event), hit = this.hit(...at);
      if (hit) this.events.select(hit.kind, hit.item);
      else this.pick(at).catch(this.events.error);
    };
    this.el.addEventListener("pointerup", release);
    this.el.addEventListener("pointercancel", release);
    this.el.addEventListener("lostpointercapture", release);
    this.el.addEventListener("keydown", event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const step = event.shiftKey ? 160 : 55;
      switch (event.key) {
        case "+": case "=": this.zoomAt(1.6); break;
        case "-": case "_": this.zoomAt(1 / 1.6); break;
        case "Home": this.fit(); break;
        case "ArrowLeft": this.go(this.x - step / this.scale, this.y, this.zoom); break;
        case "ArrowRight": this.go(this.x + step / this.scale, this.y, this.zoom); break;
        case "ArrowUp": this.go(this.x, this.y + step / this.scale, this.zoom); break;
        case "ArrowDown": this.go(this.x, this.y - step / this.scale, this.zoom); break;
        case "b": case "B": {
          const near = (this.leanHits || []).map(hit => ({item: hit.item, distance: Math.hypot(hit.x - this.width / 2, hit.y - this.height / 2)}))
            .sort((a, b) => a.distance - b.distance)[0];
          if (near && this.layers.lean) this.events.select("placement", near.item);
          else this.events.notice("No proof anchor in the current view.");
          break;
        }
        case "Enter": this.pick([this.width / 2, this.height / 2], true).catch(this.events.error); break;
        default: return;
      }
      event.preventDefault();
    });
  }
}
