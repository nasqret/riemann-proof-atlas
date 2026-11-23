function e(tag, text, cls) {
  const node=document.createElement(tag);
  if (text!==null && text!==undefined) node.textContent=text;
  if (cls) node.className=cls;
  return node;
}
function link(text, href, cls) {const a=e("a",text,cls);a.href=href;return a;}
function block(title,...children) {const s=e("section",null,"state");s.append(e("h3",title),...children);return s;}
function button(text,cls,action) {const b=e("button",text,cls);b.type="button";b.onclick=action;return b;}
async function read(url) {
  const response=await fetch(url);
  if (!response.ok) throw Error("Could not load "+url+" ("+response.status+")");
  return response.json();
}
function css(url) {return new Promise((resolve,reject)=>{const l=e("link");l.rel="stylesheet";l.href=url;l.onload=resolve;l.onerror=()=>reject(Error("Could not load "+url));document.head.append(l);});}
const root=document.querySelector("#sheet");
document.querySelector(".skip-reader").addEventListener("click", event => {
  event.preventDefault();
  document.querySelector("#reference").focus();
});
let config,data,preview;
const src=(r)=>"https://github.com/"+(r.repository||"leanprover-community/riemann-hypothesis")+"/blob/"+(r.pin||data.pin)+"/"+(r.repository?"":"src/")+r.file.split("/").map(encodeURIComponent).join("/")+"#L"+r.first+(r.last===r.first?"":"-L"+r.last);
function stateGallery() {
  const wrap=e("section");wrap.append(e("h2","Component states"));
  const grid=e("div",null,"states");
  const stats=e("div",null,"stats");
  for (const [n,text] of [["67","chapter members"],["58","structured proofs"]]) {const cell=e("div");cell.append(e("strong",n),e("span",text));stats.append(cell);}
  const select=e("select");select.setAttribute("aria-label","Proof scope");select.append(new Option("Whole project","all"),new Option("Classical RH","1"));
  const search=e("input");search.type="search";search.placeholder="Name or part of a name";search.setAttribute("aria-label","Find a Lean theorem");
  const tab=e("div",null,"tabline");
  for(const [i,t] of ["Uses","Used by"].entries()){const b=button(t,"chip",()=>[...tab.children].forEach(x=>x.setAttribute("aria-pressed",String(x===b))));b.setAttribute("aria-pressed",String(i===0));tab.append(b);}
  const dialog=e("dialog");dialog.append(e("h2","Proof source"),e("p","The source link opens the lines at the submitted Lean revision."),button("Close dialog","quiet",()=>dialog.close()));
  const disabled=button("Unavailable","quiet");disabled.disabled=true;
  const toolbar=e("div",null,"maptools");let zoom=1,full=false;const scene=e("div");scene.id="mapbarBottom";const status=e("span","arXiv paper map · 1×");scene.append(status);
  const update=()=>{status.textContent="arXiv paper map · "+zoom+"×"+(full?" · fullscreen":"");};
  for (const [symbol,label,act] of [["+","Zoom in",()=>zoom*=2],["−","Zoom out",()=>zoom=Math.max(.5,zoom/2)],["⌖","Fit map",()=>zoom=1],["⛶","Fullscreen state",()=>full=!full]]){const b=button(symbol,"",()=>{act();update();});b.setAttribute("aria-label",label);toolbar.append(b);}
  const map=e("div",null,"sample-map");map.append(toolbar,scene);
  const empty=e("p","No declarations match this scope.","empty");const fault=e("p","Atlas data unavailable","warn");fault.setAttribute("role","status");
  const sample=data.fixtures[0];
  grid.append(block("Figures",stats),block("Select and search",select,search),block("Segmented control",tab),
    block("Actions",button("Open dialog","primary",()=>dialog.showModal()),disabled,link("Pinned source",src(sample))),block("Map controls and status",map),
    block("Loading and empty",e("p","Loading the selection…","small"),empty),block("Error and recovery",fault,button("Try again","quiet",()=>fault.textContent="Loading the selection…")),
    block("Declaration",e("strong",sample.name,"bigcode"),e("p",sample.kind+" · "+sample.file+" · lines "+sample.first+"–"+sample.last,"sheet-meta")));
  wrap.append(grid,dialog);return wrap;
}
function render() {
  const h=new URLSearchParams(location.hash.slice(1));root.replaceChildren();delete document.body.dataset.ready;
  if (h.has("states")) root.append(stateGallery());
  else {
    const key=h.get("fixture") || data.fixtures[0].key, index=data.fixtures.findIndex(r=>r.key===key);
    if(index<0){root.append(e("h2","Unknown fixture"),e("p",key),link("All fixtures","#fixture"));document.body.dataset.ready="missing";return;}
    const r=data.fixtures[index],top=e("div",null,"fixture-top"),heading=e("div");heading.append(e("h2","Lean source fixtures"),e("p",data.scope+" · "+data.fixtures.length+" declarations · submission "+data.pin.slice(0,7),"sheet-meta"));
    const label=e("label","Declaration"), menu=e("select");menu.id="fixture";
    for(const f of data.fixtures)menu.append(new Option(f.label+" · "+f.name,f.key));
    menu.value=key;menu.onchange=()=>location.hash="fixture="+encodeURIComponent(menu.value);label.append(menu);top.append(heading,label);
    const art=e("article",null,"declaration");art.dataset.fixture=r.key;
    const name=e("h3");for(const [i,t] of r.name.split(".").entries()){if(i)name.append(".",e("wbr"));name.append(t);}
    art.append(name,e("p",(r.origin ? r.origin+" · "+r.pin.slice(0,8)+" · " : "")+r.kind+" · "+r.file+" · "+r.label,"sheet-meta"),preview({name:r.name,label:r.origin?"Dependency source":"Submitted Lean source",lines:r.source,first:r.first,marked:r.marked,complete:true,copyLabel:"Copy all"}));
    const nav=e("nav",null,"sheet-controls");nav.setAttribute("aria-label","Fixture navigation");
    nav.append(link("Open pinned source",src(r)));if(index>0)nav.append(link("Previous","#fixture="+encodeURIComponent(data.fixtures[index-1].key)));if(index+1<data.fixtures.length)nav.append(link("Next","#fixture="+encodeURIComponent(data.fixtures[index+1].key)));
    art.append(nav);root.append(top,art);
  }
  document.body.dataset.ready="reference";
}
try{
  config=await read("settings.json");
  await Promise.all((config.foundationStyles || []).map(css));
  const [records,ui]=await Promise.all([read(config.fixtures),import(new URL(config.renderer,document.baseURI)),css(config.baseStyle),css(config.readerStyle)]);
  data=records;preview=ui.leanPreview;
  if(data.scope!==config.scope||data.fixtures.length!==30)throw Error("The visual fixture edition is incomplete.");
  render();window.addEventListener("hashchange",render);
}catch(error){root.replaceChildren(e("h2","Reference unavailable"),e("p",error.message),button("Retry","quiet",()=>location.reload()));document.body.dataset.ready="error";}
