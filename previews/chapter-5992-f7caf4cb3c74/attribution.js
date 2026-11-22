import { bytes, json } from "./io.js";

export const refinement = "data/refinement/";
export const methodText = {
  "kernel-type": "Named constant in the exported Lean type",
  "kernel-value": "Named constants in the exported proof",
  "source-identifier": "Mathematical identifier in the written declaration",
  "namespace-context": "Mathematical context of the Lean namespace",
  "module-context": "Mathematical context of the source module",
  "source-owner": "Inherited from the enclosing written theorem",
  "source-family": "Exact source section",
};

export async function refinedPoints(file, expected, visit) {
  const view = new DataView(await bytes(refinement + file));
  if (view.byteLength !== expected * 15) throw Error("Incomplete attribution geometry");
  let previous = -1;
  for (let offset = 0; offset < view.byteLength; offset += 15) {
    const id = view.getUint32(offset, true);
    if (id <= previous) throw Error("Attribution rows are out of order");
    previous = id;
    visit(id, view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true),
      view.getUint16(offset + 12, true), view.getUint8(offset + 14));
  }
}
export async function attributionWitness(kind, id, meta) {
  const shard = await json(refinement + kind + "/" + Math.floor(id / meta.stride) + ".json.gz");
  const entry = shard[id % meta.stride];
  if (entry == null) throw Error("Missing source attribution for declaration " + id);
  return entry;
}
