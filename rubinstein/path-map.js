import { AtlasMap } from "../map.js";

const DISTANCE = 11;
const CIRCLE = 2 * Math.PI;
const OUT = "#8acbff", IN = "#d4aaff";

function arrow(ctx, x, y, dx, dy, color) {
  ctx.beginPath();
  ctx.moveTo(x + 3.2 * dx, y + 3.2 * dy);
  ctx.lineTo(x - 3.5 * dx + 2.8 * dy, y - 3.5 * dy - 2.8 * dx);
  ctx.lineTo(x - 3.5 * dx - 2.8 * dy, y - 3.5 * dy + 2.8 * dx);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// All geometry passes through the Explorer's camera. Drawing a reading trail never moves a declaration.
export class ReadingMap extends AtlasMap {
  constructor(choose, warn) {
    super((hit) => {
      if (hit.stop) choose(hit.stop);
      else if (Number.isInteger(hit.anchor))
        location.assign("index.html#theorem=" + hit.anchor);
    }, warn);
    this.all = [];
    this.pageStops = [];
    this.targets = [];
    this.whole = false;
    this.dependencies = false;
    this.edgeTargets = [];
  }

  setRoute(all) {
    this.all = all;
  }

  selectPassage(page, stops, selected) {
    const pageChanged = this.page !== page, stopChanged = this.current !== selected;
    this.page = page;
    this.pageStops = stops;
    this.current = selected;
    if ((pageChanged || (this.dependencies && stopChanged)) && !this.whole) this.fitPassage();
    else if (selected?.position && !this.whole) {
      const [x, y] = selected.position;
      const outside =
        this.px(x) < 20 ||
        this.py(y) < 20 ||
        this.px(x) > this.width - 20 ||
        this.py(y) > this.height - 20;
      if (outside) this.go(x, y, this.zoom);
    }
    this.drawSoon();
  }

  fitPassage() {
    const references = !this.whole && this.dependencies && this.current?.neighbors?.edges;
    const points = references?.length && this.current.position
      ? [this.current.position, ...references.map((e) => e.point)]
      : (this.whole ? this.all : this.pageStops).map((s) => s.position).filter(Boolean);
    if (!points.length || !this.bounds) {
      this.fit();
      return;
    }
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    const left = Math.min(...xs),
      right = Math.max(...xs),
      low = Math.min(...ys),
      high = Math.max(...ys);
    const worldScale =
      0.97 *
      Math.min(
        this.width / (this.bounds[2] - this.bounds[0]),
        this.height / (this.bounds[3] - this.bounds[1]),
      );
    const zoom =
      Math.min(
        (this.width - 84) / Math.max(0.001, right - left),
        (this.height - 76) / Math.max(0.001, high - low),
      ) / worldScale;
    this.go(
      (left + right) / 2,
      (low + high) / 2,
      Math.max(0.6, Math.min(zoom, references?.length ? 1800 : 180)),
    );
  }

  focusStop() {
    const p = this.current?.position;
    if (p) this.go(p[0], p[1], Math.max(28, this.zoom));
  }

  trace(stops, active) {
    const ctx = this.ctx;
    ctx.beginPath();
    let previous = null;
    for (const stop of stops) {
      const p = stop.position;
      if (!p) {
        previous = null;
        continue;
      }
      const x = this.px(p[0]),
        y = this.py(p[1]);
      if (!previous || stop.page - previous.page > 1) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      previous = stop;
    }
    ctx.strokeStyle = active ? "#b9efc9" : "#a6dfb969";
    ctx.lineWidth = active ? 1.25 : 0.8;
    ctx.setLineDash(active ? [4, 5] : [2, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!active) return;
    // Show the destination stop at long, well-separated segments on this page.
    const used = [];
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i-1], b = stops[i];
      if (!a.position || !b.position || b.page - a.page > 1) continue;
      const x = this.px(a.position[0]), y = this.py(a.position[1]);
      const dx = this.px(b.position[0]) - x, dy = this.py(b.position[1]) - y;
      const len = Math.hypot(dx, dy), tx = x + 0.55 * dx, ty = y + 0.55 * dy;
      if (len < 72 || tx < 25 || ty < 24 || tx > this.width-25 || ty > this.height-28 ||
          used.some(([ux, uy]) => Math.abs(tx-ux) < 42 && Math.abs(ty-uy) < 20)) continue;
      used.push([tx, ty]);
      arrow(ctx, tx, ty, dx/len, dy/len, "#cef9d9");
      const pad = dy >= 0 ? -7 : 7, lx = tx + 10 * dy/len, ly = ty + pad;
      ctx.font = "600 10px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = String(b.index + 1);
      const w = ctx.measureText(label).width + 5;
      ctx.fillStyle = "#132b26ed";
      ctx.fillRect(lx-w/2, ly-6, w, 12);
      ctx.fillStyle = "#dbf4df";
      ctx.fillText(label, lx, ly);
    }
  }

  references() {
    const source = this.current?.position, edges = this.current?.neighbors?.edges;
    if (!source || !edges) return;
    const c = this.ctx, sx = this.px(source[0]), sy = this.py(source[1]);
    for (const edge of edges) {
      const x = this.px(edge.point[0]), y = this.py(edge.point[1]);
      const dx = x-sx, dy = y-sy, len = Math.hypot(dx, dy);
      const uses = edge.direction !== "used-by", usedBy = edge.direction !== "uses";
      c.strokeStyle = uses ? OUT : IN;
      c.lineWidth = 1.25;
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(x, y);
      c.stroke();
      if (len > 24) {
        const ux = dx/len, uy = dy/len, gap = Math.min(16, len * 0.32);
        if (uses) arrow(c, x-gap*ux, y-gap*uy, ux, uy, OUT);
        if (usedBy) arrow(c, sx+gap*ux, sy+gap*uy, -ux, -uy, IN);
      }
      if (x < -6 || y < -6 || x > this.width+6 || y > this.height+6) continue;
      c.fillStyle = uses ? OUT : IN;
      c.fillRect(x-2.4, y-2.4, 4.8, 4.8);
      this.edgeTargets.push({sx:x, sy:y, edge});
    }
  }

  draw() {
    super.draw();
    if (!this.all || !this.width) return;
    const c = this.ctx;
    c.save();
    this.targets = [];
    this.edgeTargets = [];
    if (this.whole) this.trace(this.all, false);
    this.trace(this.pageStops, true);
    if (this.dependencies) this.references();
    for (const stop of this.whole ? this.all : this.pageStops) {
      if (!stop.position) continue;
      const [x, y] = stop.position;
      const sx = this.px(x),
        sy = this.py(y);
      if (sx < -10 || sy < -10 || sx > this.width + 10 || sy > this.height + 10)
        continue;
      this.targets.push({ sx, sy, stop });
      const onPage = stop.page === this.page;
      c.beginPath();
      c.arc(sx, sy, onPage ? 4.5 : 2.6, 0, CIRCLE);
      if (!stop.context) {
        c.fillStyle = onPage ? "#ddffe3" : "#a7cdb8";
        c.fill();
      }
      c.strokeStyle = stop.context ? (onPage ? "#b8f4d6" : "#9fcbb0") : "#1c392e";
      c.lineWidth = stop.context ? 1.65 : 1;
      c.stroke();
    }
    if (this.current?.position) {
      const [x, y] = this.current.position,
        sx = this.px(x),
        sy = this.py(y);
      c.beginPath();
      c.arc(sx, sy, 9.5, 0, CIRCLE);
      c.strokeStyle = "#ffe1a1";
      c.lineWidth = 2;
      c.stroke();
      c.beginPath();
      c.arc(sx, sy, 5.3, 0, CIRCLE);
      if (this.current.context) {
        c.strokeStyle = "#f6c469";
        c.lineWidth = 1.8;
        c.stroke();
      } else {
        c.fillStyle = "#f6c469";
        c.fill();
      }
      const text = String(this.current.index + 1);
      c.font = "600 12px system-ui";
      const tw = c.measureText(text).width + 10,
        tx = Math.max(2, Math.min(this.width - tw - 2, sx + 11)),
        ty = Math.max(17, sy - 7);
      c.fillStyle = "#162923";
      c.fillRect(tx, ty - 14, tw, 17);
      c.fillStyle = "#ffe3aa";
      c.textAlign = "left";
      c.textBaseline = "alphabetic";
      c.fillText(text, tx + 5, ty - 1);
    }
    c.restore();
  }

  hit(x, y) {
    // Cycle co-located references in reading order when a dot is clicked again.
    const near = (this.targets || [])
      .map((h) => ({ ...h, d: Math.hypot(h.sx - x, h.sy - y) }))
      .filter((h) => h.d <= DISTANCE);
    if (!near.length) {
      const ref = this.edgeTargets?.map((h) => ({...h, d: Math.hypot(h.sx-x, h.sy-y)}))
        .filter((h) => h.d < 8).sort((a, b) => a.d-b.d)[0]?.edge;
      if (ref) {
        const label = { uses: "Uses", "used-by": "Used by", both: "Linked in both directions" }[ref.direction];
        return { type: "label", l: { label: label + " · " + (ref.name || "Atlas theorem " + ref.atlas) }, anchor: ref.atlas };
      }
      if (!this.cat || !this.show.lean) return null;
      const background = super.hit(x, y);
      return Number.isInteger(background?.anchor) ? background : null;
    }
    near.sort((a, b) => a.d - b.d || a.stop.index - b.stop.index);
    // Several names can fall inside the same ring, especially at phone scale.
    // A new pointer lands on the nearest mark. Repeated clicks cycle in paper order.
    const ties = near.filter((h) => h.d - near[0].d <= 3.5)
      .sort((a, b) => a.stop.index - b.stop.index);
    const found = ties.findIndex((h) => h.stop === this.current);
    const stop = found < 0 ? near[0].stop : ties[(found + 1) % ties.length].stop;
    const hint = ties.length > 1 ? ` · click to cycle ${ties.length} stops` : "";
    return {
      type: "label",
      l: { label: `Stop ${stop.index + 1} · p. ${stop.page} · ${stop.id}${hint}` },
      stop,
    };
  }
}
