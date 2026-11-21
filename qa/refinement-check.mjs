// Black-box UI paths plus a camera observation during the real wheel/pinch handlers.
export async function checkRefinement() {
  const $ = s => document.querySelector(s);
  const until = async predicate => {
    for (let i=0;i<450;i++) {
      if (predicate()) return;
      await new Promise(r=>setTimeout(r,50));
    }
    throw Error("Timed out: " + $("#content").innerText.slice(0,100));
  };
  const assert=(v,msg)=>{if(!v)throw Error(msg);};
  const paint=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const change=(id,val)=>{const el=$("#"+id);el.value=val;el.dispatchEvent(new Event("change",{bubbles:true}));};
  const select=async fragment=>{
    location.hash=fragment;
    window.dispatchEvent(new PopStateEvent("popstate"));
    await paint();
  };
  await until(()=>document.body.dataset.ready==="true");
  $("#origin").click();await paint();
  const { AtlasMap }=await import(new URL("map.js",document.baseURI));
  const draw=AtlasMap.prototype.draw;
  let map;
  try {
    AtlasMap.prototype.draw=function(){map=this;return draw.apply(this,arguments);};
    $("#zoomIn").click();await until(()=>map);
  } finally {AtlasMap.prototype.draw=draw;}
  const cat=map.cat, meta=cat.meta;
  assert(meta.placed+meta.sourceIndex===cat.index.count,"Source census");
  const sample=async(method,needle)=>{
    const e=meta.examples[method];await select("theorem="+e.row);
    await until(()=>$("#content h2")?.textContent===e.name&&$("#content").innerText.includes(e.witness));
    assert($("#content a.extlink").href.includes("#L"+e.source.split(":").at(-2)),"Pinned source");
    assert($("#scene").textContent===needle,"Map space");
    assert(document.documentElement.scrollWidth<=innerWidth+1,"Source inspector overflows the viewport");
    return e.row;
  };
  const direct=await sample("kernel-type","arXiv paper map");
  const context=await sample("module-context","arXiv paper map");
  const residual=await sample("source-family","Source-section index");
  $("#origin").click();change("placement","direct");await paint();
  const directCount=map.matched;
  change("placement","context");await paint();const contextCount=map.matched;
  assert(directCount+contextCount+meta.sourceIndex===cat.index.count,"Evidence partition");
  await select("bundle=unplaced");await until(()=>$("#scene").innerText.includes("Source-section")&&map.matched===meta.sourceIndex);
  $("#origin").click();await paint();
  const at=meta.examples["kernel-type"].row;
  map.go(cat.x[at],cat.y[at],4);await paint();
  const view=$("#viewport"),rect=view.getBoundingClientRect();
  const clientX=Math.round(rect.left+map.width*.5),clientY=Math.round(rect.top+map.height*.5);
  const sx=clientX-rect.left,sy=clientY-rect.top;
  const isVisible=h=>h.sx>24&&h.sy>24&&h.sx<map.width-24&&h.sy<map.height-24;
  let drift=0,retained=0,frames=0;
  const world=map.project(sx,sy);
  for(let k=0;k<48;k++){
    const before=map.screen.filter(h=>h.anchor!=null&&isVisible(h));
    view.dispatchEvent(new WheelEvent("wheel",{clientX,clientY,deltaY:-30,bubbles:true,cancelable:true}));
    await paint();frames++;
    const after=new Set(map.screen.map(h=>h.anchor));
    const focal=map.project(sx,sy);
    drift=Math.max(drift,Math.hypot(focal[0]-world[0],focal[1]-world[1])*map.unit);
    for(const h of before){
      const px=map.px(cat.x[h.anchor]),py=map.py(cat.y[h.anchor]);
      if(!isVisible({sx:px,sy:py}))continue;
      assert(after.has(h.anchor),"Visible anchor moved or was exchanged during wheel zoom");
      retained++;
    }
  }
  // Inject two contacts into the active controller and exercise the normal
  // pointermove handler, including a simultaneous scale and midpoint shift.
  const a=[sx-65,sy],b=[sx+65,sy],next=[sx-90,sy+17];
  const focal=map.project(sx,sy);
  map.pointers.set(71,{p:a,start:a});map.pointers.set(72,{p:b,start:b});
  view.dispatchEvent(new PointerEvent("pointermove",{pointerType:"touch",pointerId:71,clientX:rect.left+next[0],clientY:rect.top+next[1]}));
  map.pointers.clear();await paint();
  const translated=map.project((next[0]+b[0])/2,(next[1]+b[1])/2);
  const pinchError=Math.hypot(translated[0]-focal[0],translated[1]-focal[1])*map.unit;
  assert(drift<1e-6&&pinchError<1e-6&&retained>40,"Camera drift: "+JSON.stringify({drift,pinchError,retained,sx,sy}));
  $("#origin").click(); await paint();
  $("#layersBtn").click(); $("#generated").click();
  await until(()=>map.nativeLayer?.data && !$("#generated").disabled);
  const layer=map.nativeLayer, data=layer.data;
  const n=data.method.findIndex((m,i)=>m>=data.index.methods.length && !layer.unplaced[i]);
  assert(n>=0,"Missing newly placed native theorem");
  $("#lean").click(); $("#layersBtn").click(); map.go(layer.x[n],layer.y[n],6); await paint();
  const representative=h=>{let id=Infinity;for(const j of h.ids) id=Math.min(id,j);return id;};
  let nativeRetained=0;
  for(let frame=0;frame<18;frame++){
    const before=map.screen.filter(h=>h.type==="native"&&isVisible(h)).map(representative);
    map.zoomAt(1.08,sx,sy);await paint();
    const after=new Set(map.screen.filter(h=>h.type==="native").map(representative));
    for(const id of before){
      if(!isVisible({sx:map.px(layer.x[id]),sy:map.py(layer.y[id])}))continue;
      assert(after.has(id),"A native anchor moved on zoom");nativeRetained++;
    }
  }
  assert(nativeRetained>0,"Native zoom has no test coverage");
  const nativeId=data.id[n];await select("native="+nativeId);
  await until(()=>$("#content").innerText.includes("Map placement")&&$("#content").querySelector("a.extlink"));
  const nativeSource=$("#content a.extlink").href;
  assert(nativeSource.includes("/blob/"+meta.sourcePin+"/src/"),"Native source pin");
  $("#origin").click();await paint();
  return {direct,context,residual,directCount,contextCount,sourceSections:meta.sourceIndex,
    wheelFrames:frames,retained,maximumWheelDriftPixels:drift,pinchErrorPixels:pinchError,
    nativeId,nativeSource,nativeZoomFrames:18,nativeRetained};
}
