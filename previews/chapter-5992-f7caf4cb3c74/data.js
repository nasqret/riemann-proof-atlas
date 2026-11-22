import { attributionWitness, refinement, refinedPoints } from "./attribution.js";
import { bytes, json } from "./io.js";
export { bytes, json } from "./io.js";
export const fmt = (value) => Number(value || 0).toLocaleString("en-US");
export const merc = (lat) =>
  (180 / Math.PI) * Math.asinh(Math.tan((lat * Math.PI) / 180));
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
    const [index, original, topics, meta, groups] = await Promise.all([
      json(base + "index.json"),
      json(base + "bundles.json.gz"),
      json(base + "topics.json"),
      json(refinement + "index.json"), json(refinement + "groups.json.gz"),
    ]);
    if (meta.sourcePin !== index.sourcePin || meta.oldBundles !== original.length) throw Error("Incompatible attribution edition");
    const bundles = [...original.map(b => b.id === "unplaced" ? { ...b, count: 0 } : b), ...groups];
    const basisOffset = index.bases.length;
    const tier = meta.tiers.map(v => index.confidences.indexOf(v));
    this.index = { ...index, bundles: meta.bundles, categoryCounts: meta.categories,
      bases: [...index.bases, ...meta.methods], bundleEdges: meta.bundleEdges,
      boundsCounts: { ...index.boundsCounts, placed: meta.placed, unplaced: meta.sourceIndex } };
    const direct = new Set(["blueprint", "declaration", "corpus-symbol", "proof-reference",
      "kernel-type", "kernel-value", "source-identifier"]);
    this.placementClass = this.index.bases.map(method => direct.has(method) ? "direct"
      : ["unresolved", "source-family"].includes(method) ? "source" : "context");
    this.basisOffset = basisOffset;
    Object.assign(this, { bundles, topics, base, meta });
    this.index.categories = index.categories.map(c => c.id === "unresolved" ? {...c, label: "Source-section index"} : c);
    this.categories = new Map(this.index.categories.map(c => [c.id, c]));
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
        this.unplaced[i] = Number(!Number.isFinite(this.x[i]));
        this.termMask[i] = bin.getUint8(o + 16);
        this.valueMask[i] = bin.getUint8(o + 17);
      }
    }
    await refinedPoints("points.bin.gz", meta.oldUnplaced, (id, x, y, b, method) => {
      if (id >= index.count || !this.unplaced[id] || !groups[b - original.length]) throw Error("Invalid refined source identity");
      this.x[id] = x; this.y[id] = y; this.bundle[id] = b;
      this.unplaced[id] = Number(bundles[b].topic === "unresolved");
      this.conf[id] = tier[method]; this.basis[id] = basisOffset + method;
    });
    for (let i = 0; i < index.count; i++) this.members[this.bundle[i]].push(i);
    return this;
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
    const r = (await json(this.base + "records/" + Math.floor(i / stride) + ".json.gz"))[i % stride];
    if (this.basis[i] < this.basisOffset) return r;
    const b = this.bundles[this.bundle[i]], witness = await attributionWitness("written", i, this.meta);
    return { ...r, topic: b.topic, anchor: b.anchor, terms: [witness], family: b.family };
  }
  async neighbors(i) {
    const stride = this.index.recordStride;
    return (
      await json(this.base + "links/" + Math.floor(i / stride) + ".json.gz")
    )[i % stride];
  }
  proofLinks() {
    return json(refinement + "bundle-links.json.gz");
  }
  reading() {
    return json(this.base + "reading.json");
  }
}
