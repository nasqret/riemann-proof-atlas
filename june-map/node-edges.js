import {readBytes, readURL} from "./papers.js";

const base = new URL("data/june-nodes/", document.baseURI);
const blocks = new Map();
let graph;

function inventory() {
  if (!graph) graph = readURL(new URL("graph-index.json",base).href).then(index => {
    index.available = new Set(index.blocks);
    return index;
  }).catch(error => { graph = null; throw error; });
  return graph;
}

function blockData(block, index) {
  if (blocks.has(block)) {
    const stored = blocks.get(block);
    blocks.delete(block);
    blocks.set(block,stored);
    return stored;
  }
  const path = index.template.replace("{block}",block).replace("{group}",Math.floor(block/index.groupSize));
  const pending = readBytes(new URL(path,base).href).then(buffer => {
    const view = new DataView(buffer);
    if (view.getUint32(0,false)!==0x52484a31 || view.getUint32(4,true)!==block*index.span ||
        view.getUint32(8,true)!==index.span) throw Error("Wrong dependency shard.");
    return view;
  }).catch(error => { if (blocks.get(block)===pending) blocks.delete(block); throw error; });
  blocks.set(block,pending);
  if (blocks.size>4) blocks.delete(blocks.keys().next().value);
  return pending;
}

/** Ordered outgoing references, preserving every original type, value and support flag. */
export async function constantEdges(id, {offset=0,limit=30}={}) {
  if (!Number.isSafeInteger(id) || id<0 || !Number.isSafeInteger(offset) || offset<0 ||
      !Number.isSafeInteger(limit) || limit<0) throw Error("Invalid dependency request.");
  const index = await inventory(), block = Math.floor(id/index.span);
  const result = {total:0,items:[],offset};
  if (!index.available.has(block)) return result;
  const view = await blockData(block,index);
  const header = 12+4*(id%index.span), start = 12+4*(index.span+1);
  let cursor = start+view.getUint32(header,true), lastId = 0;
  const end = start+view.getUint32(header+4,true);
  if (end>view.byteLength || cursor>end) throw Error("Invalid dependency offsets.");
  while (cursor<end) {
    let value = 0, factor = 1, byte;
    do {
      if (cursor>=end || factor>2**28) throw Error("Invalid encoded dependency.");
      byte = view.getUint8(cursor++);
      value += (byte&127)*factor;
      factor *= 128;
    } while (byte&128);
    lastId += Math.floor(value/8);
    if (result.total>=offset && result.items.length<limit) {
      const edge = {id:lastId,flags:value&7};
      if (index.frontier[lastId]) edge.frontier = index.frontier[lastId];
      result.items.push(edge);
    }
    result.total++;
  }
  return result;
}
