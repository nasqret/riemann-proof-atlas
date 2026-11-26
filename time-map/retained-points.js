// Draw surviving written commands at their stored Original Atlas coordinates.
import {PointTree} from "../point-tree.js";
import {snapshotAtlasPresence, snapshotPresence} from "../june-map/snapshot-records.js";

const base = "40e56bab026552e089d7afcfeff08d2defb9c005";
let currentMap, active, hits = [];

export function setOriginalPointMap(map) {
  if (map === currentMap) return;
  currentMap = map;
  active = null;
  hits = [];
}

async function build(state, map) {
  const [nativeMask, writtenMask] = await Promise.all([
    snapshotAtlasPresence(state.pin), snapshotPresence(state.pin), map.contextLayer?.load(),
  ]);
  if (state !== active) return;
  const cat = map.cat, context = map.contextLayer;
  if (nativeMask.length !== cat.x.length || cat.index.sourcePin !== base) throw Error("Incompatible original theorem positions.");
  const native = new PointTree(cat.x, cat.y, i => nativeMask[i] === 1 && !cat.unplaced[i]);
  let contextual;
  if (context?.row) {
    // The contextual register also covers original theorem rows without paper evidence.
    // An already plotted native theorem must appear only once.
    const survives = i => writtenMask[context.row[i]] === 1 &&
      (context.theorem[i] < 0 || cat.unplaced[context.theorem[i]] === 1);
    contextual = new PointTree(context.x, context.y, survives);
  }
  Object.assign(state, {native, contextual, context, nativeMask, writtenMask, ready: true});
  map.view.dataset.retainedRows = String(native.ids.length + (contextual?.ids.length ?? 0));
  map.drawSoon();
}

function start(map, pin) {
  const state = {pin, ready: false};
  active = state;
  hits = [];
  map.view.dataset.retainedPin = pin;
  map.view.dataset.retainedRows = "0";
  map.view.dataset.retainedMarks = "0";
  state.pending = build(state, map).catch(error => {
    if (active === state) {
      state.error = error;
      map.warn?.("Could not load original declaration positions. " + error.message);
    }
  });
  return state;
}

function drawTree(map, tree, context) {
  if (!tree?.root) return;
  const c = map.cat, ctx = map.ctx;
  const coarse = map.zoom < 8;
  tree.visible(map.box(), map.unit, context ? (coarse ? 37 : 18) : (coarse ? 25 : 12), (cell, members) => {
    const id = cell.anchor, n = members.length, sx = map.px(tree.x[id]), sy = map.py(tree.y[id]);
    if (sx < -12 || sy < -12 || sx > map.width + 12 || sy > map.height + 12) return;
    const radius = n === 1 ? (context ? 3.6 : 3.3) : Math.min(10,4 + Math.log2(n)*0.49);
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, 2 * Math.PI);
    const bundle = context ? null : c.bundles[c.bundle[id]];
    if (context) {
      ctx.strokeStyle = context.supported[id] ? "#ffd485" : "#a9e2d4";
      ctx.lineWidth = 1.7;
      ctx.stroke();
    } else {
      ctx.fillStyle = c.categories.get(bundle.category)?.color || "#a0a6ab";
      ctx.fill();
      ctx.strokeStyle = "#e4ece4";
      ctx.lineWidth = coarse ? 1.2 : 0.75;
      ctx.stroke();
    }
    if (n > 1) {
      ctx.beginPath();
      ctx.arc(sx, sy, 1.4, 0, 2*Math.PI);
      ctx.fillStyle = context ? "#b8c9bc" : "#20302c";
      ctx.fill();
    }
    hits.push({kind:context ? "written" : "theorem", id:context ? context.row[id] : id,
               count:n, sx, sy, rad:radius, label:n === 1 ? "Written declaration" : n.toLocaleString("en-US")+" written declarations"});
  });
}

export function drawOriginalSnapshot(map, pin) {
  setOriginalPointMap(map);
  hits = [];
  if (!pin || pin === base || !map.cat || !map.show.lean || map.unplaced) return;
  const state = active?.pin === pin ? active : start(map, pin);
  if (!state.ready) return;
  map.ctx.save();
  drawTree(map, state.native, null);
  if (map.contextLayer?.enabled !== false) drawTree(map, state.contextual, state.context);
  map.ctx.restore();
  map.view.dataset.retainedMarks = String(hits.length);
}

export function hitOriginalSnapshot(x, y) {
  if (!active?.ready || active.pin !== new URL(location.href).searchParams.get("snapshot") || !currentMap?.show.lean) return null;
  let best = null, bestDistance = Infinity;
  for (const point of hits) {
    const distance = Math.hypot(point.sx-x, point.sy-y);
    if (distance < Math.max(7, point.rad+3) && distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

export async function originalWrittenPosition(writtenId, atlasId) {
  const map = currentMap, pin = new URL(location.href).searchParams.get("snapshot");
  if (!map?.cat || !pin || pin === base) return null;
  const state = active?.pin === pin ? active : start(map,pin);
  await state.pending;
  if (state !== active || !state.ready || state.writtenMask[writtenId] !== 1) return null;
  if (Number.isInteger(atlasId) && atlasId >= 0 && state.nativeMask[atlasId] && !map.cat.unplaced[atlasId]) {
    return {x:map.cat.x[atlasId], y:map.cat.y[atlasId]};
  }
  const context = state.context;
  if (!context) return null;
  let lo=0, hi=context.row.length;
  while (lo<hi) {
    const mid=(lo+hi)>>>1;
    if (context.row[mid]<writtenId) lo=mid+1; else hi=mid;
  }
  return context.row[lo]===writtenId ? {x:context.x[lo],y:context.y[lo]} : null;
}
