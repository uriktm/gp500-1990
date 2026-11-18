"""Build the photographic scenery files from the Poly Haven sources (Blender 5.x, headless).

Usage:
  node tools/fetch_scenery_assets.mjs <cache>
  blender -b --factory-startup -P tools/build_scenery_assets.py -- <cache> assets/scenery

Outputs (all CC0-derived):
  sky_band.jpg          upper part of the alps_field panorama (zenith to just below the horizon)
  env.hdr               1k HDR copy for image-based lighting
  <surface>_diff/nor/rough.jpg   ground and building textures (grass recolored to mown lawn)
  tree_<id>.webp        two orthographic views side by side, for crossed-quad billboards
  scenery.json          sun position in the panorama, horizon haze color, tree sizes
"""

import json
import math
import os
import shutil
import sys

import bpy
import numpy as np
from mathutils import Vector

HDRI = "alps_field"
# Keep this fraction of the panorama height, measured from the top (0.5 = horizon).
SKY_BAND_V = 0.53
SKY_BAND_WIDTH = 8192

SURFACES = {
    # output name: (poly haven id, jpeg quality)
    "asphalt": ("asphalt_track", 84),
    "grass": ("leafy_grass", 84),
    "gravel": ("gravelly_sand", 84),
    "concrete": ("concrete_wall_003", 84),
    "metal": ("corrugated_iron", 84),
}
# Mown circuit lawn: Poly Haven has no lawn scan, so leafy_grass keeps its photographic
# detail (luminance) and gets a lawn color.
LAWN_RGB = np.array([0.30, 0.43, 0.17], dtype=np.float32)

TREES = ["island_tree_01", "island_tree_02", "searsia_lucida"]
TREE_VIEW_PX = 1024
TREE_SUN_ELEVATION_DEG = 42.0


def log(*args):
    print("[build_scenery_assets]", *args, flush=True)


def load_pixels(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    arr = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    return img, arr.reshape(h, w, 4)


def save_image(arr, path, fmt, quality=85):
    h, w = arr.shape[:2]
    has_alpha = arr.shape[2] == 4
    if not has_alpha:
        arr = np.concatenate([arr, np.ones((h, w, 1), dtype=np.float32)], axis=2)
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=has_alpha)
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = fmt
    img.save(quality=quality)
    bpy.data.images.remove(img)
    log(f"wrote {os.path.basename(path)} {os.path.getsize(path) / 1e6:.2f} MB")


def resize(arr, new_w, new_h):
    h, w = arr.shape[:2]
    ys = (np.arange(new_h) + 0.5) * h / new_h
    xs = (np.arange(new_w) + 0.5) * w / new_w
    y0 = np.clip(ys.astype(int), 0, h - 1)
    x0 = np.clip(xs.astype(int), 0, w - 1)
    # Box-average 2x2 neighbourhoods for a cheap anti-aliased downscale.
    y1 = np.clip(y0 + 1, 0, h - 1)
    x1 = np.clip(x0 + 1, 0, w - 1)
    return (arr[y0][:, x0] + arr[y1][:, x0] + arr[y0][:, x1] + arr[y1][:, x1]) * 0.25


