// Serialized verbatim into each browser. Wait for the actual selected state and stable pixels.
export async function settle(route) {
  const until=performance.now()+60000;
  const snooze=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  let match;
  while(!(match=document.querySelector(route.ready)) ||
        (route.frameReady && (!match.contentDocument?.querySelector(route.frameReady) ||
          match.contentDocument.querySelector("#status")?.textContent.trim() !== "Verified PDF"))) {
    if(performance.now()>until)throw Error("View never reached "+route.id+" at "+location.href);
    await snooze(60);
  }
  const doc=route.frameReady ? match.contentDocument : document;
  await Promise.all([document.fonts.ready,doc.fonts.ready]);
  if(route.position==="inspector" && innerWidth<=620)document.querySelector("#panel").scrollIntoView({block:"start",behavior:"instant"});
  else if(route.position==="top")window.scrollTo({top:0,behavior:"instant"});
  else if(route.position==="anchor" && location.hash){
    const anchor=document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if(anchor){
      // WebKit can paint fractional fragment offsets one pixel apart after a warm navigation.
      window.scrollTo({top:0,behavior:"instant"});
      await frame();await frame();
      const margin=parseFloat(getComputedStyle(anchor).scrollMarginTop)||0;
      const y=Math.floor(anchor.getBoundingClientRect().top+scrollY-margin);
      window.scrollTo({top:y,behavior:"instant"});
    }
  }
  const canvas=document.querySelector("canvas#map");
  let previous="",stableSince=performance.now();
  while(true){
    const sample=[Math.round(scrollY),document.documentElement.scrollHeight,
      performance.getEntriesByType("resource").length,doc.querySelectorAll("img").length];
    if(canvas && canvas.width && canvas.height){
      const ctx=canvas.getContext("2d"), nx=16,ny=9;
      for(let y=0;y<ny;y++){
        const data=ctx.getImageData(0,Math.min(canvas.height-1,Math.floor((y+.5)*canvas.height/ny)),canvas.width,1).data;
        for(let x=0;x<nx;x++){const i=Math.floor((x+.5)*canvas.width/nx)*4;sample.push(data[i],data[i+1],data[i+2]);}
      }
    }
    const signature=sample.join(",");
    if(signature!==previous){previous=signature;stableSince=performance.now();}
    if(performance.now()-stableSince>500)break;
    if(performance.now()>until)throw Error("Unstable surface "+route.id);
    await snooze(80);
  }
  await frame();await frame();
  if(route.position==="anchor" && route.replayScroll){
    const target=route.replayScroll[1];
    if(Math.abs(scrollY-target)>1)throw Error("Fragment landed at "+scrollY+"; reference "+target+" in "+route.id);
    window.scrollTo({top:target,behavior:"instant"});
    await frame();await frame();
    if(scrollY!==target)throw Error("Could not restore the reference viewport for "+route.id);
  }
  return {title:document.title,route:location.hash,viewport:[innerWidth,innerHeight],scroll:[scrollX,scrollY],
    horizontalOverflow:document.documentElement.scrollWidth-innerWidth,
    ...(route.frameReady?{pdf:doc.querySelector("#status").textContent.trim()}: {})};
}
