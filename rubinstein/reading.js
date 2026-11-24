import { ReadingMap } from "./path-map.js?v=1ef9e74caf809c67";
import { Paper } from "./paper.js?v=f44dd8e8329de811";

const $ = (id) => document.getElementById(id);
const option = (text, value) => new Option(text, value);
const warning = (message) => {
  $("error").textContent = message;
  $("error").hidden = false;
};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const relationLabels = { uses: "Uses", "used-by": "Used by", both: "References both ways" };
const routeLabels = { reference: "Lean reference", file: "same file", unit: "same proof unit", directory: "source directory" };
const point = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const atlasID = (i) => Number.isSafeInteger(i) && i >= 0;

async function readContext() {
  const res = await fetch(new URL("../data/context/paper.json", import.meta.url));
  if (!res.ok) throw Error("Context placements are unavailable.");
  return res.json();
}

function contextMatches(context, path) {
  if (context?.schema !== 1 || context.sourcePin !== path.sourcePin ||
      !context.declarations || !context.neighbors) return false;
  for (const [id, decl] of Object.entries(path.declarations)) {
    const c = Object.hasOwn(context.declarations, id) ? context.declarations[id] : null;
    if (decl.point ? c != null : !(c && point(c.point) && atlasID(c.anchor) &&
        atlasID(c.row) && Object.hasOwn(routeLabels, c.route) && typeof c.anchorName === "string" &&
        typeof c.topic === "string" && typeof c.supported === "boolean")) return false;
    if (c?.route === "reference" && !Object.hasOwn(relationLabels, c.relation)) return false;
    const list = context.neighbors[id];
    if (!list || !atlasID(list.total) || !Array.isArray(list.edges) || list.edges.length > list.total ||
        !list.edges.every((e) => atlasID(e.atlas) && point(e.point) && Object.hasOwn(relationLabels, e.direction))) return false;
    const other = c?.paperNeighbor;
    if (other && (!Number.isInteger(other.page) || path.declarations[other.name]?.atlas !== other.atlas ||
        !path.pages[other.page - 1]?.some((s) => s.id === other.name) ||
        !path.pages[other.page - 1]?.some((s) => s.id === id))) return false;
  }
  return true;
}

