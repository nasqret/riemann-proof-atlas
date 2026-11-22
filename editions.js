import { Catalog, bytes, fmt, json, merc } from "./data.js";
import { AtlasMap } from "./map.js";

const $ = id => document.getElementById(id);
const directory = "data/editions/";
const original = new Catalog();
const states = ["Unchanged module", "Edited module", "Unmatched original", "Unmatched snapshot", "Moved by name"];
const roles = { submission: "Submission", merged: "Merged upstream", proposal: "Proposal at capture" };
const normalize = text => text.normalize("NFKC").toLowerCase();
const readings = new Map([[580898,"reflection"],[708576,"minor"],[446888,"frobenius"],
  [423096,"descent"],[388602,"integrals"],[424699,"landau"]]);
let registry, current, loadTicket = 0, panelTicket = 0, worker, searchTimer;

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function link(text, href) { const a = el("a", text); a.href = href; return a; }
function button(text, action, cls) {
  const b = el("button", text, cls); b.type = "button"; b.onclick = action; return b;
}
function github() { return "https://github.com/" + registry.repository; }
function source(pin, path, line) {
  return github() + "/blob/" + pin + "/src/" + path.split("/").map(encodeURIComponent).join("/") + "#L" + line;
}
function issue(error) { $("matches").textContent = error.message || String(error); }

class EditionMap extends AtlasMap {
  placementPass(row) {
    const status = row < this.states.length ? this.states[row] : 3;
    return this.mode === "present" ? status !== 2 : status === Number(this.mode);
  }
}
const map = new EditionMap(hit => pick(hit).catch(issue), issue);
map.show.relations = false;

