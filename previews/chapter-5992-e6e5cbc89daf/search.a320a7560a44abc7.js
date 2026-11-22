import { json } from "./data.d84f1970349759e8.js";
let index,
  boot,
  pools = [],
  ticket = 0;
const normalize = (s) => s.normalize("NFKC").toLowerCase();
async function start() {
  index = await json("data/lean/index.json");
  // Limit simultaneous fetches so exact-source clicks stay responsive.
  pools = Array(index.nameShards);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, index.nameShards) }, async () => {
      while (next < index.nameShards) {
        const id = next++;
        pools[id] = (await json("data/lean/names/" + id + ".json.gz")).map(
          normalize,
        );
      }
    }),
  );
}
self.onmessage = async ({ data }) => {
  const me = ++ticket;
  try {
    if (!boot)
      boot = start().catch((e) => {
        boot = null;
        throw e;
      });
    await boot;
    if (me !== ticket) return;
    const q = normalize(data.q.trim()),
      bits = q.split(/\s+/).filter(Boolean);
    const exact = [],
      prefix = [],
      other = [];
    for (let s = 0; s < pools.length; s++) {
      const names = pools[s];
      for (let k = 0; k < names.length; k++) {
        const name = names[k];
        if (bits.every((b) => name.includes(b))) {
          const dest =
            name === q
              ? exact
              : name.startsWith(q) || name.endsWith("." + q)
                ? prefix
                : other;
          dest.push(s * index.nameStride + k);
        }
      }
    }
    const ids = Uint32Array.from(exact.concat(prefix, other));
    self.postMessage({ q: data.q, results: ids }, [ids.buffer]);
  } catch (e) {
    if (me === ticket) self.postMessage({ q: data.q, error: e.message });
  }
};
