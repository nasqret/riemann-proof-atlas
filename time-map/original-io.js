// Original geometry arrives in successive batches. Start each batch while this page is painting.
const documents = new Map();
let active = true;
let frame = null;
let pending = [];

function schedule() {
  if (frame !== null || !active || document.hidden || !pending.length) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    if (!active || document.hidden) return;
    const batch = pending;
    pending = [];
    for (const start of batch) start();
  });
}
window.addEventListener("pagehide", () => {
  active = false;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
});
window.addEventListener("pageshow", () => {
  active = true;
  schedule();
});
document.addEventListener("visibilitychange", schedule);

function fetchOnMap(url) {
  return new Promise((resolve, reject) => {
    pending.push(() => {
      try {
        resolve(fetch(url));
      } catch (error) {
        reject(error);
      }
    });
    schedule();
  });
}

export async function bytes(url) {
  const response = await fetchOnMap(url);
  if (!response.ok) throw Error("Could not read " + url + " (" + response.status + ")");
  const buffer = await response.arrayBuffer();
  const data = new Uint8Array(buffer);
  if (data[0] !== 31 || data[1] !== 139) return buffer;
  // Keep the downloaded bytes in memory when WebKit retires the originating document.
  const compressed = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  return new Response(compressed.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

export function json(url) {
  if (!documents.has(url)) {
    const request = bytes(url)
      .then((buffer) => JSON.parse(new TextDecoder().decode(buffer)))
      .catch((error) => {
        documents.delete(url);
        throw error;
      });
    documents.set(url, request);
  }
  return documents.get(url);
}
