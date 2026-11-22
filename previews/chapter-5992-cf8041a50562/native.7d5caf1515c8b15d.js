import { attributionWitness, methodText, refinement, refinedPoints } from "./attribution.6be4e17d59387f6f.js";
import { bytes, json } from "./data.d84f1970349759e8.js";

const BASE = "data/native/";
const normal = (value) => value.normalize("NFKC").toLowerCase();
const index = () => json(BASE + "index.json");
const amount = (n) => n.toLocaleString("en-US");
const showSource = {
  "compiler-registered-selection": "Compiler-registered source selection",
  "written-name-with-native-module-match": "Written declaration name",
  "longest-ranged-kernel-name-prefix-in-same-module":
    "Ranged enclosing name in this module",
  "no-own-range-or-ranged-kernel-name-prefix": "Original module",
};
const methodLabel = {
  "explicit-source": "Explicit source placement",
  "explicit-owner": "Topic inherited from the named source owner",
  "enclosing-written-command":
    "Topic inherited from the enclosing written command",
  "registered-identifier":
    "Topic matched from the registered declaration identifier",
  "registered-owner": "Topic inherited from a separately registered owner",
  unplaced: "No supported map placement",
};
const endpointNames = [
  "riemannHypothesis",
  "riemannZeta_eq_zero_re",
  "LFunction_ne_zero_of_half_lt_re",
  "LFunction_eq_zero_re",
  "LFunction_eq_zero_re_of_isPrimitive",
];

