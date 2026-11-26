// Both maps read these physical Git-source records and the same pinned submission cards.
import {readBytes, readURL} from "./papers.js";
import {nodeIndex, writtenRecord} from "./node-records.js";

const root = new URL("data/time-map/", document.baseURI);
const base = new URL("data/june-nodes/", document.baseURI);
const stable = new Map(), blocks = new Map();
const decoder = new TextDecoder();
const empty = () => ({total:0, rows:[]});
const valid = n => Number.isSafeInteger(n) && n >= 0;
const lower = (n, predicate) => {
  let a=0, b=n;
  while(a<b){const m=a+Math.floor((b-a)/2); if(predicate(m))b=m;else a=m+1;}
  return a;
};
function cache(map,key,load,cap=Infinity){
  if(map.has(key)){const v=map.get(key);map.delete(key);map.set(key,v);return v;}
  const value=Promise.resolve().then(load).catch(e=>{if(map.get(key)===value)map.delete(key);throw e;});
  map.set(key,value); if(map.size>cap)map.delete(map.keys().next().value);return value;
}
const json = (url,map=blocks) => cache(map,url.href,()=>readURL(url.href),map===stable?Infinity:120);
const bytes = (url) => cache(blocks,url.href,()=>readBytes(url.href),120);
const partURL = key => new URL("parts/"+key+".gz",root);
const part = key => bytes(partURL(key));
const obj = key => cache(blocks,"j:"+key,async()=>JSON.parse(decoder.decode(await part(key))),120);
export const snapshotIndex = () => json(new URL("index.json",root),stable);
async function edition(pin){
  const index=await snapshotIndex(), meta=index.snapshots.find(s=>s.pin===pin);
  if(!meta)throw Error("Unknown source revision.");
  return {index, meta, data:await obj(meta.treeData)};
}
export const snapshotStats = async pin=>(await edition(pin)).data.stats;
const bit=(view,i)=>Boolean(view[i>>>3]&(1<<(i&7)));
function expanded(pin,what,property){
  return cache(blocks,what+pin,async()=>{
    const {index,data}=await edition(pin), legacy=await nodeIndex();
    const n=what==="atlas"?legacy.atlasCount:index.baselineRows;
    const packed=new Uint8Array(await part(data[property]));
    if(packed.length!==Math.ceil(n/8))throw Error("Incomplete source presence register.");
    return Uint8Array.from({length:n},(_,i)=>Number(bit(packed,i)));
  },120);
}
export const snapshotPresence = pin =>expanded(pin,"physical","presence");
export const snapshotAtlasPresence = pin =>expanded(pin,"atlas","atlasPresence");
function view(buf,columns){
  const d=new DataView(buf), n=d.getUint32(0,true);
  if(buf.byteLength!==4+n*columns*4)throw Error("Invalid source-record block.");
  return {n,get:(k,i)=>d.getInt32(4+4*(k*n+i),true)};
}
const section=async(key,columns)=>view(await part(key),columns);
async function at(keys,index,stride,ncol){
  const key=keys[Math.floor(index/stride)]; if(!key)return null;
  const block=await section(key,ncol), i=index%stride;if(i>=block.n)return null;
  return Array.from({length:ncol},(_,k)=>block.get(k,i));
}
async function globalValue(meta,type,id){
  const block=await obj(meta.global[type][Math.floor(id/meta.stride)]);
  return block[id%meta.stride];
}
async function legacyMeta(){
  return cache(stable,"archived-bundles",async()=>{
    const groups=await json(new URL("bundles.json.gz",base));
    return groups;
  });
}
async function groupsFor(pin){
  const {index,meta,data}=await edition(pin);
  return cache(blocks,"groups:"+meta.sourceTree,async()=>{
    const [values,previous,counts]=await Promise.all([obj(index.global.bundles),legacyMeta(),section(data.bundleCounts,2)]);
    let addStart=0;
    const all=Array.from({length:counts.n},(_,no)=>{
      const [id,label,marker,originalX,originalY,topic]=values[no]??[null,null,null,null,null,null];
      const baseCount=counts.get(0,no),addedCount=counts.get(1,no);
      const g={index:no,id,label,marker,originalX,originalY,topic,written:baseCount+addedCount,baseCount,addedCount,
        baseStart:previous[no][3],baseSize:previous[no][4],addStart};
      addStart+=addedCount;return g;
    });
    return {all, byID:new Map(all.filter(g=>g.id).map(g=>[g.id,g]))};
  },120);
}
export async function snapshotBundle(pin,id){
  const g=(await groupsFor(pin)).byID.get(id);return g?.written?g:null;
}
export async function snapshotBundlesAt(pin,marker){
  return (await groupsFor(pin)).all.filter(g=>g.id && g.marker===marker && g.written>0);
}
async function renames(s){
  return cache(blocks,"ren:"+s.meta.sourceTree,async()=>{
    const map=new Map();
    for(const key of s.data.renames){const block=await section(key,2);for(let i=0;i<block.n;i++)map.set(block.get(0,i),block.get(1,i));}
    return map;
  },120);
}
async function extra(s,id) {
  const first=s.data.extraFirstIds, chunk=lower(first.length,i=>first[i]>id)-1;
  if(chunk<0)return null;const a=await section(s.data.extraCards[chunk],7);
  const i=lower(a.n,i=>a.get(0,i)>=id);
  return i<a.n&&a.get(0,i)===id?[...Array.from({length:7},(_,k)=>a.get(k,i)),chunk*s.index.stride+i]:null;
}
async function modulePath(s,i){
  if(i>=s.index.baselinePaths)return globalValue(s.index,"paths",i-s.index.baselinePaths);
  const idx=await nodeIndex(), chunk=Math.floor(i/idx.moduleStride);
  const modules=await json(new URL("modules/"+chunk+".json.gz",base));return modules[i%idx.moduleStride][0];
}
function sourceURL(s,path,line,end,col){
  const last=end>line&&col===1?end-1:end;
  return s.index.sourceURL+s.meta.pin+"/src/"+path.split("/").map(encodeURIComponent).join("/")+
    "#L"+line+(last>line?"-L"+last:"");
}
async function evidence(s,ref){
  if(!ref)return [];
  const hits=await globalValue(s.index,"evidence",ref);
  return Promise.all(hits.map(async([word,line,col])=>({name:await globalValue(s.index,"words",word),line,col,
    basis:"literal source identifier in exact, apply, refine or a declaration alias"})));
}
function boundedEvidence(card,refs){
  return refs.filter(v=>(v.line>card.line||v.line===card.line&&v.col>=card.col)&&
    (v.line<card.endLine||v.line===card.endLine&&v.col<card.endCol)).map(v=>({...v,sourceUrl:
    card.sourceUrl.split("#")[0]+"#L"+v.line}));
}
async function location(s,i){
  let values;
  if(s.index.locationEncoding==="byte-plane-relative-v1"){
    const raw=await part(s.index.global.locations[Math.floor(i/s.index.stride)]);
    const n=new DataView(raw).getUint32(0,true), u=new Uint8Array(raw,4), j=i%s.index.stride;
    if(j>=n||u.length!==32*n)throw Error("Invalid shared source coordinate block.");
    values=Array.from({length:8},(_,col)=>{
      const start=4*col*n+j;
      return u[start]|u[start+n]<<8|u[start+2*n]<<16|u[start+3*n]<<24;
    });
    values[3]+=values[1]; values[5]+=values[1]; values[6]+=values[2];
  }else values=await at(s.index.global.locations,i,s.index.stride,8);
  const [mod,line,col,endLine,endCol,selectionLine,selectionCol,ref]=values;
  const path=await modulePath(s,mod);
  return {path,module:path.slice(0,-5).replaceAll("/","."),line,col,endLine,endCol,selectionLine,selectionCol,
    sourceUrl:sourceURL(s,path,line,endLine,endCol),ref};
}
async function getStatus(s){return new Uint8Array(await part(s.data.state));}
async function info(pin,id){
  const s=await edition(pin);if(!valid(id))return null;
  if(id<s.index.baselineRows){
    const state=(await getStatus(s))[id],legacy=await writtenRecord(id);
    if(state===5)return {present:false,status:"removed",id,baseId:id,pin,kind:"written",name:legacy.name,
      sourceUrl:null,previousPin:s.index.baseline,previousSourceUrl:legacy.sourceUrl};
    const changed=state?await at(s.data.locations,id,s.index.stride,1):[-1];
    const rename=state===4?(await renames(s)).get(id):null;
    const name=rename!=null?await globalValue(s.index,"words",rename):legacy.name;
    const loc=changed?.[0]>=0?await location(s,changed[0]):{path:legacy.path,module:legacy.module,line:legacy.line,
      col:legacy.col,endLine:legacy.endLine,endCol:legacy.endCol,selectionLine:legacy.selectionLine,selectionCol:legacy.selectionCol,
      sourceUrl:sourceURL(s,legacy.path,legacy.line,legacy.endLine,legacy.endCol),ref:(await at(s.index.global.baselineRefs,id,s.index.stride,1))[0]};
    const card={kind:"written",commandKind:legacy.commandKind,present:true,id,name,pin,sourcePin:pin,baseId:id,
      status:s.index.statuses[state],sourceRangeBasis:state?"lexical command in the selected Git blob":"pinned submission command in an identical Git blob",
      marker:legacy.marker,bundle:legacy.bundle,atlas:legacy.atlas,positionBasis:s.index.bases[0],basisRow:id,
      rooted:pin===s.index.baseline?legacy.rooted:null, ...loc};
    card.references=boundedEvidence(card,await evidence(s,loc.ref));return card;
  }
  const x=await extra(s,id);if(!x)return null;
  const [,word,kind,locId,bundleNo,basis,witness,offset]=x, loc=await location(s,locId);
  const g=bundleNo>=0?(await groupsFor(pin)).all[bundleNo]:null;
  const name=await globalValue(s.index,"words",word);
  const card={kind:"written",commandKind:s.index.kinds[kind],id,name,present:true,pin,sourcePin:pin,baseId:null,
    status:"snapshot-only",sourceRangeBasis:"lexical command in the selected Git blob",
    marker:g?.marker??null,bundle:g?.id??null,atlas:null,positionBasis:s.index.bases[basis],basisRow:witness>=0?witness:null,
    rooted:null,...loc};
  card.references=boundedEvidence(card,await evidence(s,loc.ref));
  if(s.data.extraRouteTraces){
    const [trace]=await at(s.data.extraRouteTraces,offset,s.index.stride,1);
    if(trace){
      const [,label,line,distinctBundles,importedModules,alternatives,alternativeTopics]=await globalValue(s.index,"routes",trace);
      const withinPath=basis===6&&line===1&&loc.path.slice(0,-5).split("/").includes(label);
      let description=basis===3?"Archive topic " + label:withinPath?"Source module component “"+label+"”":label;
      if(basis===10||basis===11){
        const sources=importedModules?" across "+importedModules+" located project import"+(importedModules===1?"":"s"):" in this source file";
        description="Navigation via "+label+" · "+distinctBundles+" candidate bundle"+(distinctBundles===1?"":"s")+sources;
      }
      if(basis===12)description="Library-topic navigation via "+label+" · "+alternativeTopics.join(", ")+
        " ("+importedModules+" topic-bearing Mathlib import"+(importedModules===1?"":"s")+")";
      card.positionEvidence={kind:card.positionBasis,label:description,line,
        sourceUrl:card.sourceUrl.split("#")[0]+(withinPath?"":"#L"+line),witnessId:witness>=0?witness:null};
      if(alternatives)Object.assign(card.positionEvidence,{literal:label,distinctBundles,importedModules,alternativeWitnessIds:alternatives});
      if(alternativeTopics)card.positionEvidence.candidateTopics=alternativeTopics;
    }else if((basis===1||basis===2)&&witness>=0){
      const other=await snapshotRecord(pin,witness);
      if(basis===2&&other?.present){
        card.positionEvidence={kind:card.positionBasis,label:other.name,line:other.selectionLine,
          sourceUrl:other.sourceUrl.split("#")[0]+"#L"+other.selectionLine,witnessId:witness};
      }else if(basis===1&&other?.present){
        const hit=card.references.find(v=>v.name===other.name||v.name==="_root_."+other.name||
          [...card.name.split(".").slice(0,-1),v.name].join(".")===other.name);
        if(hit)card.positionEvidence={kind:card.positionBasis,label:hit.name,line:hit.line,sourceUrl:hit.sourceUrl,witnessId:witness};
      }
    }
  }
  return card;
}
export function snapshotRecord(pin,id){return cache(blocks,"rec:"+pin+"/"+id,()=>info(pin,id),120);}

