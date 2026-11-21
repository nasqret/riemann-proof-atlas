import { Catalog, json, fmt } from "../data.js";
import { AtlasMap } from "../map.js";

const W = 1280, H = 720, FPS = 30, DURATION = 52;
const times = [0, 6, 13.5, 21.5, 29.5, 38, 46, DURATION];
const cream = "#f2f1dd", mint = "#a8e5c2", amber = "#f4bc7a", soft = "#c6d4cb";
const serif = 'Georgia, "Times New Roman", serif', sans = 'Arial, sans-serif', mono = 'Menlo, Consolas, monospace';
const canvas = document.querySelector("#film"), c = canvas.getContext("2d", { alpha: false });
const play = document.querySelector("#play"), status = document.querySelector("#status");
const cat = new Catalog(), map = new AtlasMap(() => {}, (s) => { status.textContent = s; });
map.vectorLimit = Infinity;
const ids = { matrix: 10, rh: 788322, assembly: 818752, all: 818751, galois: 435423, landau: 424699, zero: 424690 };
const records = {}, pictures = {};
let home, camera, metrics, current = 0, running = false, startTime = 0, encoding = false;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (v) => { v = clamp(v); return v * v * (3 - 2 * v); };
const mix = (a, b, t) => a + (b - a) * t;
const image = async (src) => { const i = new Image(); i.src = src; await i.decode(); return i; };

