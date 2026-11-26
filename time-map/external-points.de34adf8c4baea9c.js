// One spatial index per selected source edition. Coordinates are display offsets around its paper anchors.
import { PointTree } from "../point-tree.js";
import { externalEdition, snapshotSelector } from "./edition-address.js?atlas=de34adf8c4baea9c";

let plotted = null;
let hits = [];

function hasNativePosition(map, record) {
  if (record.baseId == null) return false;
  if (record.atlas != null && !map.cat.unplaced[record.atlas]) return true;
  const rows = map.contextLayer?.row;
  if (!rows) return false;
  let start = 0,
    end = rows.length;
  while (start < end) {
    const middle = (start + end) >>> 1;
    if (rows[middle] < record.baseId) start = middle + 1;
    else end = middle;
  }
  return rows[start] === record.baseId;
}

async function load(state, map) {
  const api = await import("../june-map/external-records.js?atlas=de34adf8c4baea9c");
  const [records] = await Promise.all([
    api.externalMapPoints(state.pin),
    state.geometry === "original" ? map.contextLayer?.load() : null,
  ]);
  if (plotted !== state) return;
  const x = new Float64Array(records.length),
    y = new Float64Array(records.length);
  records.forEach((record, i) => {
    [x[i], y[i]] = record[state.geometry];
  });
  state.records = records;
  state.tree = new PointTree(
    x,
    y,
    (i) => state.geometry !== "original" || !hasNativePosition(map, records[i]),
  );
  state.view.dataset.externalRows = String(state.tree.ids.length);
  map.drawSoon();
}

export function drawExternalPoints(map, pin, geometry) {
  const june = geometry === "june",
    view = june ? map.el : map.view;
  hits = [];
  if (!externalEdition(pin) || !(june ? map.layers.lean : map.show.lean)) {
    plotted = null;
    delete view.dataset.externalPin;
    delete view.dataset.externalRows;
    delete view.dataset.externalMarks;
    return;
  }
  if (!june && !map.cat) return;
  if (plotted?.pin !== pin || plotted.geometry !== geometry) {
    const state = { pin, geometry, view };
    plotted = state;
    view.dataset.externalPin = pin;
    view.dataset.externalRows = "0";
    view.dataset.externalMarks = "0";
    load(state, map).catch((error) => {
      if (plotted === state)
        document.getElementById("time-announce").textContent =
          "Edition positions unavailable. " + error.message;
    });
  }
  if (!plotted.tree) return;
  const { records, tree } = plotted;
  const unit = june ? map.scale : map.unit,
    bounds = june ? map.worldBox() : map.box();
  const ctx = map.ctx;
  ctx.save();
  tree.visible(bounds, unit, map.zoom < 6 ? 22 : 11, (cell, members) => {
    const record = records[cell.anchor],
      world = record[geometry];
    const [sx, sy] = june ? map.screen(...world) : [map.px(world[0]), map.py(world[1])];
    if (sx < -10 || sy < -10 || sx > map.width + 10 || sy > map.height + 10) return;
    const count = members.length,
      radius = count === 1 ? 3.5 : Math.min(8.5, 3.9 + Math.log2(count) * 0.42);
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fillStyle = count === 1 ? "#82d4be" : "#236758";
    ctx.fill();
    ctx.strokeStyle = count === 1 ? "#163a35" : "#c4ede1";
    ctx.lineWidth = 1.1;
    ctx.stroke();
    hits.push({
      kind: "external-written",
      id: record.id,
      count,
      sx,
      sy,
      radius,
      world,
      pin,
      marker: record.marker,
      members,
      records,
    });
  });
  ctx.restore();
  view.dataset.externalMarks = String(hits.length);
}

export function hitExternalPoint(x, y, nearest = false) {
  if (!plotted || snapshotSelector(new URLSearchParams(location.search)) !== plotted.pin) return null;
  let best = null,
    distance = Infinity;
  for (const hit of hits) {
    const d = Math.hypot(hit.sx - x, hit.sy - y);
    if ((nearest || d < hit.radius + 2.5) && d < distance) {
      best = hit;
      distance = d;
    }
  }
  return best;
}
