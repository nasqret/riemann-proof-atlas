/** Run in a browser on daily.html or editions.html to exercise the deployed interface. */
const pause = () => new Promise(resolve => setTimeout(resolve,65));
function expect(condition,message) { if(!condition) throw Error(message); }
async function until(check) {
  for(let i=0;i<500;i++) { const result=check(); if(result) return result; await pause(); }
  throw Error("Timed out waiting for the daily atlas. "+document.body.innerText.slice(-260));
}
const $ = selector => document.querySelector(selector);
const count = n => n.toLocaleString("en-US");
async function goto(params,listener="hashchange") {
  history.pushState(null,"","#"+new URLSearchParams(params));
  window.dispatchEvent(new Event(listener));await pause();
}
export async function checkDaily() {
  const {dailyFeed}=await import(new URL("daily-feed.js",document.baseURI));
  const {data}=await dailyFeed();
  const day=data.days.find(d=>d.day==="2026-11-21"), c=data.comparisons[day.comparison];
  const original=location.href;
  function noOverflow() {expect(document.documentElement.scrollWidth<=innerWidth+2,"Horizontal overflow at "+innerWidth);}
  try {
    if(location.pathname.endsWith("/daily.html")) {
      await goto({track:"official",day:day.day});
      await until(()=>document.body.dataset.ready==="official" && $("tbody tr"));
      expect($(".cards strong").textContent===count(data.editions[day.pin].written),"Incorrect daily point count");
      const removal=[...document.querySelectorAll(".actions a")].find(a=>a.textContent==="Map removals");
      expect(removal.href.includes(day.comparison),"Wrong pair in map link");
      const filter=$('select[aria-label="Filter module changes"]');
      filter.value="removed";filter.dispatchEvent(new Event("change"));
      expect($("tbody tr a").href.includes(day.before+"/src/") && !$("tbody tr a+a"),"Removed module links to wrong revision");
      const search=$('input[type="search"]');search.value="no-such-file/atlascase";search.dispatchEvent(new Event("input"));
      expect(!$("tbody tr"),"Path search did not filter");noOverflow();
      const proposal=data.proposals["55"];
      for(const v of [proposal.versions[0],proposal.versions.at(-1)]){
        await goto({track:"proposal",head:v.head});await until(()=>document.body.dataset.ready==="proposal" && $("tbody tr"));
        expect($(".cards strong").textContent===count(data.editions[v.head].written),"Wrong proposal head");
        expect($(".actions a").href.endsWith("pin="+v.head),"Proposal map target lost its pin");
      }
      await goto({track:"verifytask",day:"2026-11-20"});await until(()=>document.body.dataset.ready==="verifytask");
      expect(!document.body.innerText.includes("LandauLocalOf"),"Later contributor work appeared on an earlier date");
      await goto({track:"verifytask",day:"2026-11-22"});await until(()=>document.body.dataset.ready==="verifytask" && $("tbody a"));
      const vlinks=[...document.querySelectorAll("tbody tr:first-child a")].map(a=>a.href);
      expect(vlinks.length===2 && vlinks.every(s=>/\/blob\/[a-f0-9]{40}\/.*#L\d+$/.test(s)),"Missing exact contributor source link");
      noOverflow();return {page:"timeline",removed:c.removed,proposalHeads:proposal.versions.length,externalLinks:vlinks,width:innerWidth};
    }
    const choose=(h)=>goto(h,"popstate");
    await choose({pair:day.comparison,layer:"removed"});await until(()=>$("#selection button")?.textContent==="Inspect a declaration");
    expect($("#matches").textContent.includes(count(c.removed)),"Wrong removed map count");
    const browse=[...document.querySelectorAll("#selection button")].find(b=>b.textContent==="Browse matching declarations");
    browse.click();await until(()=>$("#selection h3")?.textContent.includes(" of "));
    $("#selection button.result").click();await until(()=>$("#selection a")?.textContent==="Lean before removal");
    const source=$("#selection a").href;
    expect(source.includes(day.before+"/src/") && /#L\d+$/.test(source),"Wrong removed declaration link");
    const q=new URLSearchParams(location.hash.slice(1));
    expect(q.has("row") && q.get("pair")===day.comparison,"Unshareable row link");
    await choose({pair:data.proposals["55"].comparison,layer:"added"});
    const latest=data.comparisons[data.proposals["55"].comparison];
    if(latest.added) {
      await until(()=>$("#matches").textContent.startsWith(count(latest.added)+" declarations"));
      $("#selection button").click();await until(()=>$("#selection a")?.textContent==="Lean after change");
      expect($("#selection a").href.includes(latest.after+"/src/"),"Wrong added declaration link");
    }
    const full=data.editions[day.pin];
    await choose({pin:day.pin});await until(()=>$("#matches").textContent.startsWith(count(full.written)+" declarations"));
    noOverflow();return {page:"map",row:Number(q.get("row")),source,version:day.pin,added:latest.added,width:innerWidth};
  }finally {
    history.replaceState(null,"",original);window.dispatchEvent(new Event(location.pathname.endsWith("/daily.html")?"hashchange":"popstate"));
  }
}
