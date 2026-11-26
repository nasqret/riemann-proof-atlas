// Source data for two independent Lake projects in a single immutable Git commit.
import {readURL} from './papers.js?atlas=8f96d1aab28fcadc';

const origin=new URL('data/time-map/external/',document.baseURI);
const assetVersion=new URL(import.meta.url).searchParams.get('atlas');
const assetURL=name=>{const url=new URL(name,origin);if(assetVersion)url.searchParams.set('atlas',assetVersion);return url.href;};
const stable=new Map(), shards=new Map();
const empty=()=>({rows:[],total:0});
const caches=(map,key,loader,limit=Infinity)=>{
  if(map.has(key)){const old=map.get(key);map.delete(key);map.set(key,old);return old;}
  const item=Promise.resolve().then(loader).catch(error=>{if(map.get(key)===item)map.delete(key);throw error;});
  map.set(key,item);if(map.size>limit)map.delete(map.keys().next().value);return item;
};
const file=(name,persistent=false)=>caches(persistent?stable:shards,name,()=>readURL(assetURL(name)),persistent?Infinity:60);
export const externalIndex=()=>file('index.json',true);
async function edition(key){const ix=await externalIndex(), s=ix.snapshots.find(r=>r.pin===key);if(!s)throw Error('Unknown Sernau edition.');return s;}
export async function externalStats(key){return file((await edition(key)).edition+'/stats.json',true);}
async function history(s){return caches(stable,'history:'+s.edition,async()=>{
  const values=await file(s.edition+'/history.json.gz',true),ids=new Map();
  for(const [historical,id,base] of values){ids.set(historical,id);if(base!=null)ids.set(base,id);}return {values,ids};
});}
async function canonical(s,id){
  if(!Number.isSafeInteger(id)||id<0)return null;
  if(id>=s.startID&&id<s.startID+s.counts.written)return id;
  return (await history(s)).ids.get(id)??null;
}
const selectors={grh:'sernau-grh-72fead102f66','grh-compact':'sernau-compact-72fead102f66'};
const other=s=>selectors[s.edition==='grh'?'grh-compact':'grh'];
const dataFor=(s,name,persistent=false)=>file(s.edition+'/'+name,persistent);
async function raw(s,id){const i=id-s.startID, ix=await externalIndex();if(i<0||i>=s.counts.written)return null;
  return (await dataFor(s,'cards/'+Math.floor(i/ix.stride)+'.json.gz'))[i%ix.stride];}
async function pathFor(s,i){return (await dataFor(s,'modules.json.gz',true))[i];}
function source(s,path,line,end=line,endCol=2){const last=end>line&&endCol===1?end-1:end;
  return s.sourceURL+path.split('/').map(encodeURIComponent).join('/')+'#L'+line+(last>line?'-L'+last:'');}
