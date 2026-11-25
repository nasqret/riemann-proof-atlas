const countFormat = new Intl.NumberFormat("en-US");
const validColor = value => /^#[0-9a-f]{6}$/i.test(value || "");
const liveLegends = new WeakMap();
let loadedLegend;

function mapKey(legend, math) {
  if (typeof document === "undefined" || !legend?.colors) return;
  const kind = math && legend.schemaVersion === 2 ? "mathCount" : "count";
  const colors = legend.colors.filter(row => row.key && row[kind] > 0 && validColor(row.color))
    .sort((a, b) => b[kind] - a[kind]).slice(0, 5);
  if (!colors.length) return;
  const stops = colors.map((row, i) => row.color + " " + (100 * i / colors.length) + "% " + (100 * (i + 1) / colors.length) + "%");
  document.documentElement.style.setProperty("--june-topic-key", "linear-gradient(90deg, " + stops.join(", ") + ")");
}

if (typeof document !== "undefined") {
  document.addEventListener("june-palette-lens", () => {
    mapKey(loadedLegend, document.getElementById("show-math")?.checked);
    for (const panel of document.querySelectorAll(".topic-palette[open]")) liveLegends.get(panel)?.();
  });
}

export function indexPalette(legend) {
  if (!legend?.colors?.length) return null;
  loadedLegend = legend;
  mapKey(legend, false);
  const rich = legend.schemaVersion === 2;
  const levels = (rich ? legend.priorityLevels : [legend.level]).map(level => ({level, entries: []}));
  for (const entry of legend.colors) {
    if (!entry.key || !validColor(entry.color)) continue;
    const table = levels.find(group => group.level === (rich ? entry.level : legend.level));
    if (table) table.entries[rich ? entry.regionCode : entry.code] = rich ? entry : {...entry, level: legend.level};
  }
  const unlabelled = legend.colors.find(entry => entry.code === (rich ? legend.unlabelledCode : 0));
  return {
    levels,
    unlabelled: rich || !unlabelled ? unlabelled : {...unlabelled, label: "Unlabelled at level " + legend.level},
    other: rich ? legend.colors.find(entry => entry.code === legend.otherNamedCode) : null,
  };
}

export function paperPaletteTopic(palette, paper) {
  if (!palette || !paper?.levels) return null;
  for (const {level, entries} of palette.levels) {
    const topic = entries[paper.levels[level]];
    if (topic) return topic;
  }
  return palette.other && paper.levels.some(code => code !== 0) ? palette.other : palette.unlabelled;
}

export function drawPalettePapers(map, mathPaper) {
  if (!map.topicPalette) return false;
  const radius = Math.min(3, 1.35 + Math.log2(map.zoom / map.pointZoom + 1) * .4);
  const paths = new Map();
  for (const paper of map.visiblePapers) {
    if (map.layers.math && !mathPaper(paper)) continue;
    const [x, y] = map.screen(paper.x, paper.y);
    if (x < -3 || x > map.width + 3 || y < -3 || y > map.height + 3) continue;
    const color = paperPaletteTopic(map.topicPalette, paper)?.color || "#dceadf";
    if (!paths.has(color)) paths.set(color, new Path2D());
    const path = paths.get(color);
    path.moveTo(x + radius, y);
    path.arc(x, y, radius, 0, Math.PI * 2);
  }
  for (const [color, path] of paths) {
    map.ctx.fillStyle = color;
    map.ctx.fill(path);
  }
  return true;
}

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

export function renderPaletteLegend(legend, isMath, selectRegion) {
  const panel = node("details", undefined, "inspector-note topic-palette");
  const summary = node("summary", "Paper colors and counts");
  const preview = node("i", undefined, "topic-palette-key");
  preview.setAttribute("aria-hidden", "true");
  summary.append(preview);
  const body = node("div", undefined, "topic-palette-body");
  panel.append(summary, body);
  const rich = legend.schemaVersion === 2;
  const paint = () => {
    const math = isMath() && rich;
    const field = math ? "mathCount" : "count";
    const total = legend.colors.reduce((sum, entry) => sum + entry[field], 0);
    body.replaceChildren(node("p", countFormat.format(total) + (math ? " confirmed mathematics paper rows" : " paper rows across the full June map"), "palette-total"));
    body.append(node("p", rich
      ? "Each paper takes the first matching topic from levels 6, 7 and 8, in that order. Each pixel shows its most frequent color and mixes ties. Brighter pixels contain more papers."
      : "Paper colors follow the broadest topic level in the June source."));
    if (rich) body.append(node("p", "Counts give the rows drawn in each color. Topic links open the complete June region."));
    const sections = rich ? [
      [6, "Level 6 · selected regions"], [7, "Level 7 · broader regions"],
      [8, "Level 8 · broadest regions"], [null, "Other assignments"],
    ] : [[legend.level, "Level " + legend.level]];
    for (const [level, title] of sections) {
      const entries = legend.colors.filter(entry => !rich || entry.level === level);
      entries.sort((a, b) => b[field] - a[field] || a.label.localeCompare(b.label));
      if (!entries.length) continue;
      const list = node("ul", undefined, "palette-rows");
      body.append(node("h3", title), list);
      for (const entry of entries) {
        const li = node("li");
        const row = node(entry.key ? "a" : "span", undefined, "palette-row");
        const swatch = node("i", undefined, "palette-swatch");
        swatch.setAttribute("aria-hidden", "true");
        if (validColor(entry.color)) swatch.style.backgroundColor = entry.color;
        const label = !rich && !entry.key ? "Unlabelled at level " + level : entry.label;
        const count = countFormat.format(entry[field]);
        row.append(swatch, node("span", label), document.createTextNode(" "), node("span", count, "palette-count"));
        if (entry.key) {
          row.href = "#region=" + encodeURIComponent(entry.key);
          row.setAttribute("aria-label", label + ", " + count + (math ? " confirmed mathematics paper rows" : " paper rows"));
          row.addEventListener("click", event => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault();
            selectRegion(entry.key);
          });
        }
        li.append(row);
        list.append(li);
      }
    }
    if (rich) body.append(node("p", "Other named topics have a source assignment outside the color key. The unlabelled group has no name at any of the nine levels."));
  };
  liveLegends.set(panel, paint);
  panel.addEventListener("toggle", () => { if (panel.open) paint(); });
  return panel;
}