function text(s, x, y, size, color = cream, font = sans, weight = "") {
  c.font = (weight ? weight + " " : "") + size + "px " + font;
  c.fillStyle = color; c.fillText(s, x, y);
}
function line(x, y, xx, yy, color, width = 1) {
  c.beginPath(); c.strokeStyle = color; c.lineWidth = width; c.moveTo(x, y); c.lineTo(xx, yy); c.stroke();
}
function box(x,y,w,h,r,fill,stroke) {
  c.beginPath(); c.roundRect(x,y,w,h,r); c.fillStyle = fill; c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.3; c.stroke(); }
}
function heading(lines, start = 233, size = 64) {
  lines.forEach((s, i) => text(s, 64, start + i * size * 1.05, size, cream, serif));
}
function copy(lines, y) { lines.forEach((s, i) => text(s, 67, y + i * 32, 23, soft)); }
function tag(s) { text(s, 66, 143, 17, mint, mono); }
function nodeCamera(i, z) { return [cat.x[i], cat.y[i], z]; }
function cameraAt(t) {
  let k = 1;
  while (k < camera.length - 1 && t > camera[k][0]) k++;
  const [ta, a] = camera[k-1], [tb, b] = camera[k];
  const f = ease((t-ta)/(tb-ta));
  return [mix(a[0],b[0],f),mix(a[1],b[1],f),Math.exp(mix(Math.log(a[2]),Math.log(b[2]),f))];
}
function background(t, scene) {
  const [x,y,z] = cameraAt(t);
  const baseUnit = .97 * Math.min(W/(map.bounds[2]-map.bounds[0]),H/(map.bounds[3]-map.bounds[1]));
  const proofOnly = scene >= 2 && scene <= 4;
  const scope = proofOnly ? "1" : "all", field = proofOnly ? "valueMask" : "mask";
  if (map.scope !== scope || map.evidence !== field) {
    map.evidence = field; map.setFilters(scope, "");
  }
  map.show.lean = t >= 4.6; map.selected = scene === 2 ? ids.matrix : scene === 3 ? ids.rh :
    scene === 4 ? (t < 33.8 ? ids.galois : ids.landau) : null;
  map.go(x - (W * .21)/(baseUnit*z), y, z); map.draw();
  c.drawImage(map.canvas, 0, 0, W, H);
  const wash = c.createLinearGradient(0,0,W,0);
  wash.addColorStop(0,"rgba(11,22,25,.995)"); wash.addColorStop(.28,"rgba(11,22,25,.97)");
  wash.addColorStop(.46,"rgba(11,22,25,.8)"); wash.addColorStop(.68,"rgba(11,22,25,.18)"); wash.addColorStop(1,"rgba(11,22,25,.06)");
  c.fillStyle = wash; c.fillRect(0,0,W,H);
  const band = c.createLinearGradient(0,H-118,0,H);
  band.addColorStop(0,"rgba(11,22,25,0)"); band.addColorStop(1,"rgba(9,19,22,.94)");
  c.fillStyle = band; c.fillRect(0,H-118,W,118);
}
function metric(n, label, y, color = cream) {
  text(n, 67, y, 41, color, serif); text(label, 69, y+27, 20, soft);
}
function sourceCard(u) {
  const x=600, y=164, w=614, h=378;
  box(x,y,w,h,14,"#eff0df","#dce5d7"); text("Lean  /  Main.lean",x+28,y+42,21,"#31564d",mono);
  line(x+28,y+67,x+w-28,y+67,"#b4c4b6"); text("4",x+27,y+119,23,"#658477",mono);
  text("theorem",x+65,y+119,26,"#20604e",mono); text("riemannHypothesis",x+192,y+119,26,"#162d29",mono);
  text(": RiemannHypothesis :=",x+65,y+164,24,"#344b47",mono);
  const beat = ease((u-.3)/.25);
  box(x+57,y+187,156,40,6,`rgba(160,211,169,${.35+.55*beat})`);
  text(records.assembly.name,x+67,y+216,26,"#153b2c",mono,"bold");
  text("Proof-value references",x+28,y+278,18,"#4b665c");
  const names=[records.rh.name,records.assembly.name,records.all.name];
  let left=x+28;
  for (let i=0;i<names.length;i++) {
    const color = u > .22+i*.2 ? "#194e40" : "#76877e";
    text(names[i],left,y+323,19,color,mono); left += c.measureText(names[i]).width+10;
    if(i+1<names.length){text("→",left,y+323,22,"#517565");left+=31;}
  }
}
function bookAndSite(u) {
  const x=567, y=137;
  c.save(); c.translate(x+341,y+221); c.rotate(-.071+.022*ease(u));
  c.shadowColor="#061010aa"; c.shadowBlur=22; c.shadowOffsetY=10;
  c.drawImage(pictures.guide,-72,-238,340,440); c.restore();
  const xx=x-12-13*ease(u), yy=y+91;
  c.save(); c.shadowColor="#050d0e99"; c.shadowBlur=22; c.shadowOffsetY=9;
  box(xx,yy,586,398,9,"#e2e8db"); c.restore();
  c.save(); c.beginPath(); c.roundRect(xx+6,yy+6,574,386,5); c.clip();
  c.drawImage(pictures.edition,xx+6,yy+6,574,386); c.restore();
}
function contents(i,t,u) {
  if (i===0) {
    tag("A FORMALIZATION IN LEAN"); heading(["Mapping the","Riemann hypothesis"],227,65);
    copy(["Explore the mathematics behind a proof,","one theorem at a time."],398);
  } else if (i===1) {
    tag("THE PAPER MAP"); heading(["From papers","to proof bundles"],221,57);
    metric(fmt(map.base.paper_count),"papers in the original arXiv map",386);
    metric(fmt(cat.meta.placed),"Lean declarations at arXiv neighborhoods",481,mint);
    text(fmt(cat.meta.recovered)+" newly attributed declarations",68,572,23,amber);
  } else if (i===2) {
    tag("EVIDENCE FROM LEAN"); heading(["Why this dot","is here"],219,62);
    text("Matrix addition",67,397,33,amber,serif);
    copy(["If X and Y satisfy the Lie condition,","so does their sum. The exported type","names the matrix addition operation."],447);
    const px=W*.71, py=H*.50, reveal=ease((u-.10)/.20);
    c.save(); c.globalAlpha*=reveal;
    line(px+11,py+9,px+36,py+46,mint,1.5);
    box(px-108,py+46,297,88,8,"#122b2af2","#719e8c");
    text("lie_add",px-90,py+78,25,cream,mono);
    text("Type uses "+records.matrix.terms[0],px-90,py+112,17,mint,mono);
    c.restore();
  } else if (i===3) {
    tag("A PINNED DECLARATION"); heading(["Follow one","proof term"],229,62);
    copy(["The final statement uses rhOfAll.","Its proof refers to allChi."],399);
    text(fmt(metrics.placed)+" / "+fmt(metrics.total),67,518,35,mint,serif);
    text("reached declarations with a map location",68,552,20,soft);
    sourceCard(u);
  } else if (i===4) {
    tag("TWO PLACES IN THE ARGUMENT"); heading(["From arithmetic","to zeros"],231,59);
    const analysis = t>=33.8;
    const v = analysis ? ease((t-33.8)/.37) : ease((33.8-t)/.37);
    c.save();c.globalAlpha*=v;
    text(analysis?"The Landau window":"A Galois input",67,394,34,amber,serif);
    copy(analysis?["A window estimate constrains poles.","A further lemma gives a zero-free region."]:["The arithmetic construction supplies","a local–global Galois parameter."],447);
    text(analysis?"landauWindow.lean  ·  line "+records.landau.line:"RowSrc.lean  ·  line "+records.galois.line,68,560,20,mint,mono);c.restore();
  } else if (i===5) {
    tag("THE READING PROJECT"); heading(["Read the","argument"],217,61);
    copy(["The theorem blueprint, annotated PDF","and Jupyter Book explain the steps."],382);
    copy(["Two independent kernels accepted","the export. Five endpoint statements","matched the Mathlib challenge."],483);
    bookAndSite(u);
  } else {
    tag("THE INTERACTIVE EDITION"); heading(["Explore the","proof atlas"],219,68);
    copy(["Pick a subject. Open a theorem.","Follow the proof back to Lean."],411);
    text("nasqret.github.io/riemann-proof-atlas",66,548,28,mint,mono);
  }
}
function render(t) {
  current=clamp(t,0,DURATION);
  let i=0;
  while(i<times.length-2 && current>=times[i+1])i++;
  const age=current-times[i], remaining=times[i+1]-current, u=age/(times[i+1]-times[i]);
  c.save(); background(current,i);
  c.save();c.globalAlpha=i===0?ease(age/.55):ease(age/.40);
  if(i<times.length-2)c.globalAlpha*=ease(remaining/.36);
  c.translate(0,8*(1-ease(age/.65)));contents(i,current,u);c.restore();
  text("ζ",62,74,40,mint,serif,"italic"); text("Riemann proof atlas",100,65,21,cream);
  line(66,646,W-66,646,"#71857d",1);
  line(66,646,66+(W-132)*current/DURATION,646,mint,3);
  text("arXiv map  ·  Leland McInnes",66,684,16,soft);
  c.textAlign="right";text("Lean source  ·  40e56ba",W-67,684,16,soft,mono);c.restore();
}
function playback(now) {
  if(!running)return;
  render((now-startTime)/1000);
  if(current>=DURATION){running=false;play.textContent="Replay";return;}
  requestAnimationFrame(playback);
}
play.onclick=()=>{
  if(running){running=false;play.textContent="Resume";return;}
  if(current>=DURATION)current=0;
  running=true;startTime=performance.now()-current*1000;play.textContent="Pause";requestAnimationFrame(playback);
};
async function warm() {
  for(let t=0;t<DURATION;t+=.28) {
    const [x,y,z]=cameraAt(t),unit=.97*Math.min(W/(map.bounds[2]-map.bounds[0]),H/(map.bounds[3]-map.bounds[1]));
    map.go(x-(W*.21)/(unit*z),y,z);map.draw();
  }
  await Promise.all([...map.images.values()].map(i=>i.decode()));
  await Promise.all([...map.vectorLoads]);
  if ([...map.vectors.values()].some(v => v.failed)) throw Error("Could not load all original paper coordinates for the film");
}
async function encode() {
  if(encoding)return;
  encoding=true;running=false;play.disabled=true;document.querySelector("#encode").disabled=true;
  try {
    await warm();
    const config={codec:"avc1.42001f",width:W,height:H,bitrate:4400000,framerate:FPS,latencyMode:"realtime",avc:{format:"annexb"}};
    if(!(await VideoEncoder.isConfigSupported(config)).supported) throw Error("Chromium with H.264 WebCodecs support is required");
    const chunks=[];let failure=null;
    const encoder=new VideoEncoder({output(chunk){const b=new Uint8Array(chunk.byteLength);chunk.copyTo(b);chunks.push(b);},error(e){failure=e;}});
    try {
      encoder.configure(config);
      for(let frame=0;frame<FPS*DURATION;frame++){
        if(failure)throw failure;
        if(encoder.encodeQueueSize>=6)await new Promise(r=>encoder.addEventListener("dequeue",r,{once:true}));
        render(frame/FPS);
        const vf=new VideoFrame(canvas,{timestamp:Math.round(frame*1e6/FPS),duration:Math.round(1e6/FPS)});
        encoder.encode(vf,{keyFrame:frame%(FPS*2)===0});vf.close();
        if(frame%FPS===0)status.textContent="Rendering "+(frame/FPS)+" / "+DURATION+" s";
      }
      await encoder.flush();if(failure)throw failure;
    } finally { if(encoder.state!=="closed")encoder.close(); }
    if(chunks.length!==FPS*DURATION)throw Error("Incomplete encoded stream");
    const save=document.querySelector("#stream");if(save.href.startsWith("blob:"))URL.revokeObjectURL(save.href);
    save.href=URL.createObjectURL(new Blob(chunks,{type:"video/h264"}));save.hidden=false;
    status.textContent=chunks.length+" frames ready";document.body.dataset.frames=String(chunks.length);
  } catch(e){status.textContent=e.message;document.body.dataset.error=e.message;}
  finally{encoding=false;play.disabled=false;play.textContent="Replay";document.querySelector("#encode").disabled=false;}
}
async function init() {
  const [, ,guide,edition,table]=await Promise.all([map.baseLoad(),cat.load(),image("film/assets/guide.webp"),image("film/assets/edition.webp?v=c6cdac34f3a3"),json("data/refinement/subjects.json")]);
  Object.assign(pictures,{guide,edition});metrics=table.endpoints[0].counts.value;map.setCatalog(cat);
  for(const [k,i] of Object.entries(ids))records[k]=await cat.record(i);
  for(const [a,b] of [[ids.rh,ids.assembly],[ids.assembly,ids.all]]) {
    const [out]=await cat.neighbors(a);if(!out.some(([target,kind])=>target===b && (kind&2)))throw Error("Source witness changed");
  }
  if(records.matrix.name.split(".").pop()!=="lie_add" || !records.matrix.terms.includes("Matrix.add")
    || !cat.valueMask[ids.matrix] || cat.unplaced[ids.matrix]) throw Error("Expected matrix attribution changed");
  home=[map.cx,map.cy,map.zoom];
  camera=[[0,home],[5.8,[home[0],home[1],home[2]*1.14]],[13.5,nodeCamera(ids.matrix,4.2)],[19.9,nodeCamera(ids.matrix,96)],[21.5,nodeCamera(ids.matrix,96)],[23.8,nodeCamera(ids.rh,8)],[27,nodeCamera(ids.rh,10)],[30.7,nodeCamera(ids.galois,6.8)],[32.9,nodeCamera(ids.galois,7.6)],[35.2,nodeCamera(ids.landau,7.3)],[38,nodeCamera(ids.landau,8.2)],[44,home],[52,[home[0],home[1],home[2]*1.15]]];
  await warm();render(.75);current=0;play.disabled=false;status.textContent="52 seconds";
  if(new URLSearchParams(location.search).has("studio")){
    document.querySelector("#encode").hidden=false;
    const scrub=document.querySelector("#scrub");scrub.hidden=false;
    scrub.oninput=()=>{running=false;play.textContent="Resume";render(Number(scrub.value));};
  }
  document.querySelector("#encode").onclick=encode;document.body.dataset.ready="true";
}
init().catch(e=>{status.textContent=e.message;document.body.dataset.error=e.message;});