async function register(s){return caches(stable,'register:'+s.edition,async()=>{
  const [ix,stats,dir,groups,old]=await Promise.all([externalIndex(),externalStats(s.pin),dataFor(s,'directory.json.gz',true),file('groups.json.gz',true),history(s)]);
  const all=[],byID=new Map(),groupByN=new Map();
  for(const [key,count] of Object.entries(stats.bundleCounts)){
    const n=Number(key);if(n<0)continue;const [id,label,marker,originalX,originalY,topic]=groups[key];
    const g={id,label,index:n,marker,originalX,originalY,topic,written:count,baseCount:0,addedCount:count};all.push(g);byID.set(id,g);groupByN.set(n,g);
  }
  const physical=new Map(old.values.filter(v=>v[2]!=null).map(v=>[v[1],[v[2],v[3]]]));
  const n=s.counts.written, names=new Array(n),groupNos=new Int32Array(n),markers=new Int16Array(n).fill(-1),ranks=new Uint32Array(n),totals=new Uint32Array(ix.anchors.length);
  for(const [name,i,g] of dir){names[i]=name;groupNos[i]=g;if(g>=0)markers[i]=groupByN.get(g).marker;}
  for(let i=0;i<n;i++)if(markers[i]>=0)ranks[i]=totals[markers[i]]++;
  const centers=ix.anchors.map(a=>({june:[a.june.x,a.june.y],original:[a.original.x,a.original.projectedY]}));
  const radii=centers.map((c,i)=>Object.fromEntries(['june','original'].map(plane=>{
    const near=Math.min(...centers.map((other,j)=>j===i?Infinity:Math.hypot(other[plane][0]-c[plane][0],other[plane][1]-c[plane][1])).filter(v=>v>0));
    return [plane,Math.min(plane==='june'?.5:.14,near*.18)];
  })));
  return {dir,all,byID,groupByN,names,groupNos,markers,ranks,totals,centers,radii,physical};
});}
function coordinates(s,table,i){
  const marker=table.markers[i];if(marker<0)return null;
  const rank=table.ranks[i],a=2.399963229728653*rank+(s.edition==='grh'?0:1.2),u=Math.sqrt((rank+.5)/table.totals[marker]);
  const d=s.edition==='grh'?.06+.53*u:.62+.36*u,c=table.centers[marker],w=table.radii[marker];
  const point=plane=>[c[plane][0]+w[plane]*d*Math.cos(a),c[plane][1]+w[plane]*d*Math.sin(a)];
  return {basis:'deterministic paper-centered display position',june:point('june'), original:point('original'),anchorJune:c.june,anchorOriginal:c.original};
}
export async function externalMapPoints(key){const s=await edition(key);return caches(stable,'points:'+s.edition,async()=>{
  const t=await register(s),points=[];
  for(let i=0;i<s.counts.written;i++){
    const c=coordinates(s,t,i);if(!c)continue;const id=s.startID+i,[baseId,atlas]=t.physical.get(id)??[null,null];points.push({id,marker:t.markers[i],baseId,atlas,june:c.june,original:c.original});
  }return points;
});}
export async function externalBundle(key,id){return (await register(await edition(key))).byID.get(id)??null;}
export async function externalBundlesAt(key,marker){return (await register(await edition(key))).all.filter(g=>g.marker===marker);}
async function evidence(s,row,path,ix){
  const basis=ix.placementBases[row[10]],tr=row[11];if(!row[10]||!tr)return null;
  if(tr[0]==='git-tree')return {kind:basis,label:'Identical Git source tree in the community register · '+tr[2],sourceUrl:source(s,path,row[7]),line:row[7],witnessId:tr[3],historicBasis:tr[2],historicalPin:tr[1]};
  if(tr[0]==='readable-counterpart'){
    const peer=await edition(selectors.grh),r=await raw(peer,tr[1]),p=await pathFor(peer,r[2]);
    return {kind:basis,label:'Corresponding readable declaration '+r[0]+' · '+tr[2],sourceUrl:source(peer,p,r[7]),line:r[7],counterpartId:tr[1],counterpartSelector:peer.pin,historicBasis:tr[2],witnessId:null};
  }
  const [what,literal,line,detail,count]=tr;
  const local=what==='same source file'||what==='project import'||what==='explicit source name';
  return {kind:basis,literal,label:what+' · '+literal+(local&&count>1?' · '+count+' candidate bundles':''),line,sourceUrl:source(s,path,line),witnessId:local?detail:null,
    ...(local?{distinctBundles:count}: {topic:detail})};
}
export async function externalRecord(key,input){const s=await edition(key),id=await canonical(s,input);if(id==null)return null;
  return caches(shards,'record:'+key+':'+id,async()=>{
    const [r,ix,t]=await Promise.all([raw(s,id),externalIndex(),register(s)]),path=await pathFor(s,r[2]);
    const g=t.groupByN.get(r[9]),ev=await evidence(s,r,path,ix);
    const refs=r[17].map(([targetId,name,line,col])=>({name,line,col,targetId,targetName:t.names[targetId-s.startID],sourceUrl:source(s,path,line),basis:ix.referenceBasis,relation:'unique source-name candidate'}));
    return {kind:'written',commandKind:r[1],name:r[0],id,baseId:r[13],atlas:r[14],historicalId:r[12],counterpartId:r[15],candidateCounterpartId:r[16],counterpartSelector:other(s),pin:key,sourcePin:s.sourcePin,present:true,
      status:s.edition==='grh'?'external-readable-source':'external-compact-source',rooted:null,sourceRangeBasis:'physical command in the pinned Git blob',positionBasis:ix.placementBases[r[10]],basisRow:ev?.witnessId??null,positionEvidence:ev,
      marker:g?.marker??null,bundle:g?.id??null,coordinates:coordinates(s,t,id-s.startID),module:path.slice(0,-5).replaceAll('/','.'),path,sourcePath:s.sourcePrefix+path,
      line:r[3],col:r[4],endLine:r[5],endCol:r[6],selectionLine:r[7],selectionCol:r[8],sourceUrl:source(s,path,r[3],r[5],r[6]),references:refs};
  },60);
}
export async function externalReferences(key,id){return (await externalRecord(key,id))?.references??[];}
async function presence(key,atlas){const s=await edition(key);return caches(stable,'presence:'+s.edition+':'+atlas,async()=>{
  const ix=await externalIndex(), mask=new Uint8Array(atlas?ix.atlasCount:ix.baselineRows),{values}=await history(s);
  for(const row of values){const p=atlas?row[3]:row[2];if(p!=null)mask[p]=1;}return mask;
});}
export const externalPresence=key=>presence(key,false);
export const externalAtlasPresence=key=>presence(key,true);
async function query(key,q,o){
  if(o.foundation||o.kind==='constant')return empty();const s=await edition(key),t=await register(s);
  const offset=o.offset??0,limit=o.limit??25;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<0)throw Error('Invalid source page.');
  const group=o.bundle!=null?t.byID.get(o.bundle):null;if(o.bundle!=null&&!group)return empty();
  const rows=[];let total=0;
  for(const [name,i,g] of t.dir){
    if(o.unplaced&&(g>=0||o.marker!=null||group)||!o.unplaced&&(o.marker!=null&&t.markers[i]!==o.marker||group&&g!==group.index))continue;
    if(q!=null){const fold=q.toLowerCase(),w=name.toLowerCase();if(o.match==='spelling'?name!==q:o.match==='exact'?w!==fold:!w.startsWith(fold))continue;}
    if(total++>=offset&&rows.length<limit){const id=s.startID+i;rows.push({kind:'written',id,name,baseId:t.physical.get(id)?.[0]??null,pin:key,present:true});}
  }return {rows,total};
}
export const listExternalNodes=(key,o={})=>query(key,null,o);
export const findExternalNodes=(key,q,o={})=>String(q??'').trim()?query(key,String(q).trim(),o):Promise.resolve(empty());
export async function resolveExternal(from,to,id,old={}){
  const ix=await externalIndex(),f=ix.snapshots.find(s=>s.pin===from),t=ix.snapshots.find(s=>s.pin===to);
  const uncertain=(status='removed',candidates=[])=>({status,id:null,candidates});
  if(!f&&!t)return old.resolve?old.resolve(from,to,id):uncertain('unmatched');
  if(f){const src=await externalRecord(from,id);if(!src)return uncertain('unmatched');
    if(from===to)return {status:'present',id:src.id,basis:'same external source record',candidates:[]};
    if(t){
      if(src.counterpartId!=null)return {status:'present',id:src.counterpartId,basis:'unique source command or same-file declaration name and kind',candidates:[]};
      if(src.candidateCounterpartId!=null){const next=await externalRecord(to,src.candidateCounterpartId);return uncertain('ambiguous',[{id:next.id,name:next.name,kind:'written'}]);}
      return uncertain();
    }
    if(src.historicalId==null)return uncertain();
    if(to===ix.historicSourcePin)return {status:'present',id:src.historicalId,basis:'verified community source-tree correspondence',candidates:[]};
    if(old.resolve)return old.resolve(ix.historicSourcePin,to,src.historicalId);
    const dst=await old.record?.(to,src.historicalId);return dst?.present?{status:'present',id:dst.id,basis:'historical written correspondence',candidates:[]}:uncertain();
  }
  let historical=id;
  if(from!==ix.historicSourcePin&&old.resolve){const match=await old.resolve(from,ix.historicSourcePin,id);if(match.status!=='present')return uncertain();historical=match.id;}
  else if(from!==ix.historicSourcePin){const card=await old.record?.(from,id);if(!card?.present)return uncertain('unmatched');}
  const out=(await history(t)).ids.get(historical);return out!=null?{status:'present',id:out,basis:'verified community source-tree correspondence',candidates:[]}:uncertain();
}
