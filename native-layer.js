import { merc, scopePass } from "./data.js";
import { loadNativeOverlay } from "./native.js";

export class NativeLayer {
  async load() {
    if (this.data) return this;
    if (!this.pending)
      this.pending = this.init().catch((e) => {
        this.pending = null;
        throw e;
      });
    return this.pending;
  }
  async init() {
    const d = await loadNativeOverlay();
    this.data = d;
    this.cells = new Map();
    this.lastKey = null;
    this.selected = null;
    this.x = new Float32Array(d.count);
    this.y = new Float32Array(d.count);
    this.unplaced = new Uint8Array(d.count);
    let n = 0;
    for (const x of d.x) if (!Number.isFinite(x)) n++;
    let u = 0;
    for (let i = 0; i < d.count; i++) {
      let x = d.x[i],
        y = d.y[i];
      const missing = !Number.isFinite(x);
      if (missing) {
        const r = 10 * Math.sqrt((u + 0.5) / n),
          t = (u + 0.312) * 2.399963229728653;
        x = r * Math.cos(t);
        y = r * Math.sin(t);
        u++;
        this.unplaced[i] = 1;
      } else y = merc(y);
      this.x[i] = x;
      this.y[i] = y;
      const key = Number(missing) + ":" + Math.floor(x) + "," + Math.floor(y);
      let rows = this.cells.get(key);
      if (!rows) {
        rows = [];
        this.cells.set(key, rows);
      }
      rows.push(i);
    }
    return this;
  }
  indexOf(nativeId) {
    const a = this.data.id;
    let l = 0,
      r = a.length;
    while (l < r) {
      const k = Math.floor((l + r) / 2);
      if (a[k] < nativeId) l = k + 1;
      else r = k;
    }
    return a[l] === nativeId ? l : -1;
  }
  pass(i, m) {
    const d = this.data;
    return (
      (!m.subject || d.index.topics[d.topic[i]].category === m.subject) &&
      scopePass(d[m.evidence][i], m.scope) &&
      (m.filterBundle === null ||
        (d.primary[i] >= 0 && m.cat.bundle[d.primary[i]] === m.filterBundle))
    );
  }
  draw(m) {
    if (!this.data) return;
    const d = this.data,
      box = m.box(),
      coarse = m.zoom < 9 && !m.unplaced && m.filterBundle === null;
    const bins = new Map(),
      key = [m.scope, m.subject, m.evidence].join("|");
    if (coarse) {
      if (this.lastKey !== key) {
        this.groups = new Map();
        this.lastKey = key;
        for (let i = 0; i < d.count; i++)
          if (!this.unplaced[i] && this.pass(i, m)) {
            const topic = d.topic[i];
            if (!this.groups.has(topic))
              this.groups.set(topic, { ids: [], x: 0, y: 0 });
            const g = this.groups.get(topic);
            g.ids.push(i);
            g.x += this.x[i];
            g.y += this.y[i];
          }
      }
      for (const [topic, g] of this.groups) {
        const len = g.ids.length;
        this.diamond(m, m.px(g.x / len), m.py(g.y / len), g.ids, topic, true);
      }
    } else {
      const cols = Math.ceil((m.width + 32) / 9) + 3;
      const visit = (i) => {
        if (!this.pass(i, m)) return;
        const sx = m.px(this.x[i]),
          sy = m.py(this.y[i]);
        if (sx < -8 || sy < -8 || sx > m.width + 8 || sy > m.height + 8) return;
        const k = Math.floor((sx + 16) / 9) + cols * Math.floor((sy + 16) / 9);
        if (!bins.has(k)) bins.set(k, { ids: [], sx: 0, sy: 0 });
        const g = bins.get(k);
        g.ids.push(i);
        g.sx += sx;
        g.sy += sy;
      };
      const [l, b, r, t] = box;
      if ((r - l) * (t - b) > 2500) {
        for (let i = 0; i < d.count; i++)
          if (Boolean(this.unplaced[i]) === m.unplaced) visit(i);
      } else
        for (let x = Math.floor(l); x <= r; x++)
          for (let y = Math.floor(b); y <= t; y++) {
            const ids = this.cells.get(Number(m.unplaced) + ":" + x + "," + y);
            if (ids) for (const i of ids) visit(i);
          }
      for (const g of bins.values()) {
        const len = g.ids.length;
        this.diamond(
          m,
          g.sx / len,
          g.sy / len,
          g.ids,
          d.topic[g.ids[0]],
          false,
        );
      }
    }
    if (
      this.selected !== null &&
      Boolean(this.unplaced[this.selected]) === m.unplaced
    ) {
      const ctx = m.ctx;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        m.px(this.x[this.selected]),
        m.py(this.y[this.selected]),
        11,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }
  diamond(m, sx, sy, ids, topic, coarse) {
    if (sx < 0 || sy < 0 || sx > m.width || sy > m.height) return;
    const c = m.ctx,
      cat = this.data.index.topics[topic].category,
      r = coarse ? 7.5 : ids.length === 1 ? 4 : 6;
    c.fillStyle = "#253d47";
    c.strokeStyle = m.cat.categories.get(cat)?.color || "#c4d0cd";
    c.lineWidth = 1.7;
    c.beginPath();
    c.moveTo(sx, sy - r);
    c.lineTo(sx + r, sy);
    c.lineTo(sx, sy + r);
    c.lineTo(sx - r, sy);
    c.closePath();
    c.fill();
    c.stroke();
    m.screen.push({ type: "native", sx, sy, rad: r, ids, count: ids.length });
  }
  locate(m, id) {
    const i = this.indexOf(id);
    if (i < 0) return false;
    this.selected = i;
    m.setScene(Boolean(this.unplaced[i]));
    m.go(this.x[i], this.y[i], Math.max(115, m.zoom));
    return true;
  }
}
