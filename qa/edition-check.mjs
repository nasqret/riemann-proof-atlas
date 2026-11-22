// Runs inside the edition map. Controls, links and counts are checked through the rendered UI.
export async function checkEditions() {
  const $ = s => document.querySelector(s);
  const expect = (v,label) => { if (!v) throw Error(label); };
  async function wait(fn) {
    for(let i=0;i<600;i++) { if(fn()) return; await new Promise(resolve=>setTimeout(resolve,75)); }
    throw Error("Timed out waiting for the edition reader. "+$("#matches").textContent);
  }
  const flip = (selector,value) => {
    const n=$(selector); n.value=value; n.dispatchEvent(new Event("change",{bubbles:true}));
  };
  async function visit(hash) {
    history.pushState(null,"","#"+hash); window.dispatchEvent(new PopStateEvent("popstate"));
    await new Promise(r=>requestAnimationFrame(r));
  }
  await wait(()=>document.body.dataset.ready==="true");
  const conf=await (await fetch("data/editions/index.json")).json();
  const by=id=>conf.editions.find(e=>e.id===id);
  expect(conf.editions.every(c=>Array.from($("#revision").options).some(o=>o.value===c.commit)),"Missing frozen revision");
  const source=()=>Array.from($("#selection").querySelectorAll("a")).find(a=>a.textContent==="Lean at this snapshot")?.href;
  const original=()=>Array.from($("#selection").querySelectorAll("a")).find(a=>a.textContent==="Submitted Lean")?.href;
  const refs={};
  for(const [code,line] of [["merge-57",5],["submission",4]]) {
    const e=by(code);await visit("rev="+e.commit+"&row=446888");
    await wait(()=>source()?.includes(e.commit+"/") && $("#selection h3").textContent.endsWith(".phi_mul"));
    expect(source().endsWith("PhiMul.lean#L"+line),"Incorrect original/current tactic anchor");refs[code]=source();
    expect($("#selection a[href='structured.html#frobenius']"),"Missing structured-proof cross-reference");
  }
  const e=by("proposal-63");flip("#revision",e.commit);await wait(()=>$("#editionInfo h2")?.textContent===e.title);
  for(const st of [4,2,3]) {
    const row=e.examples[st][0];await visit("rev="+e.commit+"&change="+st+"&row="+row);
    await wait(()=>$("#selection .meta")?.textContent.startsWith(({4:"Moved by name",2:"Unmatched original",3:"Unmatched snapshot"})[st]));
    if(st===2) expect(!source()&&original().includes(conf.baseline),"Unmatched source has a spurious destination");
    else expect(source().includes(e.commit),"Missing current source for "+st);
    if(st===3) expect($("#scene").textContent==="Source-section index","Unmatched destination scene");
    refs[st]=source()||original();
  }
  const target=by("merge-57"); await visit("rev="+target.commit+"&q=UpperTheory.Reformulated.B.Qf14.phi_mul");
  await wait(()=>$("#selection button")?.textContent.includes(".phi_mul"));
  $("#selection button").click();await wait(()=>source()?.includes(target.commit));
  expect(location.hash.includes("row=446888"),"Search did not select the same occurrence");
  flip("#change","1");await wait(()=>$("#matches").textContent.includes(target.states[1].toLocaleString("en-US")+" declarations"));
  await visit("rev="+by("submission").commit);await wait(()=>$("#editionInfo h2").textContent==="Original submission");
  const {AtlasMap}=await import(new URL("map.js",document.baseURI));
  let map; const prev=AtlasMap.prototype.draw;
  try{
    AtlasMap.prototype.draw=function(){map=this;return prev.call(this);};$("#fit").click();await wait(()=>map?.screen.length>0);
  } finally {AtlasMap.prototype.draw=prev;}
  const rect=$("#viewport").getBoundingClientRect();
  const mark=map.screen.find(p=>p.count>1 && p.sx>20 && p.sx<map.width-20 && p.sy>90 && p.sy<map.height-48);
  expect(mark,"No clickable markers"); await map.select(mark); await wait(()=>!!$("#selection button.result"));
  // Use the same callback as a canvas pointer hit; the marker must expand into source declarations.
  const listed=$("#selection h3").textContent;
  expect(listed.includes(" of "),"Map marker did not open a collection");
  expect(document.documentElement.scrollWidth<=innerWidth+1,"Page overflows at "+innerWidth);
  await visit("rev="+conf.latest);await wait(()=>$("#revision").value===conf.latest);
  return {editions:conf.editions.length,links:refs,marker:listed,canvasWidth:rect.width,viewport:innerWidth};
}

export async function checkReader() {
  const el=s=>document.querySelector(s), all=s=>Array.from(document.querySelectorAll(s));
  const data=await (await fetch("data/structured.json")).json();
  if(all("article.proof").length!==data.readings.length || all(".steps li").length!==data.steps.length) throw Error("Chapter or step count");
  for(const a of all("a[href^='#']")) if(!document.getElementById(decodeURIComponent(a.hash.slice(1)))) throw Error(a.hash);
  const passage=el("#frobenius-pure .passage");passage.open=false;passage.querySelector("summary").click();
  if(!passage.open || !passage.querySelector("pre").textContent.includes("rfl")) throw Error("Pure tensor tactic preview");
  const pins=all("#frobenius-pure .passage a").map(a=>a.href);
  if(!pins.some(s=>s.endsWith("#L21")) || !pins.some(s=>s.endsWith("#L832"))) throw Error("Cross-edition tactics");
  if(document.documentElement.scrollWidth>innerWidth+1) throw Error("Proof reading overflow");
  const pdf=await fetch("structured-proofs.pdf");
  if(!pdf.ok || new TextDecoder().decode((await pdf.arrayBuffer()).slice(0,5))!=="%PDF-") throw Error("PDF download");
  return {chapters:data.readings.length,steps:data.steps.length,passages:Object.keys(data.passages).length,links:pins,viewport:innerWidth};
}
