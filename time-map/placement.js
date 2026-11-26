import {readBytes, readURL} from "../june-map/papers.js";
import {constantSummary, findNodes, writtenRecord} from "../june-map/node-records.js";

const root = new URL("../data/time-map/placement/", import.meta.url);
const cache = new Map();
const word = n => Number.isSafeInteger(n) && n >= 0;
const empty = () => ({total: 0, rows: []});
function read(path, binary = false) {
  if (cache.has(path)) {
    const pending = cache.get(path); cache.delete(path); cache.set(path, pending); return pending;
  }
  const url = new URL(path, root).href;
  const pending = (binary ? readBytes(url) : readURL(url)).catch(error => { if (cache.get(path) === pending) cache.delete(path); throw error; });
  cache.set(path, pending);
  if (cache.size > 128) cache.delete(cache.keys().next().value);
  return pending;
}
export async function placementIndex() {return read("index.json");}
const okPin = (index, pin) => pin == null || pin === index.pin;
const get = (data, offset) => data.getInt32(offset, true);
function lower(n, predicate) {
  let a = 0, b = n;
  while (a < b) {const m = Math.floor((a+b)/2); if (predicate(m)) b=m; else a=m+1;}
  return a;
}
function basic(index, kind, id, marker, route, rooted) {
  const status = route === 7 ? "foundation" : route === 6 ? "unpositioned" : "plotted";
  return {kind, id, pin: index.pin, status, plotted: status === "plotted", marker: index.anchors[marker]?.id ?? null,
    markerIndex: marker >= 0 ? marker : null, route: index.routes[route], rooted};
}
export async function writtenPlacement(id, {pin} = {}) {
  const index = await placementIndex();
  if (!okPin(index,pin) || !word(id) || id >= index.counts.all.written) return null;
  const [markers, routes, mask] = await Promise.all(["written-anchor.u8.gz", "written-route.u8.gz", "written-rh.bits.gz"].map(p => read(p,true)));
  const m = new Uint8Array(markers)[id], r = new Uint8Array(routes)[id], rooted = !!(new Uint8Array(mask)[id >> 3] & 1 << (id % 8));
  return {...basic(index, "written", id, m, r, rooted), support: null};
}
export async function constantPlacement(id, {pin} = {}) {
  const index = await placementIndex();
  if (!okPin(index,pin) || !word(id)) return null;
  const part = lower(index.firstConstantIds.length, i => index.firstConstantIds[i] > id) - 1;
  if (part < 0) return null;
  const d = new DataView(await read("assignments/" + part + ".bin.gz", true)), n = d.getUint32(0,true);
  if (d.byteLength !== 4 + n*4*index.fields.length) throw Error("Incomplete pinned placement block.");
  const i = lower(n, i => get(d,4+4*i)>=id);
  if (i===n || get(d,4+4*i)!==id) return null;
  const c = Object.fromEntries(index.fields.map((field,j) => [field, get(d,4+4*(j*n+i))]));
  const result = basic(index,"constant",id,c.marker,c.route,!!c.rooted);
  result.depth=c.depth; result.runnerUp=index.anchors[c.runner]?.id ?? null;
  result.witnessOwner=c.witnessOwner>=0 ? c.witnessOwner : null; result.via=c.via>=0 ? c.via : null;
  result.edgeFlags=c.edgeFlags; result.direction=c.direction===1 ? "used-by" : c.direction===2 ? "uses" : null;
  result.compilerOnPath=!!c.compilerOnPath; result.ambiguousOnPath=!!c.ambiguousOnPath;
  result.support = (c.route>=3 && c.route<=5 || c.route===8) ? {depth:c.depth,winningOwners:c.winnerOwners,distinctOwners:c.allOwners,
    winningScore:c.winnerScore,runnerScore:c.runnerScore,totalScore:c.totalScore,candidatePapers:c.candidatePapers,tiedPapers:c.tiedPapers} : null;
  return result;
}
export async function placementMembers(markerId, {kind="constant",scope="all",offset=0,limit=25,pin}={}) {
  const index=await placementIndex();
  if (!okPin(index,pin) || !["constant","written"].includes(kind) || !["all","rh"].includes(scope) || !word(offset)||!word(limit)) return empty();
  const group=markerId==="unpositioned" || markerId==="unplaced" ? index.anchors.length : markerId==="foundation" ? index.anchors.length+1 : index.anchors.findIndex(a=>a.id===markerId);
  if (group<0) return empty();
  const extent=index.members[kind][group], total=extent[scope], items=[];
  for (let pos=extent.start+offset;pos<extent.start+Math.min(total,offset+limit);pos++) items.push(pos);
  const rows=await Promise.all(items.map(async pos=>{
    const values=new DataView(await read("members-"+kind+"/"+Math.floor(pos/index.memberStride)+".bin.gz",true));
    const packed=values.getUint32(4*(pos%index.memberStride),true),id=packed&0xffffff;
    const card=kind==="constant" ? await constantSummary(id) : await writtenRecord(id);
    return {kind,id,name:card.name,rooted:!!(packed & (1<<24)),status:group<index.anchors.length?"plotted":group===index.anchors.length?"unpositioned":"foundation",marker:index.anchors[group]?.id??null};
  }));
  return {total,rows};
}
export async function findPlaced(query,{status="all",scope="all",kind="both",offset=0,limit=25,match="prefix",pin}={}) {
  const index=await placementIndex(),text=String(query??"").trim(),prefix=text.toLowerCase();
  if (!okPin(index,pin)||!prefix||!["all","rh"].includes(scope)||!["all","plotted","unpositioned","foundation"].includes(status)||!word(offset)||!word(limit)) return empty();
  const options={scope,kind,offset,limit,match};
  const enrich = rows => Promise.all(rows.map(async row => {
    const placement = row.kind === "constant" ? await constantPlacement(row.id) : await writtenPlacement(row.id);
    return {...row, ...placement, unplaced: !placement?.plotted};
  }));
  if (status==="all") {const page=await findNodes(text,options);return {total:page.total,rows:await enrich(page.rows)};}
  const records=kind==="written"?[]:await read("exceptions.json.gz");
  const exceptions=records.filter(([name,id,route,rooted])=>(scope!=="rh"||rooted)&&(match==="spelling"?name===text:match==="exact"?name.toLowerCase()===prefix:name.toLowerCase().startsWith(prefix)));
  if (status==="foundation"||status==="unpositioned") {
    const code=status==="foundation"?7:6, chosen=exceptions.filter(r=>r[2]===code);
    return {total:chosen.length,rows:chosen.slice(offset,offset+limit).map(([name,id,,rooted])=>({name,id,kind:"constant",rooted,status,plotted:false,marker:null}))};
  }
  if (!exceptions.length) {const page=await findNodes(text,options);return {total:page.total,rows:await enrich(page.rows)};}
  const omit=new Set(exceptions.map(row=>row[1])), rows=[];
  // Begin at a safe offset using the fact that at most exceptions.length raw
  // rows are removed. Count omissions before the boundary by their folded name.
  const initial=await findNodes(text,{...options,offset:Math.min(offset,Math.max(0,offset-exceptions.length)),limit:1});
  const total=initial.total-exceptions.length;
  if (!initial.rows.length||offset>=total||!limit) return {total,rows};
  let rawOffset=Math.max(0,offset-exceptions.length), kept=rawOffset;
  const firstName=initial.rows[0].name.toLowerCase();
  if (rawOffset>0) {
    // Names equal after folding may have several postings. Retreat to the start
    // of that spelling before counting the preceding exceptional records.
    let a=0,b=rawOffset;
    while (a<b) {const m=Math.floor((a+b)/2), one=await findNodes(text,{...options,offset:m,limit:1});
      if (one.rows[0].name.toLowerCase()<firstName) a=m+1; else b=m;}
    rawOffset=a;kept=a-exceptions.filter(row=>row[0].toLowerCase()<firstName).length;
  }
  while (rows.length<limit && rawOffset<initial.total) {
    const page=await findNodes(text,{...options,offset:rawOffset,limit:Math.max(48,Math.min(256,offset+limit-kept+exceptions.length))});
    if (!page.rows.length) break;
    rawOffset+=page.rows.length;
    for (const row of page.rows) {
      if (row.kind==="constant"&&omit.has(row.id)) continue;
      if (kept++>=offset && rows.length<limit) rows.push(row);
    }
  }
  return {total,rows:await enrich(rows)};
}
