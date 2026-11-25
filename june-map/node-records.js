// The row IDs, name IDs, archive theorem IDs and paper marker indices are distinct.
import {dataURL, readBytes, readURL} from "./papers.js";

const address = path => dataURL("../june-nodes/" + path);
const stable = new Map(), blocks = new Map(), wordBlocks = new Map();
const text = new TextDecoder();
const ID_MASK = 0xffffff, CONSTANT = 1 << 24, ROOT = 1 << 25, UNPLACED = 1 << 26;
const empty = () => ({total: 0, rows: []});
const nullable = value => value >= 0 ? value : null;
const idOK = value => Number.isSafeInteger(value) && value >= 0;
const validPart = (pos, size) => idOK(pos) && pos < size;

function memo(cache, key, load, maximum = Infinity) {
  if (cache.has(key)) {
    const value = cache.get(key);
    cache.delete(key); cache.set(key, value);
    return value;
  }
  const value = Promise.resolve().then(load).catch(error => {
    if (cache.get(key) === value) cache.delete(key);
    throw error;
  });
  cache.set(key, value);
  if (cache.size > maximum) cache.delete(cache.keys().next().value);
  return value;
}

export const nodeIndex = () => memo(stable, "index", () => readURL(address("index.json")));

function dataColumns(path, count) {
  return memo(blocks, path, async () => {
    const b = await readBytes(address(path));
    const view = new DataView(b), n = view.getUint32(0, true);
    if (4 + 4 * n * count !== b.byteLength) throw Error("Invalid proof-node record block.");
    return {n, get: (column, i) => view.getInt32(4 + 4 * (n * column + i), true)};
  }, 144);
}

