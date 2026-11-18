"""Prepare a downloaded GP motorcycle .glb for the game (Blender 5.x, headless).

Usage:
  blender -b --factory-startup -P tools/prepare_bike_glb.py -- <source.glb> <out_dir>

What it does to the source model:
  1. Flattens the hierarchy, applies transforms, and normalizes it to the game frame:
     axle midpoint at the origin, tyres on the ground, wheelbase exactly 1.40 m.
  2. Erases third-party logos/sponsor text from the painted textures (majority filter
     over color clusters), then repaints the bodywork in each roster team's colors.
  3. Rebuilds every material as plain metallic-roughness PBR (the source uses the
     spec-gloss extension, which three.js no longer reads).
  4. Splits the model into `body`, `wheel_front`, `wheel_rear` (pivot on the axle) and
     adds a `seat_anchor` empty for placing the procedural rider.
  5. Exports `gp500_works.glb` plus `livery_<bikeId>.jpg` for the other teams.
"""

import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

WHEELBASE_M = 1.40

# Mirrors bikes.js colorPrimary. The first entry is embedded in the GLB.
TEAMS = [
    ("akagi", "#d91424"),
    ("shiden", "#1648b8"),
    ("kaze", "#00a8e8"),
    ("corsa", "#b80f1a"),
]

# Livery texture areas (x0, y0, x1, y1 in px of the 2048 source, origin top-left) that are
# not bodywork paint: the titanium header pipes and carbon silencers of the SuperGP v1 UVs.
LIVERY_KEEP_RECTS = [(1790, 0, 2048, 830)]

# (material-name fragment, logo-erase radius in px at 2048, roughness, metallic, coat)
MATERIAL_RULES = [
    ("livery", 60, 0.34, 0.0, 0.6),
    ("cockpit", 28, 0.55, 0.15, 0.0),
    ("mechanics", 0, 0.42, 0.65, 0.0),
    ("rim", 0, 0.32, 0.85, 0.0),
    ("tyre", 0, 0.88, 0.0, 0.0),
    ("brake", 0, 0.38, 0.8, 0.0),
    ("chain", 0, 0.5, 0.8, 0.0),
    ("gauge", 0, 0.6, 0.0, 0.0),
]


def log(*args):
    print("[prepare_bike_glb]", *args, flush=True)


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------
def image_to_array(img):
    w, h = img.size
    arr = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    return arr.reshape(h, w, 4)


def array_to_image(img, arr):
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.update()


def box_sum(a, r):
    """Sum of `a` over a (2r+1)^2 window, edges clamped."""
    p = np.pad(a.astype(np.float64), ((r + 1, r), (r + 1, r)), mode="edge")
    s = p.cumsum(0).cumsum(1)
    n = 2 * r + 1
    return s[n:, n:] - s[:-n, n:] - s[n:, :-n] + s[:-n, :-n]


def kmeans(rgb, k, iters=14, seed=7):
    flat = rgb.reshape(-1, 3)
    rng = np.random.default_rng(seed)
    sample = flat[rng.choice(len(flat), size=min(40000, len(flat)), replace=False)]
    centers = [sample[rng.integers(len(sample))]]
    for _ in range(1, k):
        d = np.min([((sample - c) ** 2).sum(1) for c in centers], axis=0)
        centers.append(sample[rng.choice(len(sample), p=d / d.sum())])
    centers = np.array(centers)
    for _ in range(iters):
        lab = np.argmin([((sample - c) ** 2).sum(1) for c in centers], axis=0)
        for i in range(k):
            if np.any(lab == i):
                centers[i] = sample[lab == i].mean(0)
    best = np.full(flat.shape[0], np.inf, dtype=np.float32)
    labels = np.zeros(flat.shape[0], dtype=np.int32)
    for i, c in enumerate(centers):
        d = ((flat - c) ** 2).sum(1)
        m = d < best
        best[m] = d[m]
        labels[m] = i
    return labels.reshape(rgb.shape[:2]), centers


def erase_logos(arr, radius, k=7):
    """Replace small foreign marks (text, logos) with the dominant surrounding paint."""
    rgb = arr[..., :3]
    labels, _ = kmeans(rgb, k)
    counts = np.stack([box_sum(labels == i, radius) for i in range(k)])
    majority = counts.argmax(0)
    replaced = labels != majority
    # Grow the mask a little so anti-aliased logo edges go too.
    replaced = box_sum(replaced, 3) > 0
    bg = np.zeros_like(rgb)
    for i in range(k):
        sel = majority == i
        if not np.any(sel):
            continue
        mask = (labels == i).astype(np.float32)
        cnt = np.maximum(counts[i], 1.0)
        for c in range(3):
            bg[..., c][sel] = (box_sum(rgb[..., c] * mask, radius) / cnt)[sel]
    out = arr.copy()
    out[..., :3][replaced] = bg[replaced]
    log(f"  erased {replaced.mean() * 100:.1f}% of pixels (r={radius})")
    return out


