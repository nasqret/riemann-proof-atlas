// Each occupied cell anchors to its first source ID. Refining a cell keeps
// that anchor in one child. Panning only culls cells; it never changes a group.
export class PointTree {
  constructor(x, y, include, subset) {
    this.x = x;
    this.y = y;
    const length = subset ? subset.length : x.length;
    const rows = new Uint32Array(length);
    let n = 0, extent = 1;
    for (let j = 0; j < length; j++) {
      const id = subset ? subset[j] : j;
      if (!include(id)) continue;
      rows[n++] = id;
      extent = Math.max(extent, Math.abs(x[id]), Math.abs(y[id]));
    }
    this.ids = rows.subarray(0, n);
    this.scratch = new Uint32Array(n);
    this.root = n ? this.node(0, n, 0, 0, 2 ** Math.ceil(Math.log2(extent))) : null;
  }
  node(start, end, x, y, half) {
    return { start, end, x, y, half, anchor: this.ids[start], children: null };
  }
  split(node) {
    const { start, end, x, y, half } = node;
    const counts = [0, 0, 0, 0];
    const quadrant = id => Number(this.x[id] >= x) + 2 * Number(this.y[id] >= y);
    for (let j = start; j < end; j++) counts[quadrant(this.ids[j])]++;
    const offsets = [start, start + counts[0], start + counts[0] + counts[1], end - counts[3]];
    const write = offsets.slice();
    for (let j = start; j < end; j++) {
      const id = this.ids[j];
      this.scratch[write[quadrant(id)]++] = id;
    }
    this.ids.set(this.scratch.subarray(start, end), start);
    const h = half / 2, children = [];
    for (let q = 0; q < 4; q++) {
      if (counts[q]) children.push(this.node(offsets[q], write[q], x + (q & 1 ? h : -h), y + (q & 2 ? h : -h), h));
    }
    node.children = children;
    return children;
  }
  visible(bounds, unit, pixels, draw) {
    const margin = 16 / unit;
    const visit = n => {
      const h = n.half;
      if (n.x + h < bounds[0] - margin || n.y + h < bounds[1] - margin ||
          n.x - h > bounds[2] + margin || n.y - h > bounds[3] + margin) return;
      if (n.end - n.start === 1 || 2 * h * unit <= pixels) {
        draw(n, this.ids.subarray(n.start, n.end));
      } else {
        for (const child of n.children || this.split(n)) visit(child);
      }
    };
    if (this.root) visit(this.root);
  }
}
