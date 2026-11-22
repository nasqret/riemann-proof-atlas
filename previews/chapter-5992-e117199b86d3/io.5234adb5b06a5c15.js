const memo = new Map();
export async function bytes(url) {
  const inherited = typeof url === "string" && url.startsWith("data/") && url !== "data/refinement/index.json";
  const response = await fetch(inherited ? new URL("../../" + url, import.meta.url) : url);
  if (!response.ok)
    throw new Error("Could not read " + url + " (" + response.status + ")");
  const data = await response.arrayBuffer();
  const head = new Uint8Array(data, 0, Math.min(2, data.byteLength));
  if (head[0] === 31 && head[1] === 139) {
    const stream = new Blob([data])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }
  return data;
}
export function json(url) {
  if (!memo.has(url))
    memo.set(
      url,
      bytes(url)
        .then((b) => JSON.parse(new TextDecoder().decode(b)))
        .catch((e) => {
          memo.delete(url);
          throw e;
        }),
    );
  return memo.get(url);
}
