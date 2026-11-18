# Photographic scenery (`assets/scenery/`)

Loaded by [`scenery.js`](../../scenery.js) on top of the procedural track scene. If any file fails to load (or in Node tests) the procedural sky, ground, mountains and trees stay.

| File | Use |
| --- | --- |
| `sky_band.jpg` | Upper 53% of the `alps_field` panorama, mapped on the sky dome (real mountains and sky) |
| `env.hdr` | 1k `alps_field` HDR for reflections and image-based lighting |
| `asphalt_*`, `grass_*`, `gravel_*` | Track, lawn (recolored `leafy_grass`) and gravel trap textures: diffuse, normal (GL), roughness |
| `concrete_*`, `metal_*` | Pit/tower concrete, grandstand bases and corrugated roofs |
| `tree_*.webp` | Two orthographic views per tree, rendered in Blender, for crossed-quad billboards |
| `scenery.json` | Sun position in the panorama, tree sizes, file list |

## Rebuilding

```text
node tools/fetch_scenery_assets.mjs <cache>
blender -b --factory-startup -P tools/build_scenery_assets.py -- <cache> assets/scenery
```

## Sources

All from [Poly Haven](https://polyhaven.com), licensed [CC0](https://creativecommons.org/publicdomain/zero/1.0/): HDRI `alps_field`; textures `asphalt_track`, `leafy_grass`, `gravelly_sand`, `concrete_wall_003`, `corrugated_iron`; models `island_tree_01`, `island_tree_02`, `searsia_lucida`.
