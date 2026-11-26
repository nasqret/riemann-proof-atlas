/* versioned proof map */
import {setOriginalPointMap, drawOriginalSnapshot, hitOriginalSnapshot} from "../time-map/retained-points.js";
import {exclusiveProofLayer, draw as drawTime, activeHistoricalPin, historicalPin} from "../time-map/sky.js";
import { PointTree } from "../previews/chapter-5992-6fa73d518b93/point-tree.3cc85be4105f3ffa.js";
import { bytes, json, merc, fmt, scopePass } from "../previews/chapter-5992-6fa73d518b93/data.d84f1970349759e8.js";
const BASE = "data/base/";
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fineScale = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const coarseScale = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function labelLines(text) {
  const lines = [""];
  for (const word of text.split(/\s+/)) {
    const last = lines.length - 1;
    if (lines[last] && lines[last].length + word.length + 1 > 27) lines.push(word);
    else lines[last] = lines[last] ? lines[last] + " " + word : word;
  }
  if (lines.length <= 3) return lines;
  return [...lines.slice(0, 2), lines.slice(2).join(" ").slice(0, 25) + "…"];
}
export class AtlasMap {
  constructor(select, warn) {
    this.labelFont = getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim() || "system-ui, sans-serif";
    this.select = select;
    this.warn = warn;
    this.view = document.querySelector("#viewport");
    this.canvas = document.querySelector("#map");
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.screen = [];
    this.textHits = [];
    this.paperHits = [];
    this.images = new Map();
    this.vectors = new Map();
    this.vectorLoads = new Set();
    this.vectorLimit = 32;
    this.pointers = new Map();
    this.scope = "all";
    this.subject = "";
    this.evidence = "mask";
    this.placement = "all";
    this.filterBundle = null;
    this.selected = null;
    this.cx = 0;
    this.cy = 0;
    this.zoom = 1;
    this.unplaced = false;
    this.show = {
      papers: true,
      lean: true,
      labels: true,
      relations: true,
      generated: false,
    };
    this.edges = [];
    this.resize = new ResizeObserver(() => {
      this.size();
      this.drawSoon();
    });
    this.resize.observe(this.view);
    window.addEventListener("resize", () => this.drawSoon());
    this.interaction();
  }
  async baseLoad() {
    this.base = await json(BASE + "manifest.json");
    this.bounds = this.base.world;
    this.vectorIndex = new Map();
    for (const shard of this.base.points?.shards || []) {
      const key = shard.x + "," + shard.y;
      if (!this.vectorIndex.has(key)) this.vectorIndex.set(key, []);
      this.vectorIndex.get(key).push(shard);
    }
    this.size();
    this.fit();
    this.drawSoon();
    const labels = await json(
      BASE + (this.base.labels_gzip || this.base.labels),
    );
    this.labelById = new Map(labels.map((l) => [l.id, l]));
    this.levels = [];
    for (const l of labels) {
      if (l.named === false || !l.label) continue;
      l.my = merc(l.y);
      (this.levels[l.depth] ??= []).push(l);
    }
    this.drawSoon();
  }
  setCatalog(cat) {
    setOriginalPointMap(this);
    this.cat = cat;
    this.setFilters(this.scope, this.subject);
    this.drawSoon();
  }
  size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = this.view.clientWidth || 1, height = this.view.clientHeight || 1;
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
    this.labelSize = width < 480 ? 12 : width > 1300 ? 14 : 13;
    this.transform();
  }
  transform() {
    const b = this.unplaced
      ? [-11, -11, 11, 11]
      : this.bounds || [-16, -16, 16, 16];
    this.unit =
      Math.min(this.width / (b[2] - b[0]), this.height / (b[3] - b[1])) *
      this.zoom *
      0.97;
    this.left = this.cx - this.width / (2 * this.unit);
    this.top = this.cy + this.height / (2 * this.unit);
  }
  px(x) {
    return (x - this.left) * this.unit;
  }
  py(y) {
    return (this.top - y) * this.unit;
  }
  project(sx, sy) {
    return [this.left + sx / this.unit, this.top - sy / this.unit];
  }
  fit() {
    const base = this.unplaced
      ? [-11, -11, 11, 11]
      : this.bounds || [-16, -16, 16, 16];
    const orig = this.unplaced ? null : this.base?.original_viewport_native;
    const b = orig ? [orig[0], merc(orig[1]), orig[2], merc(orig[3])] : base;
    this.cx = (b[0] + b[2]) / 2;
    this.cy = (b[1] + b[3]) / 2;
    const initial = Math.min(
      this.width / (b[2] - b[0]),
      this.height / (b[3] - b[1]),
    );
    this.zoom =
      initial /
      Math.min(
        this.width / (base[2] - base[0]),
        this.height / (base[3] - base[1]),
      );
    this.transform();
    this.drawSoon();
  }
  setScene(unplaced) {
    if (this.unplaced !== unplaced) {
      this.unplaced = unplaced;
      this.fit();
    }
    document.querySelector("#scene").textContent = unplaced
      ? "Source-section index"
      : "arXiv paper map";
  }
  setFilters(scope, subject) {
    this.scope = scope;
    this.subject = subject;
    this.filterBundle = null;
    this.edges = [];
    this.setScene(subject === "unresolved");
    const key = [scope, subject, this.evidence, this.placement].join("|");
    if (this.cat && key !== this.countKey) {
      const c = this.cat,
        counts = new Uint32Array(c.bundles.length);
      let matched = 0;
      for (let i = 0; i < c.index.count; i++) {
        if (
          (!subject || c.bundles[c.bundle[i]].category === subject) && this.placementPass(i) &&
          scopePass(c[this.evidence][i], scope)
        ) {
          counts[c.bundle[i]]++;
          matched++;
        }
      }
      this.counts = counts;
      this.matched = matched;
      this.countKey = key;
    }
    this.drawSoon();
  }
  placementPass(i) {
    return this.placement === "all" || this.cat.placementClass[this.cat.basis[i]] === this.placement;
  }
  pass(i) {
    return (
      (!this.subject ||
        this.cat.bundles[this.cat.bundle[i]].category === this.subject) &&
      (this.filterBundle === null ||
        this.cat.bundle[i] === this.filterBundle) &&
      this.placementPass(i) && scopePass(this.cat[this.evidence][i], this.scope)
    );
  }
  go(x, y, zoom) {
    this.cx = x;
    this.cy = y;
    this.zoom = clamp(zoom, 0.55, 200000);
    this.transform();
    this.drawSoon();
  }
  frame(ids, zoomMax = 420) {
    if (!ids.length) return;
    const c = this.cat;
    let l = Infinity,
      r = -Infinity,
      b = Infinity,
      t = -Infinity;
    for (const i of ids) {
      if (!this.pass(i)) continue;
      l = Math.min(l, c.x[i]);
      r = Math.max(r, c.x[i]);
      b = Math.min(b, c.y[i]);
      t = Math.max(t, c.y[i]);
    }
    if (!Number.isFinite(l)) return;
    this.setScene(Boolean(c.unplaced[ids[0]]));
    const baseline = this.unit / this.zoom;
    this.go(
      (l + r) / 2,
      (b + t) / 2,
      Math.min(
        zoomMax,
        (this.width * 0.72) / (Math.max(0.001, r - l) * baseline),
        (this.height * 0.65) / (Math.max(0.001, t - b) * baseline),
      ),
    );
  }
  gotoPoint(i) {
    this.selected = i;
    this.setScene(Boolean(this.cat.unplaced[i]));
    this.go(this.cat.x[i], this.cat.y[i], Math.max(115, this.zoom));
  }
  zoomAt(factor, sx, sy, targetX = sx, targetY = sy) {
    const before = this.project(sx, sy);
    this.zoom = clamp(this.zoom * factor, 0.55, 200000);
    this.transform();
    const after = this.project(targetX, targetY);
    this.cx += before[0] - after[0];
    this.cy += before[1] - after[1];
    this.transform();
    this.drawSoon();
  }
  drawSoon() {
    if (this.framePending) return;
    this.framePending = true;
    const next = () => {
      if (!this.framePending) return;
      this.framePending = false;
      cancelAnimationFrame(this.frameId);
      clearTimeout(this.frameTimer);
      if (
        this.width !== this.view.clientWidth ||
        this.height !== this.view.clientHeight
      )
        this.size();
      this.draw();
    };
    this.frameId = requestAnimationFrame(next);
    this.frameTimer = setTimeout(next, 45);
  }
  tileImg(path) {
    if (!this.images.has(path)) {
      const im = new Image();
      this.images.set(path, im);
      im.onload = () => this.drawSoon();
      im.onerror = () =>
        this.warn(
          "A paper tile could not be loaded. Reload the page to retry.",
        );
      im.src = BASE + path;
    }
    return this.images.get(path);
  }
  tiles() {
    const ctx = this.ctx,
      m = this.base,
      b = m.world,
      span = b[2] - b[0],
      ts = m.tiles.tile_size;
    const z = clamp(
      Math.round(Math.log2((this.unit * span) / ts)),
      m.tiles.min_zoom,
      m.tiles.max_zoom,
    );
    const n = 2 ** z,
      w = span / n,
      box = this.box();
    const x0 = clamp(Math.floor((box[0] - b[0]) / w), 0, n - 1),
      x1 = clamp(Math.floor((box[2] - b[0]) / w), 0, n - 1);
    const y0 = clamp(Math.floor((b[3] - box[3]) / w), 0, n - 1),
      y1 = clamp(Math.floor((b[3] - box[1]) / w), 0, n - 1);
    const deep =
      (this.unit * w) / ts > 2.45 &&
      z === m.tiles.max_zoom &&
      this.vectorIndex.size > 0;
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const sx = this.px(b[0] + x * w),
          sy = this.py(b[3] - y * w),
          size = w * this.unit;
        if (
          sx + size < 0 ||
          sy + size < 0 ||
          sx > this.width ||
          sy > this.height
        )
          continue;
        const key = x + "," + y,
          parts = this.vectorIndex.get(key);
        if (deep && parts) {
          for (const sh of parts) this.getVector(sh);
          if (parts.every((sh) => this.vectors.get(sh.path)?.x)) {
            for (const sh of parts)
              this.paperPoints(this.vectors.get(sh.path), box);
            continue;
          }
        }
        const im = this.tileImg(
          m.tiles.template
            .replace("{z}", z)
            .replace("{x}", x)
            .replace("{y}", y),
        );
        if (im.complete && im.naturalWidth) {
          ctx.globalAlpha = deep ? 0.7 : 0.94;
          ctx.drawImage(im, sx, sy, size + 0.2, size + 0.2);
          ctx.globalAlpha = 1;
        } else if (z > 0) {
          const coarse = this.tileImg(
            m.tiles.template
              .replace("{z}", 0)
              .replace("{x}", 0)
              .replace("{y}", 0),
          );
          if (coarse.complete && coarse.naturalWidth)
            ctx.drawImage(
              coarse,
              (x * ts) / n,
              (y * ts) / n,
              ts / n,
              ts / n,
              sx,
              sy,
              size,
              size,
            );
        }
      }
  }
  getVector(sh) {
    if (this.vectors.has(sh.path)) return;
    this.vectors.set(sh.path, { pending: true });
    const loading = bytes(BASE + sh.path)
      .then((buf) => {
        const d = new DataView(buf),
          n = sh.count,
          s = this.base.points.record_bytes;
        if (d.byteLength !== n * s)
          throw Error("Invalid original paper point shard");
        const v = {
          x: new Float64Array(n),
          y: new Float64Array(n),
          row: new Uint32Array(n),
          rgb: new Uint32Array(n),
        };
        for (let i = 0; i < n; i++) {
          const o = i * s;
          v.row[i] = d.getUint32(o, true);
          v.x[i] = d.getFloat64(o + 4, true);
          v.y[i] = merc(d.getFloat64(o + 12, true));
          v.rgb[i] =
            d.getUint8(o + 20) * 65536 +
            d.getUint8(o + 21) * 256 +
            d.getUint8(o + 22);
        }
        this.vectors.set(sh.path, v);
        this.drawSoon();
        if (this.vectors.size > this.vectorLimit)
          for (const k of this.vectors.keys()) {
            if (k !== sh.path && this.vectors.get(k).x) {
              this.vectors.delete(k);
              break;
            }
          }
      })
      .catch((e) => {
        this.vectors.set(sh.path, { failed: true });
        this.warn(e.message);
      }).finally(() => this.vectorLoads.delete(loading));
    this.vectorLoads.add(loading);
  }
  paperPoints(v, box) {
    const ctx = this.ctx,
      colors = new Map();
    const radius = clamp(this.zoom * 0.043, 1.05, 3.2);
    ctx.globalAlpha = 0.78;
    for (let i = 0; i < v.x.length; i++) {
      const x = v.x[i],
        y = v.y[i];
      if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
      const shade = v.rgb[i];
      let color = colors.get(shade);
      if (!color) {
        color =
          "rgb(" +
          [(shade >> 16) & 255, (shade >> 8) & 255, shade & 255]
            .map((c) => Math.round(0.75 * c + 63))
            .join(",") +
          ")";
        colors.set(shade, color);
      }
      ctx.fillStyle = color;
      const sx = this.px(x),
        sy = this.py(y);
      ctx.fillRect(sx - radius / 2, sy - radius / 2, radius, radius);
      this.paperHits.push({ sx, sy, row: v.row[i] });
    }
    ctx.globalAlpha = 1;
  }
  box() {
    return [
      this.left,
      this.top - this.height / this.unit,
      this.left + this.width / this.unit,
      this.top,
    ];
  }
  landmarks() {
    if (!this.levels) return;
    const ctx = this.ctx,
      depth =
        this.zoom < 1.8
          ? 1
          : this.zoom < 3
            ? 2
            : this.zoom < 6
              ? 3
              : this.zoom < 13
                ? 4
                : this.zoom < 28
                  ? 5
                  : this.zoom < 62
                    ? 6
                    : 7;
    const placed = [];
    const size = this.labelSize;
    ctx.font = size + "px " + this.labelFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const candidates = this.levels[depth] || [];
    for (const l of candidates) {
      const sx = this.px(l.x),
        sy = this.py(l.my);
      if (sx < 18 || sy < 68 || sx > this.width - 18 || sy > this.height - 42)
        continue;
      const lines = l.lines ??= labelLines(l.label);
      if (l.measuredSize !== size) {
        l.measuredSize = size;
        l.textWidth = Math.max(...lines.map((s) => ctx.measureText(s).width)) + 10;
      }
      const width = l.textWidth, lineHeight = size + 1, height = lineHeight * lines.length + 4;
      const rect = {
        x: sx - width / 2,
        y: sy - height / 2,
        w: width,
        h: height,
        l,
      };
      if (rect.x < 3 || rect.x + width > this.width - 3 ||
          rect.y < 2 || rect.y + height > this.height - 2) continue;
      if (
        placed.some(
          (o) =>
            o.x < rect.x + width + 6 &&
            o.x + o.w + 6 > rect.x &&
            o.y < rect.y + height + 5 &&
            o.y + o.h + 5 > rect.y,
        )
      )
        continue;
      placed.push(rect);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#102023e8";
      ctx.fillStyle = this.zoom < 4 ? "#e2ebe4" : "#cbdcd5";
      lines.forEach((line, k) => {
        const py = sy + (k - (lines.length - 1) / 2) * lineHeight;
        ctx.strokeText(line, sx, py);
        ctx.fillText(line, sx, py);
      });
    }
    this.textHits = placed;
  }
  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.width) return;
    this.transform();
    ctx.fillStyle = "#101a1c";
    ctx.fillRect(0, 0, this.width, this.height);
    this.screen = [];
    this.textHits = [];
    this.paperHits = [];
    if (!this.unplaced && this.show.papers && this.base) this.tiles();
    if (!this.unplaced && this.show.labels) this.landmarks();
    if (exclusiveProofLayer() && historicalPin()) {
      const pin = activeHistoricalPin();
      if (pin && this.show.lean) drawOriginalSnapshot(this, pin);
      drawTime();
      document.getElementById("scale").textContent = (this.zoom > 15 ? Math.round(this.zoom) : Number(this.zoom.toFixed(1))) + "×";
      return;
    }
    if (this.cat && this.show.lean && this.show.relations) this.proofLines();
    if (this.cat && this.show.lean) this.leanMarks();
    if (this.nativeLayer && this.show.generated) this.nativeLayer.draw(this);
    const i = this.selected;
    if (
      this.show.lean &&
      i !== null &&
      this.cat &&
      this.pass(i) &&
      Boolean(this.cat.unplaced[i]) === this.unplaced
    ) {
      const x = this.px(this.cat.x[i]),
        y = this.py(this.cat.y[i]);
      ctx.beginPath();
      ctx.arc(x, y, 9.5, 0, 2 * Math.PI);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 13, 0, 2 * Math.PI);
      ctx.strokeStyle = "#a4d9b186";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (this.lastScale !== this.zoom) {
      document.querySelector("#scale").textContent =
        (this.zoom > 15 ? coarseScale : fineScale).format(this.zoom) + "×";
      this.lastScale = this.zoom;
    }
    if (!this.chapterLayer) this.contextLayer?.draw(this);
    this.chapterLayer?.draw(this);
    drawTime();
  }
  proofLines() {
    const c = this.cat,
      ctx = this.ctx,
      markers = new Map();
    for (const [from, to, kind] of this.edges) {
      if (
        Boolean(c.unplaced[from]) !== this.unplaced ||
        Boolean(c.unplaced[to]) !== this.unplaced
      )
        continue;
      if (
        !this.placementPass(from) || !this.placementPass(to) ||
        !scopePass(c[this.evidence][from], this.scope) ||
        !scopePass(c[this.evidence][to], this.scope)
      )
        continue;
      const ax = this.px(c.x[from]),
        ay = this.py(c.y[from]),
        bx = this.px(c.x[to]),
        by = this.py(c.y[to]);
      if (
        (ax < 0 && bx < 0) ||
        (ay < 0 && by < 0) ||
        (ax > this.width && bx > this.width) ||
        (ay > this.height && by > this.height)
      )
        continue;
      const color = kind & 2 ? "#ffda93" : "#8dcecf";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.78;
      ctx.setLineDash(kind & 2 ? [] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      const d = Math.hypot(bx - ax, by - ay);
      if (d > 28) {
        const dx = (bx - ax) / d,
          dy = (by - ay) / d,
          tx = bx - 7 * dx,
          ty = by - 7 * dy;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - 7 * dx + 3 * dy, ty - 7 * dy - 3 * dx);
        ctx.lineTo(tx - 7 * dx - 3 * dy, ty - 7 * dy + 3 * dx);
        ctx.closePath();
        ctx.fill();
      }
      markers.set(from, [ax, ay]);
      markers.set(to, [bx, by]);
    }
    ctx.globalAlpha = 1;
    for (const [id, [sx, sy]] of markers) {
      if (sx < 0 || sx > this.width || sy < 0 || sy > this.height) continue;
      ctx.fillStyle = "#e7d7ad";
      ctx.strokeStyle = "#354039";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, 3.7, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      this.screen.push({
        type: "dots",
        ids: [id],
        count: 1,
        sx,
        sy,
        rad: 4,
        category: c.bundles[c.bundle[id]].category,
      });
    }
  }
  leanMarks() {
    const c = this.cat, ctx = this.ctx;
    const key = [this.scope, this.subject, this.evidence, this.placement, this.filterBundle, this.unplaced].join("|");
    if (key !== this.treeKey) {
      const subset = this.filterBundle === null ? null : c.members[this.filterBundle];
      this.tree = new PointTree(c.x, c.y, i => Boolean(c.unplaced[i]) === this.unplaced && this.pass(i), subset);
      this.treeKey = key;
    }
    const coarse = this.zoom < 8 && this.filterBundle === null;
    const captions = [];
    this.tree.visible(this.box(), this.unit, coarse ? 25 : 12, (node, members) => {
      const id = node.anchor, sx = this.px(c.x[id]), sy = this.py(c.y[id]);
      if (sx < -12 || sy < -12 || sx > this.width + 12 || sy > this.height + 12) return;
      const b = c.bundles[c.bundle[id]], n = members.length;
      const bundles = coarse && n > 1;
      const h = {
        type: bundles ? "bundles" : "dots", category: b.category,
        count: n, anchor: id, sx, sy, rad: n === 1 ? 3.9 : clamp(4.5 + Math.log2(n) * .47, 5, 11),
        get rows() { return members; },
        get ids() {
          if (!bundles) return members;
          if (!node.bundles) node.bundles = [...new Set(Array.from(members, i => c.bundle[i]))];
          return node.bundles;
        },
      };
      const color = c.categories.get(b.category)?.color || "#a0a6ab";
      ctx.beginPath(); ctx.arc(sx, sy, h.rad, 0, 2 * Math.PI);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = coarse ? "#f4f4e3" : "#e4ece4"; ctx.lineWidth = coarse ? 1.35 : .8; ctx.stroke();
      if (n > 1) {
        ctx.beginPath(); ctx.arc(sx, sy, coarse ? 2.2 : 1.45, 0, 2 * Math.PI);
        ctx.fillStyle = "#20302c"; ctx.fill();
      }
      this.screen.push(h);
      if (coarse && n >= 15 && this.show.labels) captions.push([h, b]);
    });
    this.leanCaptions(captions);
  }
  leanCaptions(candidates) {
    const ctx = this.ctx, occupied = this.textHits.slice();
    const seen = new Set(), limit = this.width < 560 ? 3 : 7;
    ctx.font = "600 12px " + this.labelFont;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (const [h, b] of candidates.sort((a, b) => b[0].count - a[0].count || a[0].anchor - b[0].anchor)) {
      const name = this.unplaced ? b.label : this.cat.categories.get(b.category)?.label;
      if (!name || seen.has(name)) continue;
      const x = h.sx + h.rad + 4, y = h.sy, w = ctx.measureText(name).width + 8;
      const rect = { x, y: y - 8, w, h: 16 };
      if (x < 4 || y < 60 || x + w > this.width - 4 || y > this.height - 34 ||
          occupied.some(r => x < r.x + r.w + 4 && x + w > r.x - 4 && rect.y < r.y + r.h + 3 && rect.y + 16 > r.y - 3)) continue;
      occupied.push(rect); seen.add(name);
      ctx.fillStyle = "#132422e8"; ctx.fillRect(x, y - 8, w, 16);
      ctx.fillStyle = "#e5eddd"; ctx.fillText(name, x + 4, y);
      if (seen.size >= limit) break;
    }
  }
  hit(sx, sy) {
    if (activeHistoricalPin()) { const item = hitOriginalSnapshot(sx, sy); if (item) return {type:"time-node",route:item,count:item.count}; }
    if (!historicalPin() && !this.chapterLayer && this.contextLayer?.enabled && !this.unplaced) {
      const contextual = this.contextLayer.hit(sx, sy);
      if (contextual) return contextual;
    }
    let best = null,
      dist = Infinity;
    for (const h of this.screen) {
      const d = Math.hypot(h.sx - sx, h.sy - sy);
      if (d < Math.max(8, h.rad + 4) && d < dist) {
        best = h;
        dist = d;
      }
    }
    if (best) return best;
    for (const h of this.textHits) {
      if (sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h)
        return { type: "label", l: h.l };
    }
    for (const h of this.paperHits) {
      const d = Math.hypot(h.sx - sx, h.sy - sy);
      if (d <= 5 && d < dist) {
        best = { type: "paper", row: h.row };
        dist = d;
      }
    }
    return best;
  }
  interaction() {
    const v = this.view,
      tip = document.querySelector("#tip");
    const pos = (e) => {
      const r = v.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    v.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        tip.hidden = true;
        this.zoomAt(
          Math.exp(
            -clamp(e.deltaY * (e.deltaMode === 1 ? 14 : 1), -400, 400) * 0.0025,
          ),
          ...pos(e),
        );
      },
      { passive: false },
    );
    v.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("[data-map-action]")) return;
      const p = pos(e);
      this.pointers.set(e.pointerId, { p, start: p });
      v.setPointerCapture(e.pointerId);
      this.dragged = this.pointers.size > 1;
      tip.hidden = true;
      v.classList.add("grabbing");
    });
    v.addEventListener("pointermove", (e) => {
      const p = pos(e),
        cur = this.pointers.get(e.pointerId);
      if (!cur) {
        if (e.target.closest("[data-map-action]")) { tip.hidden = true; return; }
        const h = this.hit(...p);
        v.classList.toggle("pointing", Boolean(h));
        if (!h) {
          tip.hidden = true;
          return;
        }
        tip.textContent =
          h.type === "context" ? h.label : h.type === "label"
            ? h.l.label
            : h.type === "paper"
              ? "Open arXiv paper"
              : h.type === "native"
                ? fmt(h.count) +
                  " native theorem " +
                  (h.count === 1 ? "mark" : "marks")
                : h.type === "bundles"
                  ? fmt(h.count) +
                    " theorems in " +
                    fmt(h.ids.length) +
                    " " +
                    (h.ids.length === 1 ? "bundle" : "bundles")
                  : h.count === 1
                    ? "Inspect Lean declaration"
                    : fmt(h.count) + " nearby declarations";
        if (h.category) {
          const bundle = h.anchor == null ? null : this.cat.bundles[this.cat.bundle[h.anchor]];
          const subject = this.cat.categories.get(h.category)?.label;
          const label = this.unplaced && bundle ? bundle.label : subject;
          if (label) tip.textContent += " · " + label;
        }
        tip.hidden = false;
        tip.style.left =
          clamp(p[0] + 12, 4, v.clientWidth - tip.offsetWidth - 6) + "px";
        tip.style.top =
          clamp(p[1] + 12, 4, v.clientHeight - tip.offsetHeight - 6) + "px";
        return;
      }
      const old = cur.p;
      if (this.pointers.size === 2) {
        const other = [...this.pointers.values()].find((a) => a !== cur).p,
          distance = (q) => Math.hypot(q[0] - other[0], q[1] - other[1]);
        const pre = distance(old),
          next = distance(p);
        if (pre > 1 && next > 1)
          this.zoomAt(next / pre, (old[0] + other[0]) / 2, (old[1] + other[1]) / 2,
                      (p[0] + other[0]) / 2, (p[1] + other[1]) / 2);
        this.dragged = true;
      } else {
        if (Math.hypot(p[0] - cur.start[0], p[1] - cur.start[1]) > 3)
          this.dragged = true;
        if (this.dragged) {
          this.cx -= (p[0] - old[0]) / this.unit;
          this.cy += (p[1] - old[1]) / this.unit;
          this.transform();
          this.drawSoon();
        }
      }
      cur.p = p;
    });
    const end = (e, cancel) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) {
        v.classList.remove("grabbing");
        if (!cancel && !this.dragged) {
          const h = this.hit(...pos(e));
          if (h) this.select(h, e);
        }
        this.dragged = false;
      }
    };
    v.addEventListener("pointerup", (e) => end(e, false));
    v.addEventListener("pointercancel", (e) => end(e, true));
    v.addEventListener("pointerleave", () => {
      tip.hidden = true;
    });
    v.addEventListener("dblclick", (e) => {
      if (!e.target.closest("[data-map-action]") && !this.hit(...pos(e))) this.zoomAt(2, ...pos(e));
    });
    v.addEventListener("keydown", (e) => {
      if (e.target.closest("select")) return;
      const pan = 75 / this.unit;
      if (["+", "=", "-"].includes(e.key))
        this.zoomAt(
          e.key === "-" ? 0.68 : 1.48,
          this.width / 2,
          this.height / 2,
        );
      else if (e.key === "ArrowLeft") this.cx -= pan;
      else if (e.key === "ArrowRight") this.cx += pan;
      else if (e.key === "ArrowUp") this.cy += pan;
      else if (e.key === "ArrowDown") this.cy -= pan;
      else if (e.key === "Home") this.fit();
      else return;
      e.preventDefault();
      this.transform();
      this.drawSoon();
    });
  }
}
