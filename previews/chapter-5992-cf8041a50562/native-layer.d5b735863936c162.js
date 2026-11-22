import { PointTree } from "./point-tree.3cc85be4105f3ffa.js";
import { merc, scopePass } from "./data.d84f1970349759e8.js";
import { loadNativeOverlay } from "./native.7d5caf1515c8b15d.js";

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
    this.selected = null;
    this.x = d.x;
    this.y = Float64Array.from(d.y, (v, i) => d.unplaced[i] ? v : merc(v));
    this.unplaced = d.unplaced;
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
  placementPass(i, m) {
    if (m.placement === "all") return true;
    if (this.unplaced[i]) return false;
    const d = this.data, method = d.method[i];
    const name = method < d.index.methods.length ? d.index.methods[method] : m.cat.meta.methods[method - d.index.methods.length];
    if (d.primary[i] >= 0 && ["source-owner", "explicit-owner", "registered-owner", "enclosing-written-command"].includes(name))
      return m.placementPass(d.primary[i]);
    const direct = ["registered-identifier", "kernel-type", "kernel-value", "source-identifier"].includes(name);
    return m.placement === (direct ? "direct" : "context");
  }
  pass(i, m) {
    const d = this.data;
    return (
      (!m.subject || d.index.topics[d.topic[i]].category === m.subject) &&
      scopePass(d[m.evidence][i], m.scope) && this.placementPass(i, m) &&
      (m.filterBundle === null ||
        (d.primary[i] >= 0 && m.cat.bundle[d.primary[i]] === m.filterBundle))
    );
  }
  draw(m) {
    if (!this.data) return;
    const d = this.data;
    const key = [m.scope, m.subject, m.evidence, m.placement, m.filterBundle, m.unplaced].join("|");
    if (key !== this.treeKey) {
      this.tree = new PointTree(this.x, this.y, i => Boolean(this.unplaced[i]) === m.unplaced && this.pass(i, m));
      this.treeKey = key;
    }
    const coarse = m.zoom < 8 && m.filterBundle === null;
    this.tree.visible(m.box(), m.unit, coarse ? 28 : 13, (node, members) => {
      const i = node.anchor;
      this.diamond(m, m.px(this.x[i]), m.py(this.y[i]), members, d.topic[i], coarse);
    });
    if (
      this.selected !== null &&
      Boolean(this.unplaced[this.selected]) === m.unplaced && this.pass(this.selected, m)
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
    m.screen.push({ type: "native", sx, sy, rad: r, ids, category: cat, count: ids.length });
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