async function sourceName(s,id){
  if(id<s.index.baselineRows){
    const renamed=(await renames(s)).get(id);
    if(renamed!=null)return globalValue(s.index,"words",renamed);
    const legacy=await writtenRecord(id); return legacy.name;
  }
  const x=await extra(s,id);return x?globalValue(s.index,"words",x[1]):null;
}
async function summary(s,id){
  const name=await sourceName(s,id);return {kind:"written",id,name,present:true,pin:s.meta.pin,baseId:id<s.index.baselineRows?id:null};
}

function options(o){
  const offset=o.offset??0, limit=o.limit??25;
  if(!valid(offset)||!valid(limit))throw Error("Invalid source page.");
  return {offset,limit};
}
async function archivedNames(i){
  return cache(blocks,"legacy-names:"+i,async()=>{
    const raw=await bytes(new URL("names/"+i+".bin.gz",base)), d=new DataView(raw);
    const n=d.getUint32(0,true),p=d.getUint32(4,true), refs=8+8*n, txt=refs+4*p;
    const start=new Uint32Array(n+1), first=new Uint32Array(n+1), words=new Array(n);
    for(let j=0;j<n;j++){start[j+1]=start[j]+d.getUint32(8+4*j,true);first[j+1]=first[j]+d.getUint32(8+4*n+4*j,true);}
    if(txt+start[n]!==raw.byteLength||first[n]!==p)throw Error("Invalid archive name catalogue.");
    return {n,first,ref:j=>d.getUint32(refs+4*j,true),name(j){return words[j]??=decoder.decode(new Uint8Array(raw,txt+start[j],start[j+1]-start[j]));}};
  },120);
}
async function archivedName(rank,index){
  const block=await archivedNames(Math.floor(rank/index.wordStride));return block.name(rank%index.wordStride);
}
async function baseMembers(pos,idx){
  const block=view(await bytes(new URL("members-written/"+Math.floor(pos/idx.memberStride)+".bin.gz",base)),2);
  const i=pos%idx.memberStride;return [block.get(0,i),block.get(1,i)];
}
export async function listSnapshotNodes(pin,o={}){
  if(o.foundation||o.kind==="constant")return empty();
  const {offset,limit}=options(o), s=await edition(pin), grouped=await groupsFor(pin);
  let selected;
  if(o.unplaced){selected=o.marker!=null||o.bundle!=null?[]:[grouped.all.at(-1)];}
  else if(o.bundle!=null){
    const g=grouped.byID.get(o.bundle);
    selected=g&&(o.marker==null||g.marker===o.marker)?[g]:[];
  }else selected=o.marker==null?grouped.all:grouped.all.filter(g=>g.marker===o.marker);
  const [mask,legacy,rnm]=await Promise.all([part(s.data.memberPresence).then(v=>new Uint8Array(v)),nodeIndex(),renames(s)]);
  const jobs=[];let total=0;
  for(const g of selected){
    let lo=Math.max(0,offset-total),hi=Math.min(g.baseCount,offset+limit-total);
    if(hi>lo){
      let matched=0;
      for(let pos=g.baseStart;pos<g.baseStart+g.baseSize&&matched<hi;pos++){
        if(!bit(mask,pos))continue;
        if(matched++<lo)continue;
        jobs.push((async()=>{
          const [id,rank]=await baseMembers(pos,legacy), word=rnm.get(id);
          return {kind:"written",id,name:word!=null?await globalValue(s.index,"words",word):await archivedName(rank,legacy),baseId:id,pin,present:true};
        })());
      }
    }
    total+=g.baseCount;
    lo=Math.max(0,offset-total);hi=Math.min(g.addedCount,offset+limit-total);
    for(let j=lo;j<hi;j++){
      jobs.push((async()=>{const [id]=await at(s.data.extraMembers,g.addStart+j,s.index.stride,1);return summary(s,id);})());
    }
    total+=g.addedCount;
  }
  return {total,rows:await Promise.all(jobs)};
}
function upperPrefix(s){
  for(let i=s.length-1;i>=0;i--)if(s.charCodeAt(i)<65535)return s.slice(0,i)+String.fromCharCode(s.charCodeAt(i)+1);
  return null;
}
function windowBounds(dir,q,exact){
  const high=upperPrefix(q);
  return [lower(dir.length,i=>dir[i][1]>=q),exact?lower(dir.length,i=>dir[i][0]>q):
    high==null?dir.length:lower(dir.length,i=>dir[i][0]>=high)];
}
export async function findSnapshotNodes(pin,q,o={}){
  if(o.foundation||o.kind==="constant")return empty();
  const {offset,limit}=options(o), spelling=String(q??"").trim(), fold=spelling.toLowerCase();
  if(!fold)return empty();
  const exact=o.match==="exact"||o.match==="spelling", strict=o.match==="spelling";
  const accepts=t=>exact?t===fold:t.startsWith(fold);
  const s=await edition(pin);
  const scoped=o.unplaced||o.marker!=null||o.bundle!=null;
  let byGroup, baseGroups;
  if(scoped){
    byGroup=(await groupsFor(pin)).all;
    baseGroups=new Uint16Array(await part(s.index.global.physicalBundles));
  }
  async function visible(id){
    if(!scoped)return true;
    const g=id<s.index.baselineRows?baseGroups[id]:(await extra(s,id))?.[4];
    if(o.unplaced)return g===-1&&o.marker==null&&o.bundle==null;
    if(g==null||g<0)return false;
    return (o.marker==null||byGroup[g].marker===o.marker)&&(o.bundle==null||byGroup[g].id===o.bundle);
  }
  const dir=await json(new URL("name-index.json.gz",base),stable);
  const [mask,counts]=await Promise.all([part(s.data.eligibleNames).then(b=>new Uint8Array(b)),
                                         part(s.data.lexicalCounts).then(b=>new Int32Array(b))]);
  const rows=[];let total=0;
  function add(id,name){
    if(total>=offset&&rows.length<limit)rows.push({kind:"written",id,name,baseId:id<s.index.baselineRows?id:null,pin,present:true});
    total++;
  }
  const [from,to]=windowBounds(dir,fold,exact);
  for(let j=from;j<to;j++){
    if(!counts[j])continue;
    const whole=!scoped&&!strict&&accepts(dir[j][0])&&accepts(dir[j][1]);
    if(whole&&(total+counts[j]<=offset||rows.length>=limit)){total+=counts[j];continue;}
    const block=await archivedNames(j);
    for(let i=lower(block.n,i=>block.name(i).toLowerCase()>=fold);i<block.n;i++){
      const name=block.name(i);
      if(!accepts(name.toLowerCase()))break;
      if(strict&&name!==spelling)continue;
      for(let k=block.first[i];k<block.first[i+1];k++){
        const ref=block.ref(k);
        if(ref&0x1000000)continue;
        const id=ref&0xffffff;
        if(bit(mask,id)&&(!scoped||await visible(id)))add(id,name);
      }
    }
  }
  const overlay=s.data.extraNames, [a,b]=windowBounds(overlay,fold,exact);
  for(let j=a;j<b;j++){
    const [first,last,size,key]=overlay[j],whole=!scoped&&!strict&&accepts(first)&&accepts(last);
    if(whole&&(total+size<=offset||rows.length>=limit)){total+=size;continue;}
    const values=await obj(key);
    for(const [name,id]of values){
      if(accepts(name.toLowerCase())&&(!strict||name===spelling)&&(!scoped||await visible(id)))add(id,name);
    }
  }
  return {total,rows};
}
export async function resolveSnapshot(fromPin,toPin,id){
  if(!valid(id))return {status:"unmatched",id:null,candidates:[]};
  const [from,to]=await Promise.all([edition(fromPin),edition(toPin)]);
  const source=await snapshotRecord(fromPin,id);
  if(!source?.present)return {status:"unmatched",id:null,candidates:[]};
  const target=await snapshotRecord(toPin,id);
  if(target?.present)return {status:"present",id,basis:id<from.index.baselineRows?"physical-source-correspondence":"same-snapshot-identity",candidates:[]};
  // A globally unique, qualified spelling with the same kind can expose a possible
  // new location in the same source family. Cross-family coincidences have no such implication.
  if(!source.name.includes(".")||from.meta.family!==to.meta.family)return {status:"removed",id:null,candidates:[]};
  const hits=await findSnapshotNodes(toPin,source.name,{match:"spelling",limit:20});
  const cards=await Promise.all(hits.rows.map(v=>snapshotRecord(toPin,v.id)));
  const cands=cards.filter(v=>v?.present&&v.commandKind===source.commandKind);
  if(hits.total===1&&cands.length===1&&cands[0].path===source.path)
    return {status:"present",id:cands[0].id,basis:"unique-same-path-name-and-kind",candidates:[]};
  return {status:cands.length?"ambiguous":"removed",id:null,candidates:cands.map(v=>({id:v.id,name:v.name,kind:"written"}))};
}
export async function snapshotReferences(pin,id){
  const card=await snapshotRecord(pin,id);if(!card?.present)return [];
  const namespace=card.name.split(".").slice(0,-1);
  return Promise.all(card.references.map(async entry=>{
    let queries=entry.name.startsWith("_root_.")?[entry.name.slice(7)]:[
      [...namespace,entry.name].join("."),entry.name];
    for(const q of new Set(queries)){
      const found=await findSnapshotNodes(pin,q,{match:"spelling",limit:2});
      if(found.total!==1)continue;
      const candidate=await snapshotRecord(pin,found.rows[0].id);
      if(q.includes(".")||entry.name.startsWith("_root_.")||candidate.path===card.path)
        return {...entry,targetId:candidate.id,targetName:candidate.name,relation:"unique source-name candidate"};
    }
    return {...entry,targetId:null};
  }));
}
