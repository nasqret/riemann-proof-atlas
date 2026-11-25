// The page is mounted at june-map.html in the site root, including project Pages mounts.
const dataBase = new URL("data/june-map/", document.baseURI);
export const dataURL = (path) => new URL(path, dataBase).href;

export const readJSON = path => readURL(dataURL(path));

async function checked(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Could not read ${new URL(url).pathname.split("/").pop()} (HTTP ${response.status}).`);
  return response;
}
export async function readBytes(url) {
  const response = await checked(url);
  const file = await response.arrayBuffer();
  const head = new Uint8Array(file, 0, Math.min(2, file.byteLength));
  if (head[0] !== 31 || head[1] !== 139) return file;
  const stream = new Blob([file]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}
export async function readURL(url) {
  if (!new URL(url).pathname.endsWith(".gz")) return (await checked(url)).json();
  return JSON.parse(new TextDecoder().decode(await readBytes(url)));
}

export function paperURL(id) {
  return /^(?:\d{4}\.\d{4,5}|[a-z0-9.\-]+\/\d{7})(?:v\d+)?$/i.test(id)
    ? "https://arxiv.org/abs/" + id : null;
}

const decode = string => Uint8Array.from(atob(string), c => c.charCodeAt(0));

export class PaperShards {
  constructor(spec, world, categories = []) {
    this.spec = spec;
    this.world = world;
    this.categories = categories;
    this.cache = new Map();
  }
  async index() {
    if (!this.pending) {
      this.pending = readJSON(this.spec.index).then(({leaves}) => {
        const [xmin, ymin, xmax, ymax] = this.world;
        return leaves.map(([z, x, y, count]) => {
          const side = (xmax - xmin) / 2 ** z;
          return {z, x, y, count, key: [z, x, y].join("/"),
            bbox: [xmin + x * side, ymax - (y + 1) * side, xmin + (x + 1) * side, ymax - y * side]};
        });
      }).catch(error => { this.pending = null; throw error; });
    }
    return this.pending;
  }
  async intersect(box) {
    return (await this.index()).filter(({bbox}) =>
      bbox[2] >= box[0] && bbox[0] <= box[2] && bbox[3] >= box[1] && bbox[1] <= box[3]);
  }
  read(leaf) {
    const cached = this.cache.get(leaf.key);
    if (cached) {
      this.cache.delete(leaf.key);
      this.cache.set(leaf.key, cached);
      return cached;
    }
    const path = this.spec.template.replace("{z}", leaf.z).replace("{x}", leaf.x).replace("{y}", leaf.y);
    const result = readJSON(path).then(({papers, xy, rows, levels, categoryCodes}) => {
      const points = new DataView(decode(xy).buffer);
      const sourceRows = new DataView(decode(rows).buffer);
      const codes = levels ? new DataView(decode(levels).buffer) : null;
      const category = categoryCodes ? decode(categoryCodes) : null;
      if (points.byteLength !== papers.length * 8 || sourceRows.byteLength !== papers.length * 4 || papers.length !== leaf.count ||
        (codes && codes.byteLength !== papers.length * 18) || (category && category.length !== papers.length))
        throw Error("Paper shard counts disagree.");
      return papers.map(([id, title], index) => ({
        id, title, row: sourceRows.getUint32(index * 4, true),
        x: points.getFloat32(8 * index, true), y: points.getFloat32(8 * index + 4, true),
        category: category?.[index] ? this.categories[category[index]] : null,
        levels: codes ? Array.from({length: 9}, (_, level) => codes.getUint16(index * 18 + 2 * level, true)) : null
      }));
    }).catch(error => { this.cache.delete(leaf.key); throw error; });
    this.cache.set(leaf.key, result);
    while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value);
    return result;
  }
  async lookup(row, x, y) {
    const epsilon = (this.world[2] - this.world[0]) * 1e-8;
    const leaves = await this.intersect([x - epsilon, y - epsilon, x + epsilon, y + epsilon]);
    for (const leaf of leaves) {
      const paper = (await this.read(leaf)).find(paper => paper.row === row &&
        Math.abs(paper.x - x) <= epsilon && Math.abs(paper.y - y) <= epsilon);
      if (paper) return paper;
    }
    return null;
  }
  async inBox(box, limit = Infinity) {
    const leaves = await this.intersect(box);
    if (leaves.reduce((sum, leaf) => sum + leaf.count, 0) > limit) return [];
    const papers = [];
    let next = 0;
    const worker = async () => {
      while (next < leaves.length) {
        const leaf = leaves[next++];
        for (const paper of await this.read(leaf)) {
          if (paper.x >= box[0] && paper.x <= box[2] && paper.y >= box[1] && paper.y <= box[3]) papers.push(paper);
        }
      }
    };
    await Promise.all(Array.from({length: Math.min(4, leaves.length)}, worker));
    return papers;
  }
}