function lowerBound(hi, highEnough) {
  let lo = 0;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (highEnough(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function wordBlock(part) {
  return memo(wordBlocks, part, async () => {
    const file = await readBytes(address("names/" + part + ".bin.gz")), v = new DataView(file);
    const entries = v.getUint32(0, true), postings = v.getUint32(4, true);
    const countsAt = 8 + 4 * entries, refsAt = countsAt + 4 * entries, stringsAt = refsAt + 4 * postings;
    if (stringsAt > file.byteLength) throw Error("Invalid proof name directory.");
    const starts = new Uint32Array(entries + 1), first = new Uint32Array(entries + 1);
    for (let i = 0; i < entries; i++) {
      starts[i + 1] = starts[i] + v.getUint32(8 + 4 * i, true);
      first[i + 1] = first[i] + v.getUint32(countsAt + 4 * i, true);
    }
    if (starts[entries] + stringsAt !== file.byteLength || first[entries] !== postings)
      throw Error("Invalid proof name block.");
    const bytes = new Uint8Array(file, stringsAt), decoded = new Array(entries);
    return {
      entries, first,
      name(i) { return decoded[i] ??= text.decode(bytes.subarray(starts[i], starts[i + 1])); },
      ref(i) { return v.getUint32(refsAt + i * 4, true); }
    };
  }, 100);
}

async function nameAt(index, no) {
  if (!validPart(no, index.wordCount)) throw Error("Invalid proof node name reference.");
  const block = await wordBlock(Math.floor(no / index.wordStride));
  return block.name(no % index.wordStride);
}

async function allBundles() {
  return memo(stable, "bundles", async () => {
    const rows = await readURL(address("bundles.json.gz"));
    const byId = new Map(), byMarker = new Map();
    const groups = rows.map(([id, label, marker, writtenStart, written, rhWritten, constantStart, constant, rhConstant]) =>
      ({id, label, marker, writtenStart, written, rhWritten, constantStart, constant, rhConstant}));
    for (const group of groups) {
      if (group.id === null) continue;
      byId.set(group.id, group);
      if (group.marker === null) continue;
      if (!byMarker.has(group.marker)) byMarker.set(group.marker, []);
      byMarker.get(group.marker).push(group);
    }
    return {groups, byId, byMarker, unplaced: groups.find(g => g.id === null)};
  });
}

export async function proofBundle(id) {
  return (await allBundles()).byId.get(id) ?? null;
}

export async function bundlesAt(marker, scope = "rh") {
  const items = (await allBundles()).byMarker.get(marker) ?? [];
  return items.filter(group => (scope === "rh" ? group.rhWritten + group.rhConstant : group.written + group.constant) > 0);
}

async function moduleAt(index, no) {
  const part = Math.floor(no / index.moduleStride), path = "modules/" + part + ".json.gz";
  const rows = await memo(blocks, path, () => readURL(address(path)), 144);
  const [file, hash, module] = rows[no % index.moduleStride];
  return {module: module ?? file.slice(0, -5).replaceAll("/", "."), path: file, moduleSha256: hash};
}

function sourceLink(index, path, first, end, endCol) {
  const last = end > first && endCol === 1 ? end - 1 : end;
  const escaped = path.split("/").map(encodeURIComponent).join("/");
  return index.sourceBase + escaped + "#L" + first + (last > first ? "-L" + last : "");
}

function unpack(fields, block, local) {
  return Object.fromEntries(fields.map((field, i) => [field, block.get(i, local)]));
}

async function rawWritten(index, id) {
  if (!validPart(id, index.counts.all.written)) return null;
  const part = Math.floor(id / index.recordStride), path = "written/" + part + ".bin.gz";
  const record = await dataColumns(path, index.fields.written.length);
  return unpack(index.fields.written, record, id % index.recordStride);
}

async function rawConstant(index, id) {
  if (!idOK(id) || id > ID_MASK) return null;
  const starts = index.firstConstantIds;
  const part = lowerBound(starts.length, i => starts[i] > id) - 1;
  if (part < 0) return null;
  const block = await dataColumns("constants/" + part + ".bin.gz", index.fields.constant.length);
  const pos = lowerBound(block.n, i => block.get(0, i) >= id);
  if (pos === block.n || block.get(0, pos) !== id) return null;
  return unpack(index.fields.constant, block, pos);
}

export async function writtenFromAtlas(row) {
  const index = await nodeIndex();
  if (!validPart(row, index.atlasCount)) return null;
  const part = Math.floor(row / index.memberStride);
  const block = await dataColumns("atlas-rows/" + part + ".bin.gz", 1);
  return block.get(0, row % index.memberStride);
}

export async function writtenRecord(id) {
  const index = await nodeIndex(), w = await rawWritten(index, id);
  if (!w) return null;
  const [name, module, groups] = await Promise.all([nameAt(index, w.name), moduleAt(index, w.module), allBundles()]);
  const bundle = groups.groups[w.bundle];
  return {kind: "written", id, name, commandKind: index.writtenKinds[w.kind], ...module,
    line: w.line, col: w.col, endLine: w.endLine, endCol: w.endCol, selectionLine: w.selectionLine,
    selectionCol: w.selectionCol, sourceUrl: sourceLink(index, module.path, w.line, w.endLine, w.endCol),
    marker: bundle.marker, route: index.routes[w.route], atlas: nullable(w.atlas), bundle: bundle.id,
    originalBundle: w.originalBundle >= 0 ? groups.groups[w.originalBundle].id : null,
    theoremBasis: index.theoremBases[w.basis] ?? null, theoremConfidence: index.theoremTiers[w.tier] ?? null,
    witnessAtlas: nullable(w.witness), contextRelation: index.contextRelations[w.relation] ?? null,
    rooted: Boolean(w.mask & index.root.bit), mask: w.mask, termMask: w.termMask, valueMask: w.valueMask,
    ownedCount: w.ownedCount, rhOwnedCount: w.rhOwnedCount, primaryConstant: nullable(w.primary)};
}

export async function constantSummary(id) {
  const index = await nodeIndex(), c = await rawConstant(index, id);
  if (!c) return null;
  return {kind: "constant", id, name: await nameAt(index, c.name), rooted: Boolean(c.mask & index.root.bit)};
}

export async function constantRecord(id) {
  const index = await nodeIndex(), c = await rawConstant(index, id);
  if (!c) return null;
  const [name, written] = await Promise.all([nameAt(index, c.name), c.owner >= 0 ? writtenRecord(c.owner) : null]);
  return {kind: "constant", id, name, constantKind: index.constantKinds[c.kind], owner: nullable(c.owner),
    ownerStatus: c.owner >= 0 ? "recorded-owner" : c.owner === -2 ? "project-owner-unresolved" : "external-or-unseen",
    ownerBasis: index.ownerBases[c.basis] ?? null, ownerDecision: index.decisions[c.decision] ?? null,
    rooted: Boolean(c.mask & index.root.bit), mask: c.mask, termMask: c.termMask, valueMask: c.valueMask,
    marker: written?.marker ?? null, route: written?.route ?? null, bundle: written?.bundle ?? null,
    witnessAtlas: written?.witnessAtlas ?? null, contextRelation: written?.contextRelation ?? null,
    sourceUrl: written?.sourceUrl ?? null, path: written?.path ?? null, line: written?.line ?? null,
    col: written?.col ?? null, endLine: written?.endLine ?? null, endCol: written?.endCol ?? null,
    typeExpr: c.typeExpr, valueExpr: nullable(c.valueExpr), byteOffset: c.byteHigh * 0x1000000 + c.byteLow};
}

function paging(start, count) {
  if (!idOK(start) || !idOK(count)) throw Error("Invalid proof-node page.");
  // All callers select a finite window; the index reports the complete count independently.
  return {offset: start, limit: count};
}

// Query the concatenation of the selected group intervals. Only requests blocks intersecting
// the requested page. Each interval has its exact RH prefix, so rooted pagination has no scan.
export async function listNodes({kind = "written", scope = "rh", marker = null, bundle = null,
  owner = null, unplaced = false, offset = 0, limit = 25} = {}) {
  paging(offset, limit);
  const index = await nodeIndex();
  if (!["written", "constant"].includes(kind) || !["rh", "all"].includes(scope)) return empty();
  let ranges, file;
  if (owner !== null) {
    if (kind !== "constant" || unplaced) return empty();
    const w = await rawWritten(index, owner);
    if (!w) return empty();
    if (bundle !== null || marker !== null) {
      const b = (await allBundles()).groups[w.bundle];
      if ((bundle !== null && b.id !== bundle) || (marker !== null && b.marker !== marker)) return empty();
    }
    ranges = [[w.ownedStart, scope === "rh" ? w.rhOwnedCount : w.ownedCount, w.rhOwnedCount]];
    file = "owned";
  } else {
    const catalog = await allBundles();
    let groups;
    if (unplaced) groups = kind === "constant" && bundle === null && marker === null ? [catalog.unplaced] : [];
    else if (bundle !== null) {
      const b = catalog.byId.get(bundle);
      groups = b && (marker === null || b.marker === marker) ? [b] : [];
    } else if (marker !== null) groups = catalog.byMarker.get(marker) ?? [];
    else groups = catalog.groups;
    const rootCount = kind === "written" ? "rhWritten" : "rhConstant";
    ranges = groups.map(b => [b[kind + "Start"], scope === "rh" ? b[rootCount] : b[kind], b[rootCount]]);
    file = "members-" + kind;
  }
  let total = 0;
  const parts = [];
  for (const [first, size, rooted] of ranges) {
    const pageLo = Math.max(0, offset - total), pageHi = Math.min(size, offset + limit - total);
    for (let rel = pageLo; rel < pageHi; rel++) parts.push([first + rel, rel < rooted]);
    total += size;
  }
  const rows = await Promise.all(parts.map(async ([pos, rooted]) => {
    const block = await dataColumns(file + "/" + Math.floor(pos / index.memberStride) + ".bin.gz", 2);
    const i = pos % index.memberStride;
    return {kind, id: block.get(0, i), name: await nameAt(index, block.get(1, i)), rooted};
  }));
  return {total, rows};
}

function prefixEnd(value) {
  // Exclusive upper bound in JavaScript's UTF-16 code-unit ordering.
  for (let i = value.length - 1; i >= 0; i--) {
    const n = value.charCodeAt(i);
    if (n < 65535) return value.slice(0, i) + String.fromCharCode(n + 1);
  }
  return null;
}

export async function findNodes(query, {kind = "both", scope = "rh", unplaced = false,
  match = "prefix", offset = 0, limit = 25} = {}) {
  paging(offset, limit);
  const spelling = String(query ?? "").trim(), prefix = spelling.toLowerCase();
  const exact = match === "exact" || match === "spelling";
  if (!prefix || !["both", "constant", "written"].includes(kind) || !["rh", "all"].includes(scope) ||
      !["prefix", "exact", "spelling"].includes(match) || (unplaced && kind === "written")) return empty();
  const directory = await memo(stable, "names", () => readURL(address("name-index.json.gz")));
  const hi = prefixEnd(prefix);
  const first = lowerBound(directory.length, i => directory[i][1] >= prefix);
  const until = exact ? lowerBound(directory.length, i => directory[i][0] > prefix)
    : hi === null ? directory.length : lowerBound(directory.length, i => directory[i][0] >= hi);
  const matchesName = value => exact ? value === prefix : value.startsWith(prefix);
  function count(block) {
    const root = scope === "rh" ? 1 : 0;
    if (unplaced) return block[6 + root];
    if (kind === "written") return block[2 + root];
    if (kind === "constant") return block[4 + root];
    return block[2 + root] + block[4 + root];
  }
  function accepts(ref) {
    return (scope === "all" || Boolean(ref & ROOT)) && (!unplaced || Boolean(ref & UNPLACED))
      && (kind === "both" || ((kind === "constant") === Boolean(ref & CONSTANT)));
  }
  const rows = [];
  let total = 0;
  for (let part = first; part < until; part++) {
    // Case-significant Lean spelling can distinguish the proposition RiemannHypothesis
    // from the written theorem riemannHypothesis within one folded search key.
    const desc = directory[part], coversBlock = match !== "spelling" && matchesName(desc[0]) && matchesName(desc[1]);
    if (coversBlock) {
      const n = count(desc);
      if (n === 0 || total + n <= offset || rows.length >= limit) { total += n; continue; }
    }
    const block = await wordBlock(part);
    const from = coversBlock ? 0 : lowerBound(block.entries, i => block.name(i).toLowerCase() >= prefix);
    for (let i = from; i < block.entries; i++) {
      const name = block.name(i);
      if (!coversBlock && !matchesName(name.toLowerCase())) break;
      if (match === "spelling" && name !== spelling) continue;
      for (let j = block.first[i]; j < block.first[i + 1]; j++) {
        const ref = block.ref(j);
        if (!accepts(ref)) continue;
        if (total >= offset && rows.length < limit) rows.push({
          kind: ref & CONSTANT ? "constant" : "written", id: ref & ID_MASK, name,
          rooted: Boolean(ref & ROOT), unplaced: Boolean(ref & UNPLACED)
        });
        total++;
      }
    }
  }
  return {total, rows};
}
