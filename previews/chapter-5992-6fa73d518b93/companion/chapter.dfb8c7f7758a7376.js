import { observeProofPane } from "./pane.8c50cd6a36c98048.js";
// The reader controls the copied formal-companion page through its own accessible controls.
// Its PDF verification, PDF.js rendering, geometry, proof cards and numbered source all run upstream.
const $ = id => document.getElementById(id);
const frame = $("viewer");
const setPaneStep = observeProofPane(frame);
const items = new Map();
const destinations = new Map();
const declarations = new Map();
const regions = new Map();
const bySource = new Map();
const proofCache = new Map();
let inventory, active, pending, frameDoc, watcher, scheduled, turn = 0, driving = false, nativeIntent;

function link(label, href) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = label;
  return a;
}
function fragment(item, proof, step, page, cite) {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries({item, proof, step, page, cite})) {
    if (value) p.set(key, value);
  }
  return p.size ? "#" + p : "index.html";
}
function options(select, pairs) {
  select.replaceChildren(...pairs.map(([id, label]) => new Option(label, id)));
}
function notify(message) {
  $("notice").textContent = message || "";
  $("notice").hidden = !message;
}
function flatten(rows) {
  return rows.flatMap(row => [row, ...flatten(row.children)]);
}
async function proofOf(decl) {
  if (!proofCache.has(decl.id)) {
    proofCache.set(decl.id, fetch("../" + decl.proof).then(response => {
      if (!response.ok) throw Error("The structured proof could not be loaded.");
      return response.json();
    }).then(proof => {
      if (proof.id !== decl.id) throw Error("The proof link names a different declaration.");
      return flatten(proof.steps);
    }).catch(error => { proofCache.delete(decl.id); throw error; }));
  }
  return proofCache.get(decl.id);
}
function noticeForSelection(item, decl) {
  const checked = decl?.proof ? decl.checked : inventory.checked;
  const count = decl?.proof ? decl.steps : inventory.steps;
  const scope = decl?.proof ? "this proof" : "this chapter";
  $("standing").textContent = "Each English step quotes its Lean lines. The Lean text is the authority. " +
    "A second reader compared " + checked + " of " + count + " steps in " + scope + " with the source.";
  const href = decl?.proof ? "../" + fragment(null, decl.id, active.step?.id) : null;
  $("structured").hidden = !href;
  if (href) {
    $("structured").href = href;
    $("structured").textContent = active.step ? "Open step in structured proof" : "Open structured proof";
  }
  const named = active.heading;
  $("heading").hidden = !item && !named;
  if (named) {
    $("heading").textContent = "Open cited declarations on p. " + named.page;
    $("heading").href = fragment(named.id);
  } else if (item) {
    $("heading").textContent = "Read heading on p. " + item.headingPage +
      (item.headingPage === active.page ? "" : " · citation on p. " + active.page);
    const params = new URLSearchParams({page: item.headingPage, heading: item.id});
    if (!item.printedHeading) params.set("dest", item.dest);
    $("heading").href = "#" + params;
  }
}
function trail() {
  const {item, decl, step} = active;
  const chapter = "../#chapter=1.5992";
  const anchors = [
    link("What is proved", "../#statement"), link("Classical Riemann hypothesis", "../#statement=main-rh"),
    link("The cohomological window", "../#component=cohomology"), link("Chapter 1.5992", chapter), link("Note", "index.html"),
  ];
  if (active.heading) anchors.push(link(active.heading.title + " · heading", location.hash));
  if (item) anchors.push(link(item.title, fragment(item.id)));
  if (decl) anchors.push(link(decl.name, fragment(item.id, decl.id)));
  if (step) anchors.push(link(step.number, fragment(item.id, decl.id, step.id)));
  anchors.at(-1).setAttribute("aria-current", "page");
  $("trail").replaceChildren(...anchors);
  const up = step ? [fragment(item.id, decl.id), "declaration"] : decl ? [fragment(item.id), "passage"]
    : active.heading ? [fragment(active.heading.id), "passage"] : item ? ["index.html", "note"] : [chapter, "chapter"];
  $("up").href = up[0];
  $("up").textContent = "↑ Up to " + up[1];
}
async function show({drive = true} = {}) {
  const ticket = ++turn;
  pending = null;
  nativeIntent = null;
  const p = new URLSearchParams(location.hash.slice(1));
  let item = items.get(p.get("item")), decl = declarations.get(p.get("proof"));
  const stepId = p.get("step");
  const heading = p.has("heading") ? items.get(p.get("heading")) : destinations.get(p.get("dest"));
  if (!p.has("item") && decl) item = decl.item;
  try {
    if ((p.has("heading") || p.has("dest")) &&
        (!heading || (p.has("dest") && p.get("dest") !== heading.dest) || item || decl || stepId)) {
      throw Error("Unknown or incompatible PDF destination.");
    }
    if (p.has("item") && !item) throw Error("Unknown note item “" + p.get("item") + "”. Choose a passage below.");
    if (p.has("proof") && (!decl || decl.item !== item)) throw Error("This declaration does not belong to the selected item.");
    if (stepId && !decl?.proof) throw Error("This address names a step without a published proof.");
    const steps = decl?.proof ? await proofOf(decl) : [];
    if (ticket !== turn) return;
    const step = steps.find(s => s.id === stepId);
    if (stepId && !step) throw Error("Unknown proof step “" + stepId + "” in " + decl.name + ".");
    const selected = decl || item;
    const page = p.has("page") ? Number(p.get("page")) : selected?.page || heading?.headingPage || 1;
    let region = selected?.region;
    const pages = inventory.pages ?? 21; // The first released locations file predates the page-count field.
    if (!Number.isInteger(page) || page < 1 || page > pages) throw Error("This edition has pages 1 through " + pages + ".");
    if (heading && page !== heading.headingPage) throw Error("This PDF destination is on page " + heading.headingPage + ".");
    if (p.has("cite")) {
      const cited = regions.get(p.get("cite"));
      if (!item || cited?.decl.item !== item || cited.page !== page || (decl && cited.decl !== decl)) {
        throw Error("The requested citation does not occur at this position in the note.");
      }
      region = p.get("cite");
    } else if (selected && page !== selected.page) {
      throw Error("The requested page does not contain this item's selected citation.");
    }
    notify("");
    active = {item, decl, step, page, region, heading};
    setPaneStep(decl?.id, step, steps);
    $("item").value = item?.id || "";
    $("decl-field").hidden = !item;
    $("step-field").hidden = !steps.length;
    options($("decl"), [["", "All declarations"], ...(item?.declarations || []).map(d => [d.id, d.name])]);
    $("decl").value = decl?.id || "";
    options($("step"), [["", "Complete proof"], ...steps.map(s => [s.id, s.number + " · " + s.claim])]);
    $("step").value = stepId || "";
    trail();
    noticeForSelection(item, decl);
    if (drive) {
      pending = {...active};
      if (!frame.hasAttribute("src")) {
        frame.src = "pdf-overlay/viewer/index.html#page=" + page;
      } else schedule();
    }
  } catch (error) {
    if (ticket !== turn) return;
    active = {page: 1};
    $("item").value = "";
    $("decl-field").hidden = $("step-field").hidden = $("structured").hidden = $("heading").hidden = true;
    trail();
    noticeForSelection();
    notify(error.message);
    if (!frame.hasAttribute("src")) frame.src = "pdf-overlay/viewer/index.html#page=1";
  }
}
// User actions in the note carry their real occurrence back into the address bar.
function fromViewer() {
  const intent = nativeIntent;
  if (!intent || !active) return;
  const doc = frameDoc;
  const selected = !doc.getElementById("selection").hidden;
  const readingPage = doc.getElementById("index-heading").textContent.match(/^Page (\d+)$/);
  const page = !selected && readingPage ? Number(readingPage[1]) : Number(doc.getElementById("page-number").value);
  const polygon = doc.querySelector("#overlay [aria-pressed=true]");
  const region = polygon?.dataset.regionId;
  const cited = regions.get(region);
  const choice = doc.querySelector("#item-choices [aria-pressed=true]")?.dataset.itemId || intent.id;
  let item, decl, step;
  if (selected && choice?.includes("#")) {
    const cut = choice.lastIndexOf("#");
    decl = declarations.get(choice.slice(0, cut));
    step = choice.slice(cut + 1);
    item = decl?.item;
  } else if (selected && cited) {
    item = cited.decl.item;
    if (intent.citation) decl = cited.decl;
  } else if (selected) return;
  const selectedTarget = decl || item;
  const repeat = selectedTarget && region && selectedTarget.region !== region;
  const next = fragment(item?.id, decl?.id, step, repeat || !item ? page : null, repeat ? region : null);
  nativeIntent = null;
  if (location.hash !== next && next !== "index.html") {
    history.pushState(null, "", next);
    show({drive: false});
  }
}
function linkDeclarations(doc) {
  // The runtime already separates physical lines. Its normal cards omit the gutter that its step cards use.
  for (const card of doc.querySelectorAll("#key-list .key-card")) {
    const source = card.querySelector("a.source-link");
    const decl = bySource.get(source?.href);
    if (decl?.proof && !card.querySelector(".atlas-reading")) {
      const proof = doc.createElement("a");
      proof.className = "atlas-reading";
      proof.href = new URL("../" + fragment(null, decl.id), document.baseURI).href;
      proof.target = "_top";
      proof.textContent = "Structured proof";
      proof.setAttribute("aria-label", "Open structured proof of " + decl.name);
      source.after(proof);
    }
    const code = card.querySelector("pre.lean:not(.is-numbered)");
    const pins = card.querySelector("a.source-link")?.hash.match(/^#L(\d+)-L(\d+)$/);
    if (!code || !pins) continue;
    const rows = code.querySelectorAll(":scope > .ln");
    if (rows.length !== Number(pins[2]) - Number(pins[1]) + 1) continue;
    rows.forEach((line, n) => { line.dataset.line = String(Number(pins[1]) + n); });
    code.classList.add("is-numbered");
    code.setAttribute("aria-label", "Lines " + pins[1] + "–" + pins[2]);
  }
}

function driveViewer() {
  if (!frameDoc?.getElementById("workspace")) return;
  const doc = frameDoc;
  if (!doc.getElementById("error").hidden || doc.getElementById("toggle-reading").disabled) return;
  linkDeclarations(doc);
  if (!pending) { fromViewer(); return; }
  const desired = pending;
  const pageInput = doc.getElementById("page-number");
  driving = true;
  try {
    if (Number(pageInput.value) !== desired.page) {
      pageInput.value = desired.page;
      pageInput.dispatchEvent(new frame.contentWindow.Event("change", {bubbles: true}));
      return;
    }
    if (!desired.item) {
      if (!doc.getElementById("selection").hidden) doc.getElementById("back-to-page").click();
      if (desired.heading) {
        if (frame.contentWindow.location.hash !== "#page=" + desired.page) return;
        const scroll = doc.getElementById("page-scroller");
        const canvas = doc.getElementById("pdf-canvas").getBoundingClientRect();
        const view = scroll.getBoundingClientRect();
        const [px,py] = desired.heading.headingPoint;
        const q = Number(doc.getElementById("text-layer").dataset.mainRotation || 0);
        const [x,y] = ({0:[px,py],90:[1-py,px],180:[1-px,1-py],270:[py,1-px]})[q] || [px,py];
        scroll.scrollTo({left:scroll.scrollLeft+canvas.left-view.left+x*canvas.width-20,
                         top:scroll.scrollTop+canvas.top-view.top+y*canvas.height-15});
      }
      pending = null;
      return;
    }
    const polygon = [...doc.querySelectorAll("#overlay [data-region-id]")].find(el => el.dataset.regionId === desired.region);
    if (!polygon) return;
    polygon.dispatchEvent(new frame.contentWindow.MouseEvent("click", {bubbles: true}));
    if (desired.step) {
      const stepKey = desired.decl.id + "#" + desired.step.id;
      const row = [...doc.querySelectorAll("#step-list button")].find(el => el.dataset.itemId === stepKey);
      if (!row) throw Error("The selected Literature Links step could not be opened.");
      row.click();
    } else if (desired.decl) {
      const source = [...doc.querySelectorAll("#key-list .key-card, #related-list li")].find(card =>
        card.querySelector("[title]")?.title === desired.decl.canonicalName ||
        card.querySelector("a")?.hash === "#L"+desired.decl.lines[0]+"-L"+desired.decl.lines[1] &&
        card.querySelector("a")?.href.includes("/"+desired.decl.id.split(":")[0].replaceAll(".", "/")+".lean"));
      source?.scrollIntoView({block:"nearest"});
    }
    linkDeclarations(doc);
    pending = null;
  } catch (error) { pending = null; notify(error.message); }
  finally { driving = false; }
}
function schedule() {
  if (scheduled) return;
  scheduled = requestAnimationFrame(() => { scheduled = 0; driveViewer(); });
}
frame.addEventListener("load", () => {
  watcher?.disconnect();
  frameDoc = frame.contentDocument;
  if (!frameDoc?.getElementById("workspace")) return;
  watcher = new MutationObserver(schedule);
  watcher.observe(frameDoc.body, {subtree: true, childList: true, attributes: true,
    attributeFilter: ["hidden", "aria-pressed", "disabled"]});
  frameDoc.addEventListener("click", event => {
    const control = event.target.closest?.("a,button,polygon");
    if (!control || driving) return;
    // The upstream renderer gives the PDF's hyperlinks priority over annotations. An ordinary
    // click on a mapped source link opens that occurrence in the companion. Read PDF mode and
    // modified clicks keep the PDF's own link behavior. The source link stays on the Lean card.
    const mapped = control.matches("#pdf-links a") && bySource.get(control.href);
    if (mapped && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0 &&
        frameDoc.getElementById("toggle-reading").getAttribute("aria-expanded") === "true") {
      const page = Number(frameDoc.getElementById("page-number").value);
      const ids = new Set(mapped.occurrences.filter(([p])=>p === page).map(([,id])=>id));
      const box = control.getBoundingClientRect();
      const distance = node => {
        const r = node.getBoundingClientRect();
        return Math.abs(r.left-box.left) + Math.abs(r.top-box.top) + Math.abs(r.right-box.right) + Math.abs(r.bottom-box.bottom);
      };
      const polygon = [...frameDoc.querySelectorAll("#overlay [data-region-id]")].filter(n=>ids.has(n.dataset.regionId))
        .sort((a,b)=>distance(a)-distance(b))[0];
      if (polygon) {
        event.preventDefault();
        event.stopPropagation();
        polygon.dispatchEvent(new frame.contentWindow.MouseEvent("click", {bubbles:true}));
        return;
      }
    }
    if (control.matches("a") && control.href?.startsWith("https://") && new URL(control.href).origin !== location.origin) {
      control.target = "_blank";
      control.rel = "noopener noreferrer";
    }
    if (control.matches("polygon,.index-row,.step-row,.item-choice,#step-parent,#next-item,#previous-item," +
                        "#back-to-page,#previous-page,#next-page,#pdf-links a[href^='#'],#page-jump button")) {
      nativeIntent = {id:control.dataset.itemId, citation:control.tagName.toLowerCase() === "polygon"};
      schedule();
    }
  }, true);
  frameDoc.addEventListener("change", event => {
    if (!driving && event.target.id === "page-number") { nativeIntent = {}; schedule(); }
  }, true);
  frameDoc.addEventListener("keydown", event => {
    if (driving || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.matches?.("polygon") && ["Enter"," "].includes(event.key)) nativeIntent = {citation:true};
    else if (["ArrowLeft","ArrowRight","Escape"].includes(event.key) && !event.target.matches?.("input,select")) nativeIntent = {};
    if (nativeIntent) schedule();
  }, true);
  schedule();
});
$("item").addEventListener("change", () => navigate(fragment($("item").value)));
$("decl").addEventListener("change", () => navigate(fragment(active.item.id, $("decl").value)));
$("step").addEventListener("change", () => navigate(fragment(active.item.id, active.decl.id, $("step").value)));
function navigate(url) {
  history.pushState(null, "", url);
  show();
}
window.addEventListener("hashchange", () => { if (inventory) show(); });
try {
  const response = await fetch("locations.json");
  if (!response.ok) throw Error("The note index could not be loaded.");
  inventory = await response.json();
  for (const item of inventory.items) {
    items.set(item.id, item);
    if (!item.printedHeading) destinations.set(item.dest, item);
    for (const decl of item.declarations) {
      decl.item = item;
      declarations.set(decl.id, decl);
      bySource.set(decl.source, decl);
      for (const [page, region] of decl.occurrences) regions.set(region, {decl, page});
    }
  }
  options($("item"), [["", "Complete note"], ...inventory.items.map(i => [i.id, i.title + " · p. " + i.headingPage])]);
  await show();
} catch (error) { notify(error.message); }
