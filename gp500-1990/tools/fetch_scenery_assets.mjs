// Downloads the CC0 Poly Haven source assets for the photographic scenery.
// Usage: node tools/fetch_scenery_assets.mjs <cacheDir>
// Then build the game files with tools/build_scenery_assets.py.
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.polyhaven.com/files/';
const HEADERS = { 'User-Agent': 'gp500-asset-fetch' };

const HDRI = 'alps_field';
const TEXTURES = ['asphalt_track', 'leafy_grass', 'gravelly_sand', 'concrete_wall_003', 'corrugated_iron'];
const TEXTURE_MAPS = ['Diffuse', 'nor_gl', 'Rough'];
const TREES = ['island_tree_01', 'island_tree_02', 'searsia_lucida'];

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function download(url, dest, expectedSize) {
  if (fs.existsSync(dest) && (!expectedSize || fs.statSync(dest).size === expectedSize)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`  ${path.relative(process.cwd(), dest)} ${(fs.statSync(dest).size / 1e6).toFixed(1)} MB`);
}

async function main() {
  const cache = process.argv[2];
  if (!cache) throw new Error('usage: node tools/fetch_scenery_assets.mjs <cacheDir>');

  const hdri = await getJson(API + HDRI);
  const hdr = hdri.hdri['1k'].hdr;
  await download(hdr.url, path.join(cache, 'hdri', `${HDRI}_1k.hdr`), hdr.size);
  await download(hdri.tonemapped.url, path.join(cache, 'hdri', `${HDRI}_8k.jpg`), hdri.tonemapped.size);

  for (const id of TEXTURES) {
    const files = await getJson(API + id);
    for (const map of TEXTURE_MAPS) {
      const f = files[map]['1k'].jpg;
      await download(f.url, path.join(cache, 'textures', `${id}_${map}.jpg`), f.size);
    }
  }

  for (const id of TREES) {
    const files = await getJson(API + id);
    const gltf = files.gltf['1k'].gltf;
    const dir = path.join(cache, 'trees', id);
    await download(gltf.url, path.join(dir, `${id}.gltf`), gltf.size);
    for (const [rel, inc] of Object.entries(gltf.include || {})) {
      await download(inc.url, path.join(dir, rel), inc.size);
    }
  }
  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
