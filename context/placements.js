import { bytes, json } from "../io.js";
import { PointTree } from "../point-tree.js";

const base = "data/context/";
export const routes = ["reference", "file", "unit", "directory"];
const recordBytes = 24;

export function ordinalOf(sorted, id) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (sorted[mid] < id) lo = mid + 1;
    else hi = mid;
  }
  return sorted[lo] === id ? lo : -1;
}

export class Placements {
  constructor(cat) {
    this.cat = cat;
    this.enabled = true;
    this.mode = "all";
    this.selected = -1;
    this.hits = [];
  }

  load() {
    if (!this.pending) this.pending = this.read().catch(error => {
      this.pending = null;
      throw error;
    });
    return this.pending;
  }

  async read() {
    const [meta, data, masks] = await Promise.all([
      json(base + "index.json"), bytes(base + "points.bin.gz"), bytes(base + "masks.bin.gz"),
    ]);
    if (meta.schema !== 1 || meta.sourcePin !== this.cat.index.sourcePin ||
        data.byteLength !== meta.count * recordBytes || masks.byteLength !== 2 * meta.count)
      throw Error("The contextual placements and the Explorer have different editions.");
    const n = meta.count, view = new DataView(data);
    this.row = new Uint32Array(n);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.anchor = new Int32Array(n);
    this.theorem = new Int32Array(n);
    this.route = new Uint8Array(n);
    this.supported = new Uint8Array(n);
    this.mask = new Uint8Array(n);
    this.category = new Uint8Array(n);
    this.masks = new Uint8Array(masks);
    this.fromTheorem = new Map();
    for (let i = 0, p = 0; i < n; i++, p += recordBytes) {
      this.row[i] = view.getUint32(p, true);
      this.x[i] = view.getFloat32(p + 4, true);
      this.y[i] = view.getFloat32(p + 8, true);
      this.anchor[i] = view.getInt32(p + 12, true);
      this.theorem[i] = view.getInt32(p + 16, true);
      this.route[i] = view.getUint8(p + 20);
      this.supported[i] = view.getUint8(p + 21);
      this.mask[i] = view.getUint8(p + 22);
      this.category[i] = view.getUint8(p + 23);
      if (this.theorem[i] >= 0) this.fromTheorem.set(this.theorem[i], i);
    }
    this.meta = meta;
  }

  async record(i) {
    const stride = this.meta.recordStride;
    const part = await json(base + "records/" + Math.floor(i / stride) + ".json.gz");
    const record = part[i % stride];
    if (!record || record.row !== this.row[i]) throw Error("The contextual source record is missing.");
    return record;
  }

  async names(query) {
    await this.load();
    const q = query.trim().toLowerCase(), last = q.split(".").at(-1);
    if (!last) return [];
    const bucket = last.codePointAt(0) % 64;
    if (!this.meta.namesBuckets.includes(bucket)) return [];
    const people = await json(base + "names/" + bucket + ".json.gz");
    const exact = [], prefix = [];
    for (const [row, name] of people) {
      const full = name.toLowerCase(), leaf = full.split(".").at(-1);
      if (full === q || leaf === q) exact.push(row);
      else if (leaf.startsWith(last) && (!q.includes(".") || full.includes(q))) prefix.push(row);
    }
    return exact.concat(prefix);
  }

  visibleInMode(i, mode) {
    if (mode === "suggested") return !!this.supported[i];
    if (mode === "remaining") return !this.supported[i];
    if (mode === "remaining-theorems") return !this.supported[i] && this.theorem[i] >= 0;
    if (mode === "theorems") return this.theorem[i] >= 0;
    if (mode === "directory") return this.route[i] === 3;
    return true;
  }

  pass(i, m, scopePass) {
    if (m.unplaced || m.placement === "direct") return false;
    if (m.subject && m.cat.index.categories[this.category[i]].id !== m.subject) return false;
    if (m.filterBundle !== null && m.cat.bundle[this.anchor[i]] !== m.filterBundle) return false;
    const mask = m.evidence === "termMask" ? this.masks[i * 2] :
      m.evidence === "valueMask" ? this.masks[i * 2 + 1] : this.mask[i];
    return scopePass(mask, m.scope) && this.visibleInMode(i, this.mode);
  }

  draw(m) {
    this.hits = [];
    if (!this.enabled || !this.meta || m.unplaced || m.chapterLayer?.active || m.placement === "direct") return;
    const key = [this.mode, m.scope, m.subject, m.evidence, m.placement, m.filterBundle].join("|");
    if (this.treeKey !== key) {
      this.tree = new PointTree(this.x, this.y, i => this.pass(i, m, this.scopePass));
      this.treeKey = key;
    }
    const ctx = m.ctx;
    const ring = (i, members, selected) => {
      const sx = m.px(this.x[i]), sy = m.py(this.y[i]);
      if (sx < -12 || sy < -12 || sx > m.width + 12 || sy > m.height + 12) return;
      const n = members.length, r = selected ? 10 : n === 1 ? 4.8 : Math.min(10, 5 + Math.log2(n) * .42);
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.lineWidth = selected ? 4 : 3; ctx.strokeStyle = "#152722"; ctx.stroke();
      ctx.lineWidth = selected ? 2.3 : 1.55;
      ctx.strokeStyle = selected ? "#fff4ce" : this.supported[i] ? "#ffd485" : "#a9e2d4"; ctx.stroke();
      if (this.supported[i]) {
        ctx.beginPath(); ctx.arc(sx, sy, selected ? 2.9 : 1.7, 0, Math.PI * 2);
        ctx.fillStyle = "#ffd485"; ctx.fill();
      }
      this.hits.push({type:"context", i, members, sx, sy, rad:r, count:n,
        label:n === 1 ? (this.supported[i] ? "Suggested topic" : "Placed by context · subject open") :
          n.toLocaleString("en-US") + " contextual placements"});
    };
    ctx.save();
    this.tree.visible(m.box(), m.unit, m.zoom < 8 ? 37 : 18, (node, members) => ring(node.anchor, members, false));
    if (this.selected >= 0 && this.pass(this.selected, m, this.scopePass)) ring(this.selected, [this.selected], true);
    ctx.restore();
  }

  hit(x, y) {
    let best = null, distance = Infinity;
    for (let j = this.hits.length - 1; j >= 0; j--) {
      const h = this.hits[j], d = Math.hypot(x - h.sx, y - h.sy);
      if (d <= h.rad + 2.5 && d < distance) { best = h; distance = d; }
    }
    return best;
  }
}