async function start() {
  const [response, candidate] = await Promise.all([
    fetch(new URL("./path.json?v=a58f0bb48749a893", import.meta.url)),
    readContext().catch(() => null),
  ]);
  if (!response.ok) throw Error("The page concordance could not be loaded.");
  const data = await response.json();
  const context = contextMatches(candidate, data) ? candidate : null;
  document.body.dataset.contextReady = String(Boolean(context));
  const all = [];
  const pages = data.pages.map((entries, i) =>
    entries.map((entry) => {
      const decl = data.declarations[entry.id];
      const placement = context?.declarations[entry.id] ?? null;
      const stop = {
        ...entry,
        page: i + 1,
        index: all.length,
        decl,
        context: placement,
        position: decl.point ?? placement?.point ?? null,
        neighbors: context?.neighbors[entry.id] ?? null,
      };
      all.push(stop);
      return stop;
    }),
  );
  const pageCount = pages.length;
  let page,
    selected,
    occurrence = 0,
    whole = false;
  const map = new ReadingMap((s) => move(s.page, s), warning);
  const paper = new Paper(data, (s, i) => move(s.page, s, i));
  const counts = data.counts;
  $("coverage").textContent =
    `This edition has ${counts.stops} stops on ${counts.citedPages} of ${counts.pages} pages. Among the ${counts.declarations} cited declarations, ${counts.positioned} have a published atlas position. ` +
    (context ? `The other ${counts.declarations - counts.positioned} have a contextual marker.` : "Context placements are unavailable for this edition.");
  $("pageNo").max = String(pageCount);
  $("pageCount").textContent = "/ " + pageCount;
  const timeline = $("timeline");
  timeline.setAttribute("role", "slider");
  timeline.tabIndex = 0;
  timeline.setAttribute("aria-label", "Page in the exposition");
  timeline.setAttribute("aria-valuemin", "1");
  timeline.setAttribute("aria-valuemax", String(pageCount));
  for (const [i, stops] of pages.entries()) {
    const tick = document.createElement("span");
    tick.setAttribute("aria-hidden", "true");
    tick.title = `Page ${i + 1} · ${stops.length} citations`;
    if (stops.length) tick.className = "cited";
    timeline.append(tick);
  }
  for (const part of data.parts) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.page = String(part.page);
    b.textContent = part.title;
    $("parts").append(b);
  }

  function move(
    newPage,
    stop = undefined,
    box = 0,
    push = true,
    showWhole = whole,
  ) {
    const p = clamp(
      Number.isSafeInteger(newPage) ? newPage : all[0].page,
      1,
      pageCount,
    );
    const stops = pages[p - 1];
    const next = stop && stops.includes(stop) ? stop : stops[0] || null;
    const nextBox = next
      ? clamp(Number.isSafeInteger(box) ? box : 0, 0, next.boxes.length - 1)
      : 0;
    const params = new URLSearchParams({ page: String(p) });
    if (next) params.set("cite", next.id);
    if (nextBox) params.set("occ", String(nextBox + 1));
    if (showWhole) params.set("trail", "all");
    const hash = "#" + params;
    if (location.hash !== hash)
      history[push ? "pushState" : "replaceState"](null, "", hash);
    if (
      page === p &&
      selected === next &&
      occurrence === nextBox &&
      whole === showWhole
    )
      return;
    const changedPage = page !== p,
      changedWhole = whole !== showWhole;
    if (page) timeline.children[page - 1].classList.remove("selected");
    page = p;
    selected = next;
    occurrence = nextBox;
    whole = showWhole;
    $("whole").checked = whole;
    map.whole = whole;
    map.selectPassage(page, stops, selected);
    if (changedWhole) map.fitPassage();
    paper.show(page, stops, selected, occurrence);
    $("pageNo").value = String(page);
    $("pageNo").disabled = false;
    $("pagePrev").disabled = page === 1;
    $("pageNext").disabled = page === pageCount;
    timeline.children[page - 1].classList.add("selected");
    timeline.setAttribute("aria-valuenow", String(p));
    timeline.setAttribute("aria-valuetext", "Page " + p);
    $("pageStatus").textContent =
      `Page ${page} of ${pageCount} · ${stops.length} ${stops.length === 1 ? "citation" : "citations"}`;
    $("mobilePrev").disabled = $("previous").disabled = !adjacent(-1);
    $("mobileNext").disabled = $("next").disabled = !adjacent(1);
    $("stopStatus").textContent = selected
      ? `Stop ${selected.index + 1} of ${all.length} · Page ${page}`
      : `Page ${page} · No matched citation`;
    if (changedPage) {
      $("citations").replaceChildren(
        ...(stops.length
          ? stops.map((s, i) => option(`${i + 1}. ${s.id}`, s.id))
          : [option("No matched Lean name on this page", "")]),
      );
    }
    $("citations").disabled = !stops.length;
    $("citations").value = selected?.id || "";
    $("leanSource").hidden = !selected;
    $("explore").hidden = !selected?.context && selected?.decl.atlas == null;
    $("focus").hidden = !selected?.position;
    $("placementEvidence").hidden = !selected?.context;
    $("mapPlacement").hidden = !selected || Boolean(selected.decl.point);
    if (selected) {
      const d = selected.decl;
      $("citationTitle").textContent = selected.id;
      $("citationTitle").title = d.name;
      const kindLabel =
        { def: "Definition", structure: "Structure", instance: "Instance" }[
          d.kind
        ] || d.kind[0].toUpperCase() + d.kind.slice(1);
      const c = selected.context;
      if (c) {
        $("mapPlacement").textContent = "Placed by context · " + routeLabels[c.route];
        $("placement").textContent = c.supported
          ? `${kindLabel} · Suggested topic · ${c.topic}. The Lean references and the surrounding file or proof unit agree.`
          : `${kindLabel} · Topic pending. The mapped neighbor lies in “${c.topic}”.`;
        const reference = { uses: "This declaration uses", "used-by": "This declaration is used by", both: "Lean references run in both directions between this declaration and" };
        const source = { file: "It shares its Lean file with", unit: "It shares its proof unit with", directory: "A mapped declaration in the same source directory is" };
        $("evidenceLead").textContent = c.route === "reference" ? reference[c.relation] : source[c.route];
        $("anchorLink").textContent = c.anchorName;
        $("anchorLink").href = "index.html#theorem=" + c.anchor;
        $("paperEvidence").hidden = !c.paperNeighbor;
        if (c.paperNeighbor) {
          const { page: otherPage, name } = c.paperNeighbor;
          $("paperNeighbor").textContent = `page ${otherPage} · ${name}`;
          $("paperNeighbor").href = "#" + new URLSearchParams({ page: String(otherPage), cite: name });
        } else $("paperNeighbor").removeAttribute("href");
      } else {
        $("anchorLink").removeAttribute("href");
        $("paperNeighbor").removeAttribute("href");
        $("mapPlacement").textContent = d.atlas != null ? "Source-section index" : "Lean source only";
        $("placement").textContent = d.point ? d.subject + " · Published atlas position"
          : d.atlas != null ? "This theorem is in the source-section index. Its arXiv-map position is unknown."
          : kindLabel + " · Source range verified.";
      }
      $("leanSource").href =
        data.sourceBase +
        d.file.split("/").map(encodeURIComponent).join("/") +
        `#L${d.lines[0]}-L${d.lines[1]}`;
      $("leanSource").textContent =
        `Lean ${d.lines[0] === d.lines[1] ? "line " + d.lines[0] : "lines " + d.lines[0] + "–" + d.lines[1]}`;
      $("explore").textContent = c ? "Inspect contextual placement" : "Inspect in Explorer";
      if (c) $("explore").href = "index.html#context=" + c.row;
      else if (d.atlas != null) $("explore").href = "index.html#theorem=" + d.atlas;
      else $("explore").removeAttribute("href");
      $("context").hidden = !d.components?.length;
      $("contextText").textContent = (d.components || [])
        .map((id) => data.components[id])
        .join(" · ");
    } else {
      $("citationTitle").textContent = "Read this page in the write-up";
      $("placement").textContent =
        "This page has no entry in the verified citation index. Continue by page or skip to a cited stop.";
      $("context").hidden = true;
      $("leanSource").removeAttribute("href");
      $("explore").removeAttribute("href");
      $("anchorLink").removeAttribute("href");
      $("paperNeighbor").removeAttribute("href");
    }
    renderReferences();
  }

  function renderReferences() {
    const info = selected?.neighbors;
    const active = Boolean(info && map.dependencies);
    $("dependencies").disabled = !info;
    $("dependencies").checked = active;
    $("referenceDetails").hidden = !active;
    $("fit").setAttribute("aria-label", active && info.edges.length && !whole
      ? "Fit this stop and its Lean references" : "Fit path in map");
    $("neighborList").open = false;
    $("neighborLinks").replaceChildren();
    if (!active) return;
    const count = info.edges.length;
    $("referenceStatus").textContent = !count
      ? "This stop has no recorded direct Lean reference with a mapped endpoint."
      : `Showing ${count === info.total ? count : `${count} of ${info.total}`} mapped ${info.total === 1 ? "theorem" : "theorems"} linked by type or proof. Arrows point from a declaration to the theorem it uses.`;
    $("edgeKey").hidden = $("neighborList").hidden = !count;
    for (const edge of info.edges) {
      const entry = document.createElement("li"), link = document.createElement("a");
      entry.append(relationLabels[edge.direction] + " ");
      link.href = "index.html#theorem=" + edge.atlas;
      link.textContent = edge.name || `Atlas theorem ${edge.atlas}`;
      entry.append(link);
      $("neighborLinks").append(entry);
    }
  }

  function adjacent(direction) {
    if (selected) return all[selected.index + direction];
    return direction > 0
      ? all.find((s) => s.page > page)
      : all.findLast((s) => s.page < page);
  }
  function step(direction) {
    const s = adjacent(direction);
    if (s) move(s.page, s);
  }
  function restore() {
    const params = new URLSearchParams(location.hash.slice(1)),
      raw = params.get("page");
    const n =
      raw && /^\d+$/.test(raw) ? clamp(Number(raw), 1, pageCount) : all[0].page;
    const target = pages[n - 1].find((s) => s.id === params.get("cite"));
    move(
      n,
      target,
      Number(params.get("occ") || 1) - 1,
      false,
      params.get("trail") === "all",
    );
  }

  $("previous").onclick = () => step(-1);
  $("next").onclick = () => step(1);
  $("mobilePrev").onclick = () => step(-1);
  $("mobileNext").onclick = () => step(1);
  $("whole").onchange = (e) =>
    move(page, selected, occurrence, true, e.target.checked);
  $("dependencies").onchange = (e) => {
    map.dependencies = e.target.checked;
    map.fitPassage();
    renderReferences();
  };
  $("background").onchange = async (e) => {
    const control = e.target;
    if (control.checked && !map.cat) {
      control.disabled = true;
      try {
        const { Catalog } = await import("../data.js");
        const catalog = new Catalog();
        await catalog.load();
        map.setCatalog(catalog);
      } catch (err) {
        control.checked = false;
        warning(err.message);
      } finally {
        control.disabled = false;
      }
    }
    map.show.lean = control.checked;
    map.drawSoon();
  };
  $("citations").onchange = (e) =>
    move(
      page,
      pages[page - 1].find((s) => s.id === e.target.value),
    );
  $("pagePrev").onclick = () => move(page - 1);
  $("pageNext").onclick = () => move(page + 1);
  function goToInput() {
    const n = $("pageNo").valueAsNumber;
    if (Number.isInteger(n) && n !== page) move(n);
    $("pageNo").value = String(page);
  }
  $("pageNo").onchange = goToInput;
  $("pageNo").onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      goToInput();
    }
  };
  document.querySelector(".part-nav").onclick = (e) => {
    const b = e.target.closest("button[data-page]");
    if (b) move(Number(b.dataset.page));
  };
  timeline.onclick = (e) => {
    const r = timeline.getBoundingClientRect();
    move(1 + Math.floor(((e.clientX - r.left) * pageCount) / r.width));
  };
  timeline.onkeydown = (e) => {
    const pagesByKey = {
      ArrowLeft: page - 1,
      ArrowRight: page + 1,
      Home: 1,
      End: pageCount,
      PageDown: page + 10,
      PageUp: page - 10,
    };
    if (e.key in pagesByKey) {
      e.preventDefault();
      move(pagesByKey[e.key]);
    }
  };
  for (const [id, factor] of [
    ["zoomIn", 1.7],
    ["zoomOut", 1 / 1.7],
  ])
    $(id).onclick = () => map.zoomAt(factor, map.width / 2, map.height / 2);
  $("fit").onclick = () => map.fitPassage();
  $("focus").onclick = () => map.focusStop();
  for (const [link, pane] of [
    ["jumpMap", "map-pane"],
    ["jumpPaper", "paper-pane"],
  ])
    $(link).onclick = (e) => {
      e.preventDefault();
      $(pane).scrollIntoView();
    };
  window.addEventListener("hashchange", restore);
  map.setRoute(all);
  restore();
  const base = map
    .baseLoad()
    .then(() => {
      map.fitPassage();
      document.body.dataset.mapReady = "true";
    })
    .catch((err) => warning(err.message));
  await Promise.all([base, paper.init()]);
}
start().catch((e) => warning(e.message));
