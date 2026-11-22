import { bytes, json } from "./io.js";

const bundled = "data/daily/";
const remote = "https://raw.githubusercontent.com/nasqret/riemann-proof-atlas/atlas-daily/";
let live;
async function readLive() {
  const control = new AbortController();
  const timeout = setTimeout(() => control.abort(), 3800);
  try {
    const response = await fetch(remote + "index.json", {signal:control.signal, cache:"no-cache"});
    if (!response.ok) throw Error("Daily feed HTTP "+response.status);
    const data = await response.json();
    if (data.schema !== 1 || !data.days.length || data.repository !== "leanprover-community/riemann-hypothesis")
      throw Error("Unexpected daily feed");
    return data;
  } finally { clearTimeout(timeout); }
}
export function localFeed() { return json(bundled+"index.json"); }
export async function dailyFeed() {
  if (!live) live = Promise.allSettled([localFeed(),readLive()]).then(([local,net]) => {
    if (net.status === "fulfilled" && (local.status !== "fulfilled" || net.value.capturedAt > local.value.capturedAt))
      return {data:net.value, root:remote, fallback:local.status === "fulfilled" ? local.value : null};
    if (local.status !== "fulfilled") throw Error("The daily archive is unavailable.");
    return {data:local.value,root:bundled,fallback:null};
  });
  return live;
}
export function sourceFile(repository, commit, path, line) {
  const pathPart = path.split("/").map(encodeURIComponent).join("/");
  return "https://github.com/"+repository+"/blob/"+commit+"/src/"+pathPart+(line ? "#L"+line : "");
}
export async function dailyAsset(feed,path,loader=json) {
  // Content addressed edition and pair paths can safely fall back to the bundled capture.
  try { return await loader(feed.root+path); }
  catch(error) {
    if (feed.root === bundled) throw error;
    return loader(bundled+path);
  }
}
export async function ledger(feed,key) {
  const meta = feed.data.comparisons[key];
  if (!meta) throw Error("This comparison is missing from the archive.");
  const data = await dailyAsset(feed,meta.asset);
  if (data.before !== meta.before || data.after !== meta.after ||
      data.removed.length !== meta.removed || data.added.length !== meta.added || data.moved.length !== meta.moved)
    throw Error("The change ledger differs from its manifest.");
  return data;
}
export function mapLink({pin, pair, layer, row, subject}) {
  const h = new URLSearchParams();
  for (const [key,value] of Object.entries({pin,pair,layer,row,subject}))
    if (value !== undefined && value !== null) h.set(key,value);
  return "editions.html#"+h;
}
export const editionBytes = (feed,path) => dailyAsset(feed,path,bytes);
