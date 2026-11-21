import { bytes, json, merc, fmt, scopePass } from "./data.js";
const BASE = "data/base/";
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export class AtlasMap {
  constructor(select, warn) {
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
    this.pointers = new Map();
    this.scope = "all";
    this.subject = "";
    this.evidence = "mask";
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
    this.labelRows = await json(
      BASE + (this.base.labels_gzip || this.base.labels),
    );
    this.labelById = new Map(this.labelRows.map((l) => [l.id, l]));
    this.labelRows = this.labelRows.filter((l) => l.named !== false && l.label);
    for (const l of this.labelRows) l.my = merc(l.y);
    this.drawSoon();
  }
  setCatalog(cat) {
    this.cat = cat;
    this.setFilters(this.scope, this.subject);
    this.drawSoon();
  }
  size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = this.view.clientWidth || 1;
    this.height = this.view.clientHeight || 1;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
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
      ? "Unplaced theorem index"
      : "arXiv paper map";
  }
  setFilters(scope, subject) {
    this.scope = scope;
    this.subject = subject;
    this.filterBundle = null;
    this.edges = [];
    this.setScene(subject === "unresolved");
    if (this.cat) {
      const c = this.cat,
        counts = new Uint32Array(c.bundles.length);
      let matched = 0;
      for (let i = 0; i < c.index.count; i++) {
        if (
          (!subject || c.bundles[c.bundle[i]].category === subject) &&
          scopePass(c[this.evidence][i], scope)
        ) {
          counts[c.bundle[i]]++;
          matched++;
        }
      }
      this.counts = counts;
      this.matched = matched;
    }
    this.drawSoon();
  }
  pass(i) {
    return (
      (!this.subject ||
        this.cat.bundles[this.cat.bundle[i]].category === this.subject) &&
      (this.filterBundle === null ||
        this.cat.bundle[i] === this.filterBundle) &&
      scopePass(this.cat[this.evidence][i], this.scope)
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
  zoomAt(factor, sx, sy) {
    const before = this.project(sx, sy);
    this.zoom = clamp(this.zoom * factor, 0.55, 200000);
    this.transform();
    const after = this.project(sx, sy);
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
    bytes(BASE + sh.path)
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
        if (this.vectors.size > 14)
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
      });
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
    if (!this.labelRows) return;
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
    ctx.font = '13px "DM Sans",Arial,sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const candidates = this.labelRows.filter((l) => l.depth === depth);
    for (const l of candidates) {
      const sx = this.px(l.x),
        sy = this.py(l.my);
      if (sx < 18 || sy < 68 || sx > this.width - 18 || sy > this.height - 42)
        continue;
      let words = l.label.split(/\s+/),
        lines = [""];
      for (const w of words) {
        let p = lines.length - 1;
        if (lines[p] && (lines[p] + " " + w).length > 27) lines.push(w);
        else lines[p] = (lines[p] + " " + w).trim();
      }
      if (lines.length > 3)
        lines = lines
          .slice(0, 2)
          .concat([lines.slice(2).join(" ").slice(0, 25) + "…"]);
      const width =
          Math.max(...lines.map((s) => ctx.measureText(s).width)) + 10,
        height = 14 * lines.length + 4;
      const rect = {
        x: sx - width / 2,
        y: sy - height / 2,
        w: width,
        h: height,
        l,
      };
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
        const py = sy + (k - (lines.length - 1) / 2) * 14;
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
    document.querySelector("#scale").textContent =
      Intl.NumberFormat("en-US", {
        maximumFractionDigits: this.zoom > 15 ? 0 : 1,
      }).format(this.zoom) + "×";
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
    const c = this.cat,
      coarse = !this.unplaced && this.zoom < 8 && this.filterBundle === null,
      pix = coarse ? 19 : this.zoom < 45 ? 11 : 8;
    const cells = new Map(),
      w = this.width,
      h = this.height,
      cols = Math.ceil((w + 48) / pix) + 2;
    const add = (id, x, y, n, b) => {
      const sx = this.px(x),
        sy = this.py(y);
      if (sx < -16 || sy < -16 || sx > w + 16 || sy > h + 16) return;
      const k =
        Math.floor((sx + 24) / pix) + Math.floor((sy + 24) / pix) * cols;
      let hit = cells.get(k);
      if (!hit) {
        hit = {
          type: coarse ? "bundles" : "dots",
          ids: [],
          count: 0,
          sx: 0,
          sy: 0,
          max: 0,
          category: null,
        };
        cells.set(k, hit);
      }
      hit.ids.push(id);
      hit.sx += sx * n;
      hit.sy += sy * n;
      hit.count += n;
      if (n > hit.max) {
        hit.max = n;
        hit.category = c.bundles[b].category;
      }
    };
    if (coarse) {
      for (let b = 0; b < c.bundles.length; b++) {
        const v = c.bundles[b],
          n = this.counts[b];
        if (n && Number.isFinite(v.x) && Number.isFinite(v.y))
          add(b, v.x, merc(v.y), n, b);
      }
    } else {
      const visit = (i) => {
        if (this.pass(i)) add(i, c.x[i], c.y[i], 1, c.bundle[i]);
      };
      if (this.filterBundle !== null) {
        for (const i of c.members[this.filterBundle]) visit(i);
      } else c.visible(this.box(), this.unplaced, visit);
    }
    const ctx = this.ctx;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const h of cells.values()) {
      h.sx /= h.count;
      h.sy /= h.count;
      h.rad = coarse
        ? clamp(4.7 + 1.25 * Math.log10(h.count + 1), 5, 12)
        : h.count === 1
          ? 3.9
          : clamp(4 + Math.log2(h.count) * 0.68, 5, 10.5);
      const color = c.categories.get(h.category)?.color || "#a0a6ab";
      ctx.fillStyle = color;
      ctx.strokeStyle = coarse ? "#f4f4e3" : "#e4ece4";
      ctx.lineWidth = coarse ? 1.35 : 0.8;
      ctx.beginPath();
      ctx.arc(h.sx, h.sy, h.rad, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      if (coarse || h.count > 1) {
        ctx.beginPath();
        ctx.fillStyle = "#20302c";
        ctx.arc(h.sx, h.sy, coarse ? 2.2 : 1.45, 0, 2 * Math.PI);
        ctx.fill();
      }
      this.screen.push(h);
    }
  }
  hit(sx, sy) {
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
      if (e.button !== 0) return;
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
        const h = this.hit(...p);
        v.classList.toggle("pointing", Boolean(h));
        if (!h) {
          tip.hidden = true;
          return;
        }
        tip.textContent =
          h.type === "label"
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
          this.zoomAt(next / pre, (p[0] + other[0]) / 2, (p[1] + other[1]) / 2);
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
      if (!this.hit(...pos(e))) this.zoomAt(2, ...pos(e));
    });
    v.addEventListener("keydown", (e) => {
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