# ---------------------------------------------------------------------------
def build_sky(cache, out, meta):
    _, pano = load_pixels(os.path.join(cache, "hdri", f"{HDRI}_8k.jpg"))
    h, w = pano.shape[:2]
    # Blender rows start at the bottom: the top of the photo is the last row.
    keep = int(h * SKY_BAND_V)
    band = pano[h - keep:, :, :3]
    if w != SKY_BAND_WIDTH:
        band = resize(band, SKY_BAND_WIDTH, int(keep * SKY_BAND_WIDTH / w))
    save_image(band, os.path.join(out, "sky_band.jpg"), "JPEG", 82)
    # Haze color just above the horizon (rows 0.47..0.495 of the full panorama).
    r0 = int(h * (0.5 - 0.03))
    r1 = int(h * (0.5 - 0.005))
    haze = pano[h - r1:h - r0, :, :3].reshape(-1, 3).mean(0)
    meta["sky"] = {"file": "sky_band.jpg", "vMax": SKY_BAND_V, "hazeColor": [round(float(c), 4) for c in haze]}

    hdr_src = os.path.join(cache, "hdri", f"{HDRI}_1k.hdr")
    shutil.copyfile(hdr_src, os.path.join(out, "env.hdr"))
    _, hdr = load_pixels(hdr_src)
    hh, hw = hdr.shape[:2]
    lum = hdr[..., :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    row, col = np.unravel_index(np.argmax(lum), lum.shape)
    u = (col + 0.5) / hw
    v_from_top = 1.0 - (row + 0.5) / hh
    elevation = (0.5 - v_from_top) * 180.0
    meta["sun"] = {"u": round(float(u), 5), "vFromTop": round(float(v_from_top), 5),
                   "elevationDeg": round(float(elevation), 2)}
    meta["env"] = {"file": "env.hdr"}
    log(f"sun at u={u:.3f} v={v_from_top:.3f} elevation={elevation:.1f} deg, haze={haze}")


def build_surfaces(cache, out, meta):
    meta["surfaces"] = {}
    for name, (pid, quality) in SURFACES.items():
        files = {}
        for src_map, suffix in (("Diffuse", "diff"), ("nor_gl", "nor"), ("Rough", "rough")):
            _, arr = load_pixels(os.path.join(cache, "textures", f"{pid}_{src_map}.jpg"))
            rgb = arr[..., :3]
            if name == "grass" and suffix == "diff":
                lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
                detail = lum / max(float(lum.mean()), 1e-4)
                rgb = np.clip(LAWN_RGB[None, None, :] * detail[..., None] ** 0.8, 0, 1)
            fname = f"{name}_{suffix}.jpg"
            save_image(rgb, os.path.join(out, fname), "JPEG", quality)
            files[suffix] = fname
        meta["surfaces"][name] = files


# ---------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.resolution_x = TREE_VIEW_PX
    scene.render.resolution_y = TREE_VIEW_PX
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("sky")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.62, 0.72, 0.86, 1)
    bg.inputs[1].default_value = 0.55
    return scene


def render_tree(cache, out, tree_id, meta):
    scene = reset_scene()
    bpy.ops.import_scene.gltf(filepath=os.path.join(cache, "trees", tree_id, f"{tree_id}.gltf"))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    center = (mn + mx) / 2
    height = mx.z - mn.z
    span = max(mx.x - mn.x, mx.y - mn.y, height)

    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    scene.collection.objects.link(sun)
    sun.data.energy = 3.2
    sun.data.angle = math.radians(2.0)

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = span * 1.02
    cam.data.clip_end = span * 10
    scene.camera = cam

    views = []
    for k, az in enumerate((0.0, 90.0)):
        a = math.radians(az)
        direction = Vector((math.cos(a), math.sin(a), 0.0))
        target = Vector((center.x, center.y, mn.z + span * 0.51))
        cam.location = target - direction * span * 3
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        # Sun from behind the camera's left shoulder, at the scene's sun elevation.
        sa = a + math.radians(-35)
        el = math.radians(TREE_SUN_ELEVATION_DEG)
        sun_dir = Vector((math.cos(sa) * math.cos(el), math.sin(sa) * math.cos(el), -math.sin(el)))
        sun.rotation_euler = sun_dir.to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(out, f"_tmp_{tree_id}_{k}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        _, px = load_pixels(path)
        views.append(px)
        os.remove(path)

    atlas = np.concatenate(views, axis=1)
    fname = f"tree_{tree_id}.webp"
    save_image(atlas, os.path.join(out, fname), "WEBP", 88)
    meta["trees"].append({
        "id": tree_id,
        "file": fname,
        "heightM": round(height, 3),
        # Each view is a square of this size whose bottom edge is the ground line.
        "quadSizeM": round(span * 1.02, 3),
    })
    log(f"{tree_id}: height {height:.2f} m, quad {span * 1.02:.2f} m")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    cache, out = os.path.abspath(argv[0]), os.path.abspath(argv[1])
    os.makedirs(out, exist_ok=True)
    meta = {"source": "Poly Haven (CC0)", "hdri": HDRI, "trees": []}
    build_sky(cache, out, meta)
    build_surfaces(cache, out, meta)
    for tree_id in TREES:
        render_tree(cache, out, tree_id, meta)
    with open(os.path.join(out, "scenery.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    log("wrote scenery.json")


main()
