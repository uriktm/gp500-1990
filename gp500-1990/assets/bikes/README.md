# Optional GLB Motorcycle Models (`assets/bikes/`)

By default, **500cc Grand Prix '90** builds high-detail procedural 1990s 500cc 2-stroke Grand Prix motorcycles and articulated riders in [`models.js`](../../models.js) with canvas-generated team liveries from [`livery.js`](../../livery.js).

You can optionally drop custom `.glb` (glTF 2.0 binary) motorcycle models into this folder (`assets/bikes/<bikeId>.glb`) to replace the procedural bike body.

## Supported Bike IDs

Place one or more `.glb` files in `assets/bikes/` matching the roster IDs in [`bikes.js`](../../bikes.js):

- `assets/bikes/akagi.glb` — **Akagi V4-500 (#1)**
- `assets/bikes/shiden.glb` — **Shiden NSR-V (#4)**
- `assets/bikes/kaze.glb` — **Kaze RGV-500 (#34)**
- `assets/bikes/corsa.glb` — **Corsa 500 Italia (#27)**

## How Automatic Loading & Scaling Works

1. When running in the browser, `models.js` uses Three.js `GLTFLoader` (`three/addons/loaders/GLTFLoader.js`) to load `assets/bikes/<bikeId>.glb`.
2. The loader measures the model's bounding box (`THREE.Box3`), automatically orients its longest horizontal axis along `+X` (forward), aligns the bottom of the tires with `y = 0`, and scales the model to match the authentic **1.40m 500cc GP wheelbase** (`~2.00m` overall tire-to-tire length).
3. The loaded `.glb` meshes have `castShadow` and `receiveShadow` enabled and replace the procedural bike body (`bikeBodyGroup`, wheels, and forks) inside `leanGroup`.
4. **Rider handling**: The procedural articulated rider (`riderBody`, with knee-down hang-off, aero tuck, and helmet counter-roll) is kept on top of the bike unless the `.glb` scene contains a child mesh/group named `rider`, `pilot`, or `driver`.
5. **Headless & Fallback Safety**: In Node.js tests (`document` undefined) or if a `.glb` file is missing/disabled, loading is skipped or fails silently and the procedural bike remains active.

## Enabling GLB Models

To avoid unnecessary `404` network requests when no `.glb` files are installed, list any `.glb` bike IDs you have added on the `ENABLE_GLB:` line below (or launch the game with `?glb=1` in the URL):

```text
ENABLE_GLB: none
```
*(Change `none` to e.g. `akagi, shiden, kaze, corsa` or `all` after placing `.glb` files in this folder.)*

## Where to Find Free CC0 / CC-BY 3D Motorcycle Models

- **Poly Pizza** (`https://poly.pizza`) — Search for *"sport bike"*, *"racing motorcycle"*, or *"superbike"* (CC0 and CC-BY low/mid-poly `.glb` downloads).
- **Kenney Assets** (`https://kenney.nl/assets`) — Public Domain (CC0) vehicle and racing packs in `.glb` / `.gltf` format.
- **Quaternius** (`https://quaternius.com`) — CC0 game-ready vehicles and motorcycles in `.gltf` / `.glb` format.
- **Sketchfab** (`https://sketchfab.com/search?features=downloadable&licenses=322a749bcfa841b29dff1e8a1bb74b0b&q=gp+motorcycle&type=models`) — Filter by **Downloadable** + **CC0 / CC-BY** licenses and download the **glTF / GLB (Autoconverted)** package.
- **BlenderKit / OpenGameArt** (`https://opengameart.org`) — CC0 / CC-BY 3D racing bikes exportable to `.glb` via Blender (`File -> Export -> glTF 2.0 (.glb)`).
