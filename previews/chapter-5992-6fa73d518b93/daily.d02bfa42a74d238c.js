import { dailyFeed, localFeed, dailyAsset, ledger, mapLink, sourceFile } from "./daily-feed.201fa1b3808d2f40.js";

const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString("en-US");
const signed = n => n > 0 ? "+"+fmt(n) : n < 0 ? "−"+fmt(-n) : "0";
const dateLabel = (d,options={month:"short",day:"numeric"}) => new Intl.DateTimeFormat("en-GB",{...options,timeZone:"UTC"}).format(new Date(d+"T00:00:00Z"));
let feed, generation=0;
function node(tag,value,cls) {
  const n=document.createElement(tag);
  if (value !== undefined) n.textContent=value;
  if (cls) n.className=cls;
  return n;
}
function link(label,href,cls) { const a=node("a",label,cls); a.href=href; return a; }
function btn(label,fn,cls) { const b=node("button",label,cls); b.type="button"; b.onclick=fn; return b; }
function section(parent) { const s=node("section",undefined,"section"); parent.append(s); return s; }
function nav(params) { location.hash=new URLSearchParams(params).toString(); }
function options(items,value,action,label) {
  const n=node("select",undefined,"choice");n.setAttribute("aria-label",label);
  for (const [v,text] of items) n.add(new Option(text,v));
  n.value=value; n.onchange=()=>action(n.value); return n;
}
function cards(parent,values) {
  const block=node("div",undefined,"cards");
  for(const [value,label,sub] of values) {
    const c=node("div");c.append(node("strong",value),node("span",label));
    if(sub) c.append(node("small",sub)); block.append(c);
  }
  parent.append(block);
}
function gh() { return "https://github.com/"+feed.data.repository; }
function tree(pin) { return gh()+"/tree/"+pin+"/src"; }
function compare(left,right) { return gh()+"/compare/"+left+"..."+right; }
function tableBrowser(parent,rows,{status=true}={}) {
  const filters=node("div",undefined,"filters"), input=node("input",undefined,"search");
  input.type="search"; input.placeholder="Search module paths";input.setAttribute("aria-label","Search module paths");
  let term="", kind="all", page=0;
  const filter=options([["all","All changes"],["removed","Removed modules"],["edited","Edited modules"],["added","Added modules"]],
    kind,v=>{kind=v;page=0;paint();},"Filter module changes");
  const report=node("p",undefined,"meta"), table=node("table",undefined,"table");
  const header=table.createTHead().insertRow();
  for(const text of ["Module","Lines","Lean source"]) {const th=node("th",text);th.scope="col";header.append(th);}
  const body=table.createTBody(), pages=node("div",undefined,"pages");
  filters.append(input); if(status) filters.append(filter);
  parent.append(filters,report,table,pages);
  function paint() {
    const found=rows.filter(r=>(kind==="all" || kind===r.kind) && (!term || r.path.toLowerCase().includes(term)));
    const offset=page*12;
    report.textContent=found.length ? fmt(found.length)+" matching modules · "+fmt(offset+1)+"–"+fmt(Math.min(offset+12,found.length)) : "No matching modules.";
    body.replaceChildren();
    for(const r of found.slice(offset,offset+12)) {
      const tr=body.insertRow(), name=tr.insertCell(), num=tr.insertCell(), refs=tr.insertCell();
      name.append(node("span",r.path,"path"),node("small",r.kind));num.className="number";
      num.append(node("span",signed(r.ins-r.del)),node("small","+"+fmt(r.ins)+" / −"+fmt(r.del)));
      if(r.before) refs.append(link("Before",r.before)); if(r.after) refs.append(link("After",r.after));
    }
    const prev=btn("Previous",()=>{page--;paint();}), next=btn("Next",()=>{page++;paint();});
    prev.disabled=page===0;next.disabled=offset+12>=found.length;pages.replaceChildren();
    if(found.length>12) pages.append(prev,next);
  }
  input.oninput=()=>{term=input.value.trim().toLowerCase();page=0;paint();};
  paint();
}
function timeline(parent,days,day,metric,track="official") {
  const s=section(parent), head=node("div",undefined,"heading");
  const available=days.slice().reverse().map(d=>[d.day,dateLabel(d.day,{dateStyle:"long"})+(d.closed===false?" · open":"")]);
  const choose=d=>nav({track,day:d});
  head.append(node("h2",track==="official"?"Official source history":"Source mirror history"),options(available,day.day,choose,"Snapshot date in UTC"));
  s.append(head);
  if(!metric) return;
  const strip=node("div",undefined,"timeline");strip.setAttribute("aria-label","Written theorem and lemma counts by day");
  const selected=days.findIndex(d=>d.day===day.day), end=Math.max(0,Math.min(days.length-30,selected-15));
  const windowDays=days.slice(end,end+30), max=Math.max(...windowDays.map(metric));
  for(const d of windowDays) {
    const dayBtn=btn("",()=>choose(d.day),"day");
    dayBtn.setAttribute("aria-label",d.day+" · "+fmt(metric(d))+" theorems and lemmas");
    dayBtn.title=dayBtn.getAttribute("aria-label");
    if(d.day===day.day) dayBtn.setAttribute("aria-current","date");
    const bar=node("strong");bar.style.height=Math.max(1,47*metric(d)/Math.max(1,max))+"px";
    dayBtn.append(bar,node("span",dateLabel(d.day)));strip.append(dayBtn);
  }
  s.append(strip);
}
function pairOverview(parent,label,after,before,key) {
  const s=section(parent), c=feed.data.comparisons[key];
  s.append(node("h2",label));
  cards(s,[[fmt(after.written),"Theorems & lemmas",signed(after.written-before.written)+" net"],
    [fmt(after.sourceFiles),"Lean modules",signed(after.sourceFiles-before.sourceFiles)+" net"],
    [fmt(after.lines),"Lean source lines",signed(after.lines-before.lines)+" net"]]);
  s.append(node("p",fmt(c.removed)+" removed occurrences · "+fmt(c.added)+" additions · "+fmt(c.moved)+" matched moves."));
  if(c.ambiguousRemoved || c.ambiguousAdded) s.append(node("p",fmt(c.ambiguousRemoved)+" before and "+fmt(c.ambiguousAdded)+" after occurrences have ambiguous names.","meta"));
  const actions=node("div",undefined,"actions");
  actions.append(link("Open snapshot map",mapLink({pin:after.commit}),"action primary"));
  for(const [layer,title] of [["removed","Map removals"],["added","Map additions"],["moved","Map relocations"]])
    if(c[layer]) actions.append(link(title,mapLink({pair:key,layer}),"action"));
  s.append(actions);
  const refs=node("p",undefined,"links");
  refs.append(link("Before · "+before.commit.slice(0,9),tree(before.commit)),link("After · "+after.commit.slice(0,9),tree(after.commit)),link("Git comparison",compare(before.commit,after.commit)));
  s.append(refs);
}
async function modules(parent,key,ticket) {
  const m=feed.data.comparisons[key],s=section(parent);
  s.append(node("h2","Changed modules"),node("p",fmt(m.filesRemoved)+" removed · "+fmt(m.filesEdited)+" edited · "+fmt(m.filesAdded)+" added · "+fmt(m.insertedLines)+" lines inserted · "+fmt(m.deletedLines)+" deleted.","meta"));
  if(!(m.filesRemoved+m.filesEdited+m.filesAdded)) return;
  const data=await ledger(feed,key);
  if(ticket!==generation) return;
  const repo=feed.data.repository;
  const rows=data.files.map(([path,kind,ins,del])=>({path,kind,ins,del,
    before:kind!=="added" && sourceFile(repo,data.before,path),after:kind!=="removed" && sourceFile(repo,data.after,path)}));
  rows.sort((a,b)=>(b.del-b.ins)-(a.del-a.ins)||a.path.localeCompare(b.path));
  tableBrowser(s,rows);
}
async function official(parent,h,ticket) {
  const m=feed.data, day=h.has("day")?m.days.find(d=>d.day===h.get("day")):m.days.at(-1);
  if(!day) throw Error("The selected official date is unavailable in this capture.");
  timeline(parent,m.days,day,d=>m.editions[d.pin].written);
  const text=day.closed?"Closed at midnight UTC":"Open day · captured "+m.capturedAt.replace("T"," ").replace("Z"," UTC");
  parent.append(node("span",text,"tag"));
  pairOverview(parent,dateLabel(day.day,{dateStyle:"long"}),m.editions[day.pin],m.editions[day.before],day.comparison);
  if(day.changes.length) {
    const s=section(parent),ls=node("ul",undefined,"compact");
    for(const e of day.changes) {
      const li=node("li");li.append(link(e.title+(e.pr?" · #"+e.pr:""),e.pr?gh()+"/pull/"+e.pr:gh()+"/commit/"+e.pin));ls.append(li);
    }
    s.append(node("h3","Accepted changes to Lean source"),ls);
  }
  if(day.captures.length>1) {
    const details=node("details",undefined,"method"),list=node("ul");
    details.append(node("summary","Earlier captures of this day"));
    for(const capture of day.captures.slice(0,-1)){
      const li=node("li");li.append(link((capture.observedAt || capture.endExclusive || day.day)+" · "+capture.pin.slice(0,9),mapLink({pin:capture.pin})));list.append(li);
    }
    details.append(list);parent.append(details);
  }
  await modules(parent,day.comparison,ticket);
}
async function proposed(parent,h,ticket) {
  const m=feed.data,current=m.proposals["55"];
  const p=h.has("version")?current.versions.find(v=>v.observedAt===h.get("version") && (!h.has("head") || v.head===h.get("head"))):
    h.has("head")?current.versions.findLast(v=>v.head===h.get("head")):current.versions.at(-1);
  if(!p) throw Error("The selected proposal revision is unavailable in this capture.");
  const chooser=section(parent);
  chooser.append(node("h2","PR #55 revision history"),options(current.versions.slice().reverse().map(v=>[v.observedAt,m.editions[v.head].committedAt.slice(0,10)+" · "+v.head.slice(0,9)+" · "+v.status]),p.observedAt,version=>nav({track:"proposal",version}),"Proposal revision"));
  chooser.append(node("p","Head committed "+m.editions[p.head].committedAt.replace("T"," ").replace("Z"," UTC")+" · status observed "+p.observedAt.replace("T"," ").replace("Z"," UTC")+".","meta"));
  parent.append(node("span","Pull request · "+p.status,"tag"));
  pairOverview(parent,p.title,m.editions[p.head],m.editions[p.base],p.comparison);
  const note=node("p",undefined,"tracknote");note.append("The author removes declarations unused by the five endpoints. This comparison measures the proposed head against its pinned common ancestor with the official branch. ",link("Read PR #55",gh()+"/pull/55"),".");parent.append(note);
  await modules(parent,p.comparison,ticket);
}
function externalRows(detail) {
  return detail.files.map(f=>({path:f.path,kind:!f.beforeUrl?"added":!f.afterUrl?"removed":"edited",
    ins:f.insertedLines,del:f.deletedLines,before:f.beforeUrl,after:f.afterUrl})).sort((a,b)=>(b.del-b.ins)-(a.del-a.ins)||a.path.localeCompare(b.path));
}
async function verifyTask(parent,h,ticket) {
  const v=await dailyAsset(feed,"verifytask/index.json");
  if(ticket!==generation) return;
  const days=v.days.map(d=>({...d,day:d.date,closed:d.final}));
  const selected=h.has("day")?days.find(d=>d.day===h.get("day")):days.at(-1);
  if(!selected) throw Error("The selected VerifyTask date is unavailable in this capture.");
  const observation=selected?.observation ? await dailyAsset(feed,"verifytask/"+selected.observation) : null;
  if(ticket!==generation) return;
  const site=observation?.site || v.site;
  const intro=section(parent);intro.append(node("h2","VerifyTask reading guide"));
  const p=node("p",undefined,"tracknote");
  p.append("The guide links the published archive and a Chinese source mirror. Its source page reports "+fmt(site.reportedFiles)+" Lean files and about "+fmt(site.reportedApproxLines)+" lines in the submitted package. ",link("Reading guide",site.guide)," · ",link("Source and downloads",site.sourcePage),".");intro.append(p);
  intro.append(node("p","Reported archive size "+fmt(site.reportedArchiveBytes)+" bytes · guide observed "+(site.observedAt || v.asOf).replace("T"," ").replace("Z"," UTC")+".","meta"));
  if(selected){
    timeline(parent,days,selected,null,"verifytask");
    const m=selected.mirror,s=section(parent);
    if(m) {
      s.append(node("h3",selected.day+" · "+(m.equalsSubmission?"Same source tree as the submission":"Source mirror revision")));
      const text=node("p",undefined,"tracknote");
      text.append("Both trees are compared by their complete src/ Git tree IDs. ",link("Mirror at "+m.commit.slice(0,9),m.sourceUrl)," · ",link("Submitted source",tree(feed.data.baseline)),".");s.append(text);
    } else s.append(node("p","No mirror revision was available at this cutoff."));
  }
  if(selected?.siteMetricsChange) {
    const change=selected.siteMetricsChange;
    const labels={reportedFiles:"files",reportedApproxLines:"approximate source lines",reportedArchiveBytes:"archive bytes"};
    const differences=Object.entries(change.changeInReportedValues).filter(([,value])=>value!==0);
    if(differences.length){
      const s=section(parent),refs=node("p",undefined,"links");
      s.append(node("h3","Changes reported by the guide"),node("p",differences.map(([k,value])=>signed(value)+" "+labels[k]).join(" · ")));
      refs.append(link("Previous observation",feed.root+"verifytask/"+change.previousEvidence),link("Current observation",feed.root+"verifytask/"+change.evidence));s.append(refs);
    }
  }
  if(selected?.mirrorChange) {
    const c=selected.mirrorChange,s=section(parent);
    s.append(node("h3","Change in the mirror"),node("p",signed(c.netLines)+" net lines in "+fmt(c.files)+" changed modules."));
    const detail=await dailyAsset(feed,"verifytask/"+c.details);
    if(ticket!==generation) return;
    tableBrowser(s,externalRows(detail));
  }
  const applicable=observation?.proposals || [];
  if(!observation) parent.append(node("p","The mirror revision was reconstructed from Git. No guide or contributor observation was archived for this date.","meta"));
  else parent.append(node("p","Guide and contributor status observed "+(observation.observedAt || observation.asOf).replace("T"," ").replace("Z"," UTC")+".","meta"));
  if(observation && !applicable.length) parent.append(node("p","No associated contributor proposals were recorded in this observation."));
  for(const prop of applicable) {
    const s=section(parent), c=prop.comparison;
    s.append(node("span",prop.author+" · contributor PR · "+prop.status,"tag"),node("h2",prop.title));
    s.append(node("p","This contribution is attributed to its author. The guide and its source mirror are tracked above.","tracknote"));
    cards(s,[[signed(c.netLines),"Net Lean lines"],[fmt(c.files),"Changed modules"],[fmt(c.insertedLines)+" / "+fmt(c.deletedLines),"Lines inserted / deleted"]]);
    const refs=node("p",undefined,"links");refs.append(link("Upstream PR #"+prop.number,prop.url),link("Base · "+prop.base.slice(0,9),tree(prop.base)),link("Head · "+prop.head.slice(0,9),prop.repository+"/tree/"+prop.head+"/src"));
    s.append(refs);
    const groups=node("ul",undefined,"compact");
    for(const g of c.groups) groups.append(node("li",g.name+" · "+fmt(g.files)+" modules · "+signed(g.netLines)+" lines"));
    s.append(groups);
    const detail=await dailyAsset(feed,"verifytask/"+c.details);
    if(ticket!==generation) return;
    tableBrowser(s,externalRows(detail),{status:false});
  }
  parent.append(link("VerifyTask observation history and evidence",feed.root+"verifytask/index.json"));
}
async function render() {
  if(!feed) return;
  const ticket=++generation,h=new URLSearchParams(location.hash.slice(1));
  const track=["proposal","verifytask"].includes(h.get("track"))?h.get("track"):"official";
  document.querySelectorAll("[data-track]").forEach(a=>{if(a.dataset.track===track)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");});
  const contents=$("contents");contents.replaceChildren();document.body.dataset.ready="";
  $("manifestLink").href=feed.root+"index.json";$("notice").textContent="Archive captured "+feed.data.capturedAt.replace("T"," ").replace("Z"," UTC")+". Dates use UTC.";
  try {
    if(track==="official") await official(contents,h,ticket);
    else if(track==="proposal") await proposed(contents,h,ticket);
    else await verifyTask(contents,h,ticket);
    if(ticket===generation) document.body.dataset.ready=track;
  } catch(e) {
    if(ticket===generation){const msg=node("p","Could not open this record. "+e.message,"fault"); msg.setAttribute("role","alert");contents.append(msg);}
  }
}
window.addEventListener("hashchange",render);
(async()=>{
  try{const fallback=await localFeed();feed={data:fallback,root:new URL("../../data/daily/",import.meta.url).href};render();}catch{}
  try{
    const current=await dailyFeed();
    if(!feed || current.data.capturedAt>feed.data.capturedAt) {feed=current;await render();}
  }catch(error){if(!feed)$("notice").textContent=error.message;}
})();
