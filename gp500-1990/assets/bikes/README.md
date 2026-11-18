# GLB Motorcycle Model (`assets/bikes/`)

The race bikes use one shared works-bike model, `gp500_works.glb`, repainted per team:

- `gp500_works.glb` — model with the **Akagi** livery embedded (Draco-compressed).
- `livery_shiden.jpg`, `livery_kaze.jpg`, `livery_corsa.jpg` — the other teams' paint, swapped onto the `livery_paint` material at runtime.

If the model fails to load (or in Node tests), [`models.js`](../../models.js) keeps the procedural bike.

## Model structure (required by `models.js`)

Authored in the rig frame: `+X` forward, `+Y` up, axle midpoint at the origin, tyres on `y = 0`, wheelbase 1.40 m.

- `body` — everything that does not rotate.
- `wheel_front`, `wheel_rear` — tyre + rim, pivot on the axle; spun around local `Z`.
- `seat_anchor` — lowest point of the seat; the procedural rider is placed relative to it.
- Material `livery_paint` — the painted bodywork.

## Rebuilding

```text
blender -b --factory-startup -P tools/prepare_bike_glb.py -- <source.glb> assets/bikes
```

The script normalizes the source model, erases third-party logos and sponsor text from its textures, repaints the bodywork in each team's `colorPrimary` (from `bikes.js`), rebuilds the materials as metallic-roughness PBR, splits the wheels and exports the files above.

## Enabling

`ENABLE_GLB` lists bike IDs that use the model (`all` for every bike, `none` to turn it off). `?glb=0` / `?glb=1` in the URL overrides it.

```text
ENABLE_GLB: all
```

## Credits

Based on **"SuperGP v1"** by **SuperBiker (Taisho)** — https://sketchfab.com/3d-models/supergp-v1-7470a25431404034ab7521135eada178 — licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Changes: logos and sponsor graphics removed, bodywork repainted in fictional team liveries, materials rebuilt, wheels separated, rescaled and re-exported.