function coordinate(key) {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return (h >>> 0) / 4294967296 - .5;
}
function geometry(added, files) {
  if (!added.length) return original;
  const offset = original.index.count, count = offset + added.length;
  const enlarged = data => { const a = new data.constructor(count); a.set(data); return a; };
  const cat = {index:{...original.index,count}, categories:original.categories, bundles:original.bundles.slice(),
    x:enlarged(original.x), y:enlarged(original.y), bundle:enlarged(original.bundle),
    unplaced:enlarged(original.unplaced), mask:original.mask};
  const groups = new Map();
  for (const [i, [name, file, line]] of added.entries()) {
    const path = files[file], section = path.split("/").slice(0,-1).slice(0,3).join("/") || "Top level";
    if (!groups.has(section)) {
      groups.set(section, cat.bundles.length);
      cat.bundles.push({label:section.split("/").at(-1), category:"unresolved", topic:"unresolved"});
    }
    const key = path + ":" + line + ":" + name, row = offset + i;
    cat.bundle[row] = groups.get(section); cat.unplaced[row] = 1;
    cat.x[row] = coordinate(section + "/x") * 17 + coordinate(key + "/x") * .85;
    cat.y[row] = coordinate("y/" + section) * 17 + coordinate("y/" + key) * .85;
  }
  return cat;
}
async function loadEdition(card) {
  const root = directory + card.commit + "/";
  const [raw, locations] = await Promise.all([bytes(root+"states.bin.gz"), bytes(root+"locations.json.gz")]);
  const loc = JSON.parse(new TextDecoder().decode(locations));
  const flags = new Uint8Array(raw), n = original.index.count;
  if (flags.length !== n || loc.added.length !== card.states[3] || n - card.states[2] + loc.added.length !== card.written)
    throw Error("Snapshot row counts disagree with its catalogue.");
  // Most revisions shift very few line numbers. Only consolidated trees need a dense lookup.
  const offsets = loc.positions.length > 50000 ? new Int32Array(n) : new Map();
  loc.positions.forEach(([row], index) => {
    if (offsets instanceof Map) offsets.set(row,index+1); else offsets[row]=index+1;
  });
  return {card, flags, loc, offsets, cat:geometry(loc.added,loc.files)};
}
async function record(row) {
  const view = current, offset = original.index.count;
  if (row >= offset) {
    const [name,file,line] = view.loc.added[row-offset];
    return {name,path:view.loc.files[file],line,status:3};
  }
  const stride = original.index.recordStride;
  const r = (await json(original.base+"records/"+Math.floor(row/stride)+".json.gz"))[row%stride];
  const pos = view.offsets instanceof Map ? view.offsets.get(row) : view.offsets[row];
  const shifted = pos && view.loc.positions[pos-1];
  return {name:r.name, old:r, path:shifted ? view.loc.files[shifted[1]] : r.file,
    line:shifted ? shifted[2] : r.line, status:view.flags[row]};
}
function navigate(fields, replace=false) {
  const h = new URLSearchParams(location.hash.slice(1));
  for (const [k,v] of Object.entries(fields)) {
    if (v === null || v === "") h.delete(k); else h.set(k,v);
  }
  const hash = "#" + h;
  if (location.hash !== hash) history[replace ? "replaceState" : "pushState"](null,"",hash);
  return restore().catch(issue);
}
function moveTo(row) { return navigate({row, q:null}); }
function info(card) {
  const panel = $("editionInfo"), numbers = el("div",undefined,"numbers");
  for (const [v,label] of [[card.written,"theorems & lemmas"],[card.sourceFiles,"Lean modules"],[card.lines,"source lines"]]) {
    const n=el("div"); n.append(el("strong",fmt(v)),el("small",label)); numbers.append(n);
  }
  const links=el("div",undefined,"sources");
  links.append(link(card.commit.slice(0,9),github()+"/tree/"+card.commit+"/src"));
  if(card.pr) links.append(link("Pull request #"+card.pr,github()+"/pull/"+card.pr));
  panel.replaceChildren(el("p",roles[card.status]+" · "+card.date,"date"),el("h2",card.title),
    el("p",card.description),numbers,links);
}
async function showRow(row) {
  const ticket = ++panelTicket, view=current, r=await record(row);
  if (ticket!==panelTicket || view!==current) return;
  map.gotoPoint(row);
  const status=states[r.status], pane=$("selection"), links=el("div",undefined,"sources");
  if(r.status!==2) links.append(link("Lean at this snapshot",source(view.card.commit,r.path,r.line)));
  if(r.old && (view.card.commit!==registry.baseline || r.status===2))
    links.append(link("Submitted Lean",source(registry.baseline,r.old.file,r.old.line)));
  if(r.old) links.append(link("Original atlas point","./#theorem="+row));
  if(readings.has(row)) links.append(link("Read structured proof","structured.html#"+readings.get(row)));
  pane.replaceChildren(el("h3",r.name),el("p",status+" · "+r.path+" · line "+r.line,"meta"),links);
  if(r.status===2) pane.append(el("p","This occurrence has no reliable name match in the selected revision. The source link opens its submitted location."));
}
async function listRows(rows,offset=0) {
  const ticket=++panelTicket, view=current, end=Math.min(offset+12,rows.length);
  const subset=Array.from(rows.slice(offset,end));
  const records=await Promise.all(subset.map(record));
  if(ticket!==panelTicket || view!==current) return;
  const pane=$("selection"), list=el("div"), nav=el("div",undefined,"pages");
  for(const [i,r] of records.entries()) list.append(button(r.name,()=>moveTo(subset[i]),"result"));
  if(offset) nav.append(button("Previous",()=>listRows(rows,offset-12).catch(issue),"jump"));
  if(end<rows.length) nav.append(button("Next",()=>listRows(rows,end).catch(issue),"jump"));
  pane.replaceChildren(el("h3",rows.length ? fmt(offset+1)+"–"+fmt(end)+" of "+fmt(rows.length) : "No matches"),list,nav);
}
async function pick(h) {
  if(!current || $("revision").disabled) return;
  if(h.type==="label" || h.type==="paper") {
    panelTicket++; const item=h.type==="label" ? h.l : null;
    if(item) map.go(item.x,merc(item.y),Math.max(map.zoom,8));
    $("selection").replaceChildren(el("h3",item ? item.label : "arXiv paper"),
      link("Read in the original atlas",item ? "./#label="+encodeURIComponent(item.id) : "./#paper="+h.row)); return;
  }
  const rows=h.rows || h.ids;
  if(rows.length===1) return moveTo(rows[0]);
  $("lookup").value=""; map.frame(rows); return listRows(rows);
}
function search(q) {
  const term=q.trim();
  if(!term || !current) return;
  if(!worker) {
    worker=new Worker("search.js",{type:"module"}); worker.onerror=()=>issue(Error("Search could not load."));
    worker.onmessage=({data})=>{
      if(!current || data.q!==$("lookup").value.trim()) return;
      if(data.error) {issue(Error(data.error));return;}
      const ids=Array.from(data.results.filter(i=>map.pass(i)));
      const tokens=normalize(data.q).split(/\s+/);
      current.loc.added.forEach(([name],i)=>{
        const row=original.index.count+i;
        if(map.pass(row) && tokens.every(t=>normalize(name).includes(t))) ids.push(row);
      });
      $("matches").textContent=fmt(ids.length)+" matching names in this filter.";
      listRows(ids).catch(issue);
    };
  }
  $("matches").textContent="Searching names in this snapshot…"; worker.postMessage({q:term});
}
function preview() {
  const ids=current.card.examples, box=el("div");
  for (const [s,title] of [[1,"edited file"],[4,"moved declaration"],[2,"unmatched original"],[3,"unmatched snapshot"]]) {
    if(ids[s]?.length) box.append(button((s===4?"Inspect a ":"Inspect an ")+title,()=>navigate({change:s,subject:null,row:ids[s][0],q:null}),"result"));
  }
  if($("subject").value!=="unresolved") box.append(button("Browse the source-section index",()=>navigate({subject:"unresolved",row:null,q:null}),"result"));
  box.append(link("Read a structured proof","structured.html#reflection"));
  $("selection").replaceChildren(el("h3","Explore this edition"),box);
}
async function restore() {
  if(!registry) return;
  const ticket=++loadTicket, h=new URLSearchParams(location.hash.slice(1));
  const card=registry.editions.find(e=>e.commit===h.get("rev") || e.id===h.get("rev")) || registry.editions.find(e=>e.commit===registry.latest);
  if(current?.card!==card) {
    $("matches").textContent="Opening "+card.title+"…"; $("selection").replaceChildren();
    const next=await loadEdition(card); if(ticket!==loadTicket) return;
    current=next; info(card);
  }
  panelTicket++;
  let mode=h.get("change") || "present", subject=h.get("subject") || "";
  if(!Array.from($("change").options).some(o=>o.value===mode)) mode="present";
  if(!original.categories.has(subject)) subject="";
  if(mode==="3") subject="unresolved";
  let row=h.has("row") && /^\d+$/.test(h.get("row")) ? Number(h.get("row")) : null;
  if(row!==null && row>=current.cat.index.count) row=null;
  const previousMode=map.mode;
  map.states=current.flags; map.mode=mode;
  if(row!==null) {
    const st=row>=original.index.count?3:current.flags[row];
    if(!map.placementPass(row)) map.mode=mode=String(st);
    if(subject && current.cat.bundles[current.cat.bundle[row]].category!==subject) subject="";
  }
  $("revision").value=card.commit; $("change").value=mode; $("subject").value=subject;
  $("lookup").value=h.get("q") || "";
  map.selected=null;
  if(map.cat!==current.cat || map.activeRevision!==card.commit || previousMode!==mode || map.subject!==subject) {
    map.countKey=null;map.treeKey=null;map.cat=current.cat;map.activeRevision=card.commit;
    map.setFilters("all",subject);
  }
  map.drawSoon();
  $("matches").textContent=fmt(map.matched)+" declarations match the selected filters.";
  if(row!==null) await showRow(row);
  else if($("lookup").value) search($("lookup").value);
  else { preview(); if(mode!=="present" || subject) {
    const examples=current.card.examples[mode] || [];
    const candidates=examples.filter(i=>map.pass(i));
    if(candidates.length && mode!=="0") map.frame(candidates,18);
  } }
  document.body.dataset.ready="true";
}
$("revision").onchange=e=>navigate({rev:e.target.value, row:null, q:null,change:null,subject:null});
$("change").onchange=e=>navigate({change:e.target.value,subject:e.target.value==="3"?"unresolved":null,row:null,q:null});
$("subject").onchange=e=>navigate({subject:e.target.value,change:$("change").value==="3"&&e.target.value!=="unresolved"?"present":$("change").value,row:null,q:null});
$("lookup").oninput=()=>{clearTimeout(searchTimer);panelTicket++;searchTimer=setTimeout(()=>navigate({q:$("lookup").value.trim(),row:null},true),220);};
$("zoomIn").onclick=()=>map.zoomAt(1.75,map.width/2,map.height/2);
$("zoomOut").onclick=()=>map.zoomAt(1/1.75,map.width/2,map.height/2);
$("fit").onclick=()=>map.fit();
window.addEventListener("popstate",()=>restore().catch(issue));
(async()=>{
  const [data]=await Promise.all([json(directory+"index.json"),original.load(),map.baseLoad()]);
  registry=data; const choices=$("revision");
  choices.replaceChildren();
  for(const [status,title] of [["submission","Submission"],["merged","Merged changes"],["proposal","Pinned proposals"]]) {
    const group=el("optgroup");group.label=title;
    for(const e of data.editions.filter(e=>e.status===status)) group.append(new Option((e.pr?"#"+e.pr+" · ":"")+e.title,e.commit));
    choices.append(group);
  }
  for(const c of original.index.categories.filter(c=>original.index.categoryCounts[c.id])) $("subject").append(new Option(c.label,c.id));
  for(const p of data.otherProposals) {
    const li=el("li");li.append(link("#"+p.pr+" "+p.title,github()+"/pull/"+p.pr)," · "+p.status);$("proposalList").append(li);
  }
  for(const id of ["revision","change","subject","lookup"]) $(id).disabled=false;
  await restore();
})().catch(e=>{issue(e);$("editionInfo").replaceChildren(el("h2","Edition data unavailable"),button("Retry",()=>location.reload(),"jump"));});