function node(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function action(label, run, cls = "") {
  const b = node("button", label, cls);
  b.type = "button";
  b.addEventListener("click", run);
  return b;
}
function link(label, url) {
  const a = node("a", label, "extlink");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}
function sourceUrl(base, module, span) {
  const file = module.split(".").map(encodeURIComponent).join("/") + ".lean";
  if (!span?.length) return base + file;
  const first = span[0],
    last =
      span.length >= 4
        ? Math.max(first, span[2] - (span[3] === 1 ? 1 : 0))
        : first;
  return base + file + "#L" + first + (last > first ? "-L" + last : "");
}
function searchFields(mode) {
  return mode === "module" ? ["module", "moduleTail"] : ["full", "tail"];
}
async function directoryModule(i, manifest) {
  const block = await json(
    BASE + "modules/" + Math.floor(i / manifest.moduleStride) + ".json.gz",
  );
  return block[i % manifest.moduleStride];
}
export async function nativeDetail(id) {
  const m = await index();
  if (!Number.isInteger(id) || id < 0 || id >= m.count)
    throw new RangeError("Unknown native theorem ID");
  const block = await json(
    BASE + "records/" + Math.floor(id / m.recordStride) + ".json.gz",
  );
  const values = block[id % m.recordStride],
    r = Object.fromEntries(m.fields.map((key, i) => [key, values[i]]));
  const [module, first, count, exported, allExported] = await directoryModule(
    r.module,
    m,
  );
  const meta = await json(refinement + "index.json");
  let refined = null;
  if (r.x === null && (r.written !== null || r.selection.length || r.owner)) {
    const [topic, method, term] = await attributionWitness("native", id, meta);
    refined = { topic: m.topics[topic], placement: meta.methods[method], terms: [term],
      hasPlacement: m.topics[topic].id !== "unresolved" };
  }
  const moduleId = r.module;
  r.module = module;
  return {
    ...r,
    id,
    moduleId,
    moduleFirst: first,
    moduleNative: count,
    moduleExported: exported,
    moduleAllExported: allExported,
    origin: m.kinds[r.origin],
    sourceBasis: m.sourceBases[r.sourceBasis],
    form: m.forms[r.form],
    topic: m.topics[r.topic],
    placement: m.methods[r.placement],
    hasPlacement: r.x !== null,
    ...refined,
    source: sourceUrl(m.sourceBase, module, r.anchor),
    moduleSource: sourceUrl(m.sourceBase, module, []),
    commandSource: r.command.length
      ? sourceUrl(m.sourceBase, module, r.command)
      : null,
  };
}
export async function searchNative(
  query,
  { mode = "name", offset = 0, limit = 30 } = {},
) {
  const m = await index(),
    q = normal(String(query).trim());
  if (!q) return { results: [], hasMore: false };
  const needed = Math.max(1, offset + limit + 1),
    found = new Map();
  for (const field of searchFields(mode)) {
    for (const [first, last, , path] of m.search[field]) {
      if (last < q) continue;
      if (first > q && !first.startsWith(q)) break;
      const block = await json(BASE + path);
      for (const [name, id] of block) {
        const key = normal(name);
        if (key < q) continue;
        if (!key.startsWith(q)) break;
        if (!found.has(id)) found.set(id, { id, name, field });
        if (found.size >= needed) break;
      }
      if (found.size >= needed) break;
    }
    if (found.size >= needed) break;
  }
  const rows = Array.from(found.values());
  return {
    results: rows.slice(offset, offset + limit),
    hasMore: rows.length > offset + limit,
  };
}

let geometryPromise;
export function loadNativeOverlay() {
  if (!geometryPromise)
    geometryPromise = fetchGeometry().catch((error) => {
      geometryPromise = null;
      throw error;
    });
  return geometryPromise;
}
async function fetchGeometry() {
  const m = await index(),
    count = m.stats.supplemental_source_addressable;
  const data = {
    index: m,
    count,
    id: new Uint32Array(count),
    x: new Float64Array(count),
    y: new Float64Array(count),
    primary: new Int32Array(count),
    topic: new Uint16Array(count),
    method: new Uint8Array(count),
    mask: new Uint8Array(count),
    termMask: new Uint8Array(count),
    valueMask: new Uint8Array(count),
    unplaced: new Uint8Array(count),
  };
  let offset = 0;
  for (const [path, n] of m.pointFiles) {
    const buffer = await bytes(BASE + path),
      v = new DataView(buffer);
    if (buffer.byteLength !== n * m.pointBytes)
      throw Error("Incomplete native point shard");
    for (let j = 0; j < n; j++) {
      const i = offset + j,
        o = j * m.pointBytes;
      data.id[i] = v.getUint32(o, true);
      data.x[i] = v.getFloat32(o + 4, true);
      data.y[i] = v.getFloat32(o + 8, true);
      data.primary[i] = v.getInt32(o + 12, true);
      data.topic[i] = v.getUint16(o + 16, true);
      data.method[i] = v.getUint8(o + 18);
      data.mask[i] = v.getUint8(o + 19);
      data.termMask[i] = v.getUint8(o + 20);
      data.valueMask[i] = v.getUint8(o + 21);
    }
    offset += n;
  }
  if (offset !== count) throw Error("Incomplete native overlay");
  const meta = await json(refinement + "index.json");
  let j = 0;
  await refinedPoints("native-points.bin.gz", meta.oldNativeUnplaced, (id, x, y, topic, method) => {
    while (j < count && data.id[j] < id) j++;
    if (data.id[j] !== id || Number.isFinite(data.x[j])) throw Error("Invalid refined native identity");
    data.x[j] = x; data.y[j] = y; data.topic[j] = topic;
    data.method[j] = m.methods.length + method;
    data.unplaced[j] = Number(m.topics[topic].id === "unresolved");
  });
  return data;
}

const sessions = new WeakMap();
export async function openNative(container, context = {}) {
  const generation = (sessions.get(container) || 0) + 1;
  sessions.set(container, generation);
  const fresh = () =>
    sessions.get(container) === generation &&
    (!context.isCurrent || context.isCurrent());
  let localGeneration = 0;
  const m = await index();
  if (!fresh()) return;
  const set = (...children) => {
    if (fresh()) container.replaceChildren(...children);
  };
  const navigate = (id) => {
    if (context.native) context.native(id);
    else openNative(container, { ...context, id });
  };
  const moduleView = async (i, offset = 0) => {
    const stamp = ++localGeneration;
    const [name, first, count, exported, allExported] = await directoryModule(
        i,
        m,
      ),
      items = [];
    const size = 40;
    for (let j = offset; j < Math.min(offset + size, count); j++) {
      const id = first + j,
        part = await json(
          BASE + "records/" + Math.floor(id / m.recordStride) + ".json.gz",
        );
      items.push(
        action(part[id % m.recordStride][1], () => navigate(id), "listItem"),
      );
    }
    if (stamp !== localGeneration || !fresh()) return;
    const controls = node("div", undefined, "actions");
    if (offset)
      controls.append(
        action("Previous", () => moduleView(i, Math.max(0, offset - size))),
      );
    if (offset + size < count)
      controls.append(action("Next", () => moduleView(i, offset + size)));
    set(
      action("Native theorem directory", () => navigate(undefined)),
      node("p", "Original physical module", "small"),
      node("h2", name, "bigcode"),
      node(
        "p",
        amount(count) +
          " theorem-kind declarations · " +
          amount(exported) +
          " with an exact checked export entry.",
        "small",
      ),
      node(
        "p",
        allExported
          ? amount(allExported) +
              " physical constants of all kinds have a unique Main export match."
          : "No physical constant in this module has a unique Main export match.",
        "small",
      ),
      link("Open original Lean module", sourceUrl(m.sourceBase, name, [])),
      ...items,
      controls,
    );
  };
  if (context.id !== undefined && context.id !== null) {
    const r = await nativeDetail(Number(context.id));
    if (!fresh()) return;
    const box = node("div");
    box.append(
      action("Native theorem directory", () => navigate(undefined)),
      node("p", "Native Lean declaration · " + amount(r.id), "small"),
      node("h2", r.kernel, "bigcode"),
      node("p", r.origin.replaceAll("-", " "), "meta"),
      node("h3", "Original source"),
      node("p", r.module, "small"),
      node("p", showSource[r.sourceBasis] || r.sourceBasis, "note"),
    );
    if (r.anchor.length)
      box.append(
        node(
          "p",
          "Line " +
            r.anchor[0] +
            ", column " +
            r.anchor[1] +
            (r.anchor.length === 4
              ? " · end " +
                r.anchor[2] +
                ", column " +
                r.anchor[3] +
                " (exclusive)"
              : ""),
          "small",
        ),
      );
    if (r.owner)
      box.append(node("p", "Enclosing kernel name · " + r.owner, "small"));
    if (r.writtenBasis === 2)
      box.append(
        node(
          "p",
          "Explicit command identified by its module, selected name position and written basename.",
          "small",
        ),
      );
    const links = node("div", undefined, "actions");
    links.append(
      link(
        r.anchor.length ? "Open pinned source location" : "Open pinned module",
        r.source,
      ),
    );
    if (r.commandSource && r.commandSource !== r.source)
      links.append(link("Full registered command", r.commandSource));
    if (r.written !== null && context.primary)
      links.append(
        action("Inspect written theorem", () => context.primary(r.written)),
      );
    if (r.ownerId !== null && r.ownerId !== r.id)
      links.append(action("Inspect native owner", () => navigate(r.ownerId)));
    box.append(links, node("h3", "Checked export"));
    if (r.kernelId !== null) {
      box.append(
        node(
          "p",
          "Export name ID " +
            r.kernelId +
            " · " +
            (r.mask === 0
              ? "outside the five endpoint closures"
              : endpointNames.filter((_, i) => r.mask & (1 << i)).join(" · ")),
          "small",
        ),
      );
    } else
      box.append(
        node(
          "p",
          r.mask === null
            ? "Multiple physical modules use this kernel name. Export identity is unresolved."
            : "The physical theorem has no declaration entry in the supplied Main export.",
          "small",
        ),
      );
    box.append(
      node(
        "p",
        r.mainImported
          ? "Its module is in the original Main source import closure."
          : "Its module is outside the original Main source import closure.",
        "small",
      ),
      node("h3", "Map placement"),
      node("p", methodText[r.placement] || methodLabel[r.placement] || r.placement, "small"),
    );
    if (r.hasPlacement) {
      box.append(node("p", r.topic.label + " · " + r.topic.category, "small"));
      if (context.locate)
        box.append(action("Center on native point", () => context.locate(r)));
    } else if (
      context.locate &&
      r.written === null &&
      (r.selection.length || r.owner)
    ) {
      box.append(
        action("Show in source-section index", () => context.locate(r)),
      );
    }
    if (r.terms.length) box.append(node("p", r.terms.join(" · "), "small"));
    if (r.primary !== null && r.primary !== r.written && context.primary)
      box.append(
        action("Inspect source theorem for this placement", () =>
          context.primary(r.primary),
        ),
      );
    box.append(
      action("Browse this physical module", () => moduleView(r.moduleId)),
    );
    set(box);
    return;
  }
  const q = node("input");
  q.type = "search";
  q.className = "bundleSearch";
  q.placeholder = "Qualified or final name prefix";
  q.setAttribute("aria-label", "Native search");
  q.value = context.initialQuery || "";
  const mode = node("select");
  mode.setAttribute("aria-label", "Search field");
  for (const [v, label] of [
    ["name", "Native theorem name"],
    ["module", "Physical module name"],
  ]) {
    const option = node("option", label);
    option.value = v;
    mode.append(option);
  }
  const output = node("div"),
    form = node("div", undefined, "section");
  form.append(mode, q);
  set(
    node("p", "Original compiled objects", "small"),
    node("h2", "Native theorem directory"),
    node(
      "p",
      amount(m.count) +
        " theorem-kind declarations in " +
        amount(m.moduleCount) +
        " physical original modules.",
      "small",
    ),
    form,
    output,
  );
  async function update(offset = 0) {
    const stamp = ++localGeneration,
      query = q.value.trim();
    if (!query) {
      output.replaceChildren(
        node("p", "Search by the beginning of a full or final name.", "small"),
      );
      return;
    }
    output.replaceChildren(node("p", "Searching…", "small"));
    try {
      const result = await searchNative(query, {
        mode: mode.value,
        offset,
        limit: 30,
      });
      if (!fresh() || stamp !== localGeneration) return;
      const controls = node("div", undefined, "actions");
      if (offset)
        controls.append(
          action("Previous", () => update(Math.max(0, offset - 30))),
        );
      if (result.hasMore)
        controls.append(action("Next", () => update(offset + 30)));
      const items = result.results.map((r) =>
        action(
          r.name,
          () => (mode.value === "module" ? moduleView(r.id) : navigate(r.id)),
          "listItem",
        ),
      );
      output.replaceChildren(
        node(
          "p",
          items.length
            ? "Results " +
                amount(offset + 1) +
                "–" +
                amount(offset + items.length)
            : "No matching prefix.",
          "small",
        ),
        ...items,
        controls,
      );
    } catch (error) {
      if (fresh() && stamp === localGeneration)
        output.replaceChildren(node("p", error.message, "note"));
    }
  }
  let timer;
  q.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => update(0), 120);
  });
  mode.addEventListener("change", () => update(0));
  await update(0);
}
