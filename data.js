const memo = new Map();
export const fmt = (value) => Number(value || 0).toLocaleString("en-US");
export const merc = (lat) =>
  (180 / Math.PI) * Math.asinh(Math.tan((lat * Math.PI) / 180));
export async function bytes(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error("Could not read " + url + " (" + response.status + ")");
  const data = await response.arrayBuffer();
  const head = new Uint8Array(data, 0, Math.min(2, data.byteLength));
  if (head[0] === 31 && head[1] === 139) {
    const stream = new Blob([data])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }
  return data;
}
export function json(url) {
  if (!memo.has(url))
    memo.set(
      url,
      bytes(url)
        .then((b) => JSON.parse(new TextDecoder().decode(b)))
        .catch((e) => {
          memo.delete(url);
          throw e;
        }),
    );
  return memo.get(url);
}
export function scopePass(mask, scope) {
  switch (scope) {
    case "all":
      return true;
    case "any":
      return mask !== 255 && mask > 0;
    case "outside":
      return mask === 0;
    case "unknown":
      return mask === 255;
    default:
      return mask !== 255 && (mask & Number(scope)) !== 0;
  }
}
export class Catalog {
  async load() {
    const base = "data/lean/";
    const [index, bundles, topics] = await Promise.all([
      json(base + "index.json"),
      json(base + "bundles.json.gz"),
      json(base + "topics.json"),
    ]);
    Object.assign(this, { index, bundles, topics, base });
    this.categories = new Map(index.categories.map((c) => [c.id, c]));
    this.topic = new Map(topics.map((t) => [t.id, t]));
    this.bundleMap = new Map(bundles.map((b, i) => [b.id, i]));
    this.x = new Float32Array(index.count);
    this.y = new Float32Array(index.count);
    this.bundle = new Uint32Array(index.count);
    this.mask = new Uint8Array(index.count);
    this.conf = new Uint8Array(index.count);
    this.basis = new Uint8Array(index.count);
    this.kind = new Uint8Array(index.count);
    this.termMask = new Uint8Array(index.count);
    this.valueMask = new Uint8Array(index.count);
    this.members = bundles.map(() => []);
    this.unplaced = new Uint8Array(index.count);
    this.spatial = new Map();
    const shardInfo = await Promise.all(
      index.pointFiles.map(async (path, shard) => {
        const bin = new DataView(await bytes(base + path));
        const n = bin.byteLength / index.pointBytes;
        if (
          !Number.isInteger(n) ||
          n !==
            Math.min(index.pointStride, index.count - shard * index.pointStride)
        )
          throw Error("Incomplete point shard " + path);
        return [bin, n];
      }),
    );
    let unplacedCount = 0;
    for (let shard = 0; shard < shardInfo.length; shard++) {
      const [bin, n] = shardInfo[shard];
      for (let k = 0; k < n; k++) {
        const i = shard * index.pointStride + k,
          o = k * index.pointBytes;
        this.x[i] = bin.getFloat32(o, true);
        this.y[i] = bin.getFloat32(o + 4, true);
        const b = bin.getUint32(o + 8, true);
        this.bundle[i] = b;
        this.mask[i] = bin.getUint8(o + 12);
        this.conf[i] = bin.getUint8(o + 13);
        this.basis[i] = bin.getUint8(o + 14);
        this.kind[i] = bin.getUint8(o + 15);
        if (!Number.isFinite(this.x[i])) {
          this.unplaced[i] = 1;
          unplacedCount++;
        }
        this.termMask[i] = bin.getUint8(o + 16);
        this.valueMask[i] = bin.getUint8(o + 17);
        this.members[b].push(i);
      }
    }
    let u = 0;
    for (let i = 0; i < index.count; i++) {
      if (this.unplaced[i]) {
        // A separately labelled index-space view. These are never arXiv coordinates.
        const r = 10 * Math.sqrt((u + 0.5) / Math.max(1, unplacedCount)),
          a = u * 2.399963229728653;
        this.x[i] = r * Math.cos(a);
        this.y[i] = r * Math.sin(a);
        u++;
      }
      const key = this.cell(this.x[i], this.y[i], Boolean(this.unplaced[i]));
      let members = this.spatial.get(key);
      if (!members) {
        members = [];
        this.spatial.set(key, members);
      }
      members.push(i);
    }
    return this;
  }
  cell(x, y, unplaced) {
    return (unplaced ? "u" : "g") + Math.floor(x) + "," + Math.floor(y);
  }
  visible(bounds, unplaced, visit) {
    const [l, b, r, t] = bounds;
    const nx = Math.floor(r) - Math.floor(l) + 1,
      ny = Math.floor(t) - Math.floor(b) + 1;
    if (nx * ny > 2800) {
      for (let i = 0; i < this.index.count; i++)
        if (Boolean(this.unplaced[i]) === unplaced) visit(i);
      return;
    }
    for (let x = Math.floor(l); x <= r; x++)
      for (let y = Math.floor(b); y <= t; y++) {
        const members = this.spatial.get(this.cell(x, y, unplaced));
        if (members) for (const i of members) visit(i);
      }
  }
  async witness(kernel, endpoint) {
    const cfg = this.index.paths;
    if (!cfg) throw Error("No predecessor index for this edition");
    if (!this.witnessIndex)
      this.witnessIndex = (async () => {
        const parts = await Promise.all(
          cfg.files.map((p) => bytes(this.base + p)),
        );
        const table = new Uint32Array(cfg.count * 6);
        let off = 0;
        for (const part of parts) {
          const dv = new DataView(part);
          for (let j = 0; j < part.byteLength; j += 4)
            table[off++] = dv.getUint32(j, true);
        }
        if (off !== table.length) throw Error("Incomplete predecessor index");
        return table;
      })().catch((e) => {
        this.witnessIndex = null;
        throw e;
      });
    const table = await this.witnessIndex;
    let lo = 0,
      hi = cfg.count;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (table[6 * mid] < kernel) lo = mid + 1;
      else hi = mid;
    }
    if (lo === cfg.count || table[6 * lo] !== kernel)
      throw Error("No witness found for this declaration");
    const chain = [],
      seen = new Set();
    for (let rank = lo; rank >= 0; rank = table[6 * rank + 1 + endpoint] - 1) {
      if (seen.has(rank) || rank >= cfg.count)
        throw Error("Inconsistent predecessor chain");
      seen.add(rank);
      chain.push(rank);
    }
    const names = await Promise.all(
      chain
        .reverse()
        .map(
          async (rank) =>
            (
              await json(
                this.base +
                  "paths/names-" +
                  Math.floor(rank / cfg.nameStride) +
                  ".json.gz",
              )
            )[rank % cfg.nameStride],
        ),
    );
    if (names[0][0] !== this.index.roots[endpoint].name)
      throw Error("Witness stops before the selected endpoint");
    return names;
  }
  async record(i) {
    const stride = this.index.recordStride;
    return (
      await json(this.base + "records/" + Math.floor(i / stride) + ".json.gz")
    )[i % stride];
  }
  async neighbors(i) {
    const stride = this.index.recordStride;
    return (
      await json(this.base + "links/" + Math.floor(i / stride) + ".json.gz")
    )[i % stride];
  }
  proofLinks() {
    return json(this.base + "bundle-links.json.gz");
  }
  reading() {
    return json(this.base + "reading.json");
  }
}