def hex_to_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def repaint_livery(clean, primary):
    """Dark bodywork paint -> team primary with its shading kept; white panels and
    aluminium stay as they are."""
    rgb = clean[..., :3]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    sat = rgb.max(-1) - rgb.min(-1)
    dark = (sat < 0.08) & (lum < 0.22)
    h, w = dark.shape
    for x0, y0, x1, y1 in LIVERY_KEEP_RECTS:
        sx, sy = w / 2048, h / 2048
        # Blender pixel rows start at the bottom of the image.
        dark[h - int(y1 * sy):h - int(y0 * sy), int(x0 * sx):int(x1 * sx)] = False
    out = clean.copy()
    # Deeper than the raw team color: clearcoat and sky reflections lighten it on screen.
    shade = np.clip(lum[dark] / 0.11, 0.6, 1.1)[:, None] * 0.8
    out[..., :3][dark] = np.clip(primary[None, :] * shade, 0.0, 1.0)
    return out


def save_jpeg(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    array_to_image(img, arr)
    img.filepath_raw = path
    img.file_format = "JPEG"
    img.save()
    bpy.data.images.remove(img)


# ---------------------------------------------------------------------------
# Scene helpers
# ---------------------------------------------------------------------------
def mesh_objects():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def world_bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def select_only(objs, active):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def flatten_and_normalize():
    for o in mesh_objects():
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in [o for o in bpy.data.objects if o.type != "MESH"]:
        bpy.data.objects.remove(o, do_unlink=True)
    meshes = mesh_objects()
    select_only(meshes, meshes[0])
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    tyres = sorted([o for o in meshes if "tyre" in o.name.lower() or "tire" in o.name.lower()],
                   key=lambda o: (world_bounds([o])[0].x + world_bounds([o])[1].x))
    if len(tyres) != 2:
        raise RuntimeError(f"expected 2 tyre meshes, found {[o.name for o in tyres]}")
    rear, front = tyres
    axle = []
    for t in (rear, front):
        mn, mx = world_bounds([t])
        axle.append(((mn + mx) / 2))
    ground = min(world_bounds([rear])[0].z, world_bounds([front])[0].z)
    _, body_mx = world_bounds(meshes)
    body_mn, _ = world_bounds(meshes)
    lateral = (body_mn.y + body_mx.y) / 2
    wheelbase = axle[1].x - axle[0].x
    if wheelbase <= 0:
        raise RuntimeError("front tyre is not ahead of rear tyre along +X")
    s = WHEELBASE_M / wheelbase
    mid_x = (axle[0].x + axle[1].x) / 2
    m = Matrix.Scale(s, 4) @ Matrix.Translation((-mid_x, -lateral, -ground))
    for o in meshes:
        o.data.transform(m)
        o.data.update()
    log(f"normalized: scale={s:.4f} wheelbase {wheelbase:.3f} -> {WHEELBASE_M}")
    return front, rear


def build_wheel(name, tyre, rim_parts):
    mn, mx = world_bounds([tyre])
    axle = (mn + mx) / 2
    select_only([tyre] + rim_parts, tyre)
    if rim_parts:
        bpy.ops.object.join()
    wheel = bpy.context.view_layer.objects.active
    wheel.name = name
    wheel.data.name = name
    bpy.context.scene.cursor.location = axle
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    log(f"{name}: axle=({axle.x:.3f},{axle.z:.3f}) radius={(mx.z - mn.z) / 2:.3f}")
    return wheel


def split_wheels(front_tyre, rear_tyre):
    rims = [o for o in mesh_objects() if "rim" in o.name.lower()]
    parts = []
    for rim in rims:
        select_only([rim], rim)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.separate(type="LOOSE")
        bpy.ops.object.mode_set(mode="OBJECT")
        parts += [o for o in bpy.context.selected_objects]
    front_parts, rear_parts = [], []
    for p in parts:
        mn, mx = world_bounds([p])
        (front_parts if (mn.x + mx.x) / 2 > 0 else rear_parts).append(p)
    wf = build_wheel("wheel_front", front_tyre, front_parts)
    wr = build_wheel("wheel_rear", rear_tyre, rear_parts)
    return wf, wr


def join_body(exclude):
    rest = [o for o in mesh_objects() if o not in exclude]
    select_only(rest, rest[0])
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = "body"
    body.data.name = "body"
    return body


def seat_anchor(body):
    """Lowest top surface between tail hump and tank, on the centerline."""
    verts = np.array([v.co[:] for v in body.data.vertices], dtype=np.float32)
    center = verts[np.abs(verts[:, 1]) < 0.06]
    best = None
    for x in np.arange(-0.55, 0.15, 0.025):
        sl = center[(center[:, 0] >= x) & (center[:, 0] < x + 0.025)]
        if len(sl) == 0:
            continue
        top = sl[:, 2].max()
        if best is None or top < best[1]:
            best = (x + 0.0125, top)
    profile = []
    for x in np.arange(-0.9, 0.9, 0.1):
        sl = center[(center[:, 0] >= x) & (center[:, 0] < x + 0.1)]
        profile.append(f"{x:+.1f}:{sl[:, 2].max():.2f}" if len(sl) else f"{x:+.1f}:-")
    log("centerline top profile", " ".join(profile))
    empty = bpy.data.objects.new("seat_anchor", None)
    bpy.context.scene.collection.objects.link(empty)
    empty.location = (best[0], 0.0, best[1])
    log(f"seat_anchor at x={best[0]:.3f} z={best[1]:.3f}")
    return empty


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
def find_images(mat):
    diffuse = normal = None
    if not mat.use_nodes:
        return None, None
    for n in mat.node_tree.nodes:
        if n.type != "TEX_IMAGE" or not n.image:
            continue
        for link in n.outputs["Color"].links:
            to = link.to_node
            if to.type == "NORMAL_MAP":
                normal = n.image
            elif to.type in {"MIX", "MIX_RGB"} or link.to_socket.name == "Base Color":
                diffuse = diffuse or n.image
    return diffuse, normal


def rebuild_material(mat, diffuse, normal, rough, metal, coat):
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if coat > 0:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.06
    if diffuse:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = diffuse
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (0.05, 0.05, 0.05, 1)
    if normal:
        normal.colorspace_settings.name = "Non-Color"
        ntex = nt.nodes.new("ShaderNodeTexImage")
        ntex.image = normal
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    mat.use_backface_culling = False


def make_glass(mat, alpha):
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (0.015, 0.018, 0.022, 1)
    bsdf.inputs["Roughness"].default_value = 0.04
    bsdf.inputs["Alpha"].default_value = alpha
    mat.surface_render_method = "BLENDED"
    mat.use_backface_culling = False


def process_materials(out_dir):
    livery_clean = None
    livery_img = None
    for mat in list(bpy.data.materials):
        lname = mat.name.lower()
        if "glass" in lname:
            make_glass(mat, 0.62 if "inner" in lname else 0.42)
            mat.name = "glass_inner" if "inner" in lname else "glass_screen"
            continue
        rule = next((r for r in MATERIAL_RULES if r[0] in lname), None)
        if rule is None:
            log("material without rule, kept plain:", mat.name)
            rule = (lname, 0, 0.5, 0.0, 0.0)
        frag, radius, rough, metal, coat = rule
        diffuse, normal = find_images(mat)
        if diffuse is not None and radius > 0:
            log(f"cleaning {mat.name} / {diffuse.name} {tuple(diffuse.size)}")
            arr = image_to_array(diffuse)
            arr = erase_logos(arr, max(4, int(radius * diffuse.size[0] / 2048)))
            if frag == "livery":
                livery_clean = arr
                livery_img = diffuse
            else:
                array_to_image(diffuse, arr)
        for img in (diffuse, normal):
            if img is not None and max(img.size) > 1024 and frag != "livery":
                img.scale(img.size[0] // 2, img.size[1] // 2)
        rebuild_material(mat, diffuse, normal, rough, metal, coat)
        if frag == "livery":
            mat.name = "livery_paint"
            if diffuse is not None:
                diffuse.name = "livery_paint"
        else:
            mat.name = frag

    if livery_clean is None:
        raise RuntimeError("no livery texture found")
    for i, (bike_id, prim) in enumerate(TEAMS):
        painted = repaint_livery(livery_clean, hex_to_rgb(prim))
        if i == 0:
            array_to_image(livery_img, painted)
        else:
            path = os.path.join(out_dir, f"livery_{bike_id}.jpg")
            save_jpeg(painted, path)
            log("wrote", path)
    for img in bpy.data.images:
        if img.users == 0:
            bpy.data.images.remove(img)


# ---------------------------------------------------------------------------
def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    src, out_dir = argv[0], os.path.abspath(argv[1])
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)

    front_tyre, rear_tyre = flatten_and_normalize()
    wf, wr = split_wheels(front_tyre, rear_tyre)
    body = join_body([wf, wr])
    anchor = seat_anchor(body)
    process_materials(out_dir)

    root = bpy.data.objects.new("gp500_bike", None)
    bpy.context.scene.collection.objects.link(root)
    for o in (body, wf, wr, anchor):
        o.parent = root

    tris = sum(len(p.vertices) - 2 for o in mesh_objects() for p in o.data.polygons)
    log(f"total triangles: {tris}")

    out_path = os.path.join(out_dir, "gp500_works.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_image_format="JPEG",
        export_image_quality=86,
        export_yup=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_apply=True,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
    )
    log("wrote", out_path, f"{os.path.getsize(out_path) / 1e6:.2f} MB")


main()
