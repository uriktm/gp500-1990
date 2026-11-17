"""
Procedural 3D Showcase Asset Builder for 500cc Grand Prix '90.

Generates two lightweight, PBR-shaded glTF 2.0 binary (.glb) assets using
Blender 5.3 headless mode:
  1. assets/showcase/paddock_stage.glb
  2. assets/showcase/champion_trophy.glb

Run headless:
  "C:\\Program Files\\Blender Foundation\\Blender 5.3\\blender.exe" -b --factory-startup -P tools/build_blender_assets.py
"""

from __future__ import annotations

import json
import math
import os
import struct
import sys
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector


# ---------------------------------------------------------------------------
# Scene & Material Helpers
# ---------------------------------------------------------------------------

def reset_scene() -> None:
    """Reset Blender to a clean empty factory scene."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_pbr_material(
    name: str,
    base_color: Tuple[float, float, float, float],
    metallic: float = 0.0,
    roughness: float = 0.5,
    coat_weight: float = 0.0,
    coat_roughness: float = 0.1,
    specular_ior: float = 0.5,
    emission_color: Optional[Tuple[float, float, float, float]] = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    """Create a clean Principled BSDF PBR material compatible with Blender 5.3 glTF export."""
    mat = bpy.data.materials.new(name=name)
    if getattr(mat, "node_tree", None) is None:
        mat.use_nodes = True

    nt = mat.node_tree
    bsdf = None
    for node in nt.nodes:
        if node.type == "BSDF_PRINCIPLED":
            bsdf = node
            break
    if bsdf is None:
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")

    inputs = bsdf.inputs
    inputs["Base Color"].default_value = base_color
    inputs["Metallic"].default_value = metallic
    inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in inputs:
        inputs["Specular IOR Level"].default_value = specular_ior
    if "Coat Weight" in inputs:
        inputs["Coat Weight"].default_value = coat_weight
    if "Coat Roughness" in inputs:
        inputs["Coat Roughness"].default_value = coat_roughness
    if emission_color is not None and "Emission Color" in inputs:
        inputs["Emission Color"].default_value = emission_color
    if "Emission Strength" in inputs:
        inputs["Emission Strength"].default_value = emission_strength

    return mat


def link_object(obj: bpy.types.Object, parent: Optional[bpy.types.Object] = None) -> bpy.types.Object:
    """Link an object to the active scene collection and optional parent."""
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def apply_auto_smooth(obj: bpy.types.Object, angle_deg: float = 38.0) -> None:
    """Apply smooth shading with crisp auto-smooth angle splitting."""
    if obj.type != "MESH":
        return
    for poly in obj.data.polygons:
        poly.use_smooth = True
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_auto_smooth(angle=math.radians(angle_deg))


def create_lathe_object(
    name: str,
    profile_rz: Sequence[Tuple[float, float]],
    steps: int,
    material: bpy.types.Material,
    smooth_angle_deg: float = 38.0,
    closed_ring: bool = False,
    parent: Optional[bpy.types.Object] = None,
) -> bpy.types.Object:
    """
    Create a manifold revolved mesh from a list of (radius, z) profile points.
    If closed_ring is True, connects the last profile vertex back to the first.
    """
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()

    verts = [bm.verts.new((r, 0.0, z)) for r, z in profile_rz]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    if closed_ring and len(verts) > 2:
        edges.append(bm.edges.new((verts[-1], verts[0])))

    bmesh.ops.spin(
        bm,
        geom=verts + edges,
        cent=(0.0, 0.0, 0.0),
        axis=(0.0, 0.0, 1.0),
        angle=2.0 * math.pi,
        steps=steps,
        use_merge=True,
    )
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    bm.to_mesh(mesh)
    bm.free()

    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    link_object(obj, parent=parent)
    apply_auto_smooth(obj, angle_deg=smooth_angle_deg)
    return obj


def create_chamfered_box_mesh(
    name: str,
    size_xyz: Tuple[float, float, float],
    bevel_width: float,
    bevel_segments: int,
    material: bpy.types.Material,
    smooth_angle_deg: float = 35.0,
    parent: Optional[bpy.types.Object] = None,
) -> bpy.types.Object:
    """Create a centered chamfered/beveled box mesh."""
    sx, sy, sz = size_xyz
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    if bevel_width > 0.0:
        bmesh.ops.bevel(
            bm,
            geom=list(bm.edges),
            offset=bevel_width,
            segments=bevel_segments,
            profile=0.5,
            affect="EDGES",
            clamp_overlap=True,
        )
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    link_object(obj, parent=parent)
    apply_auto_smooth(obj, angle_deg=smooth_angle_deg)
    return obj


def create_empty_root(name: str) -> bpy.types.Object:
    """Create an empty root group object at the world origin."""
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = "PLAIN_AXES"
    link_object(empty)
    return empty


# ---------------------------------------------------------------------------
# Asset 1: paddock_stage.glb
# ---------------------------------------------------------------------------

def _build_bolt_bmesh(bm_target: bmesh.types.BMesh, center_xy: Tuple[float, float], z_base: float) -> None:
    """Append a precision chamfered radial trim bolt directly into a combined bmesh."""
    cx, cy = center_xy
    bm = bmesh.new()

    # Washer + chamfered socket-head bolt profile (closed solid)
    profile = [
        (0.0, z_base),
        (0.0175, z_base),
        (0.0175, z_base + 0.0022),
        (0.0155, z_base + 0.0032),
        (0.0125, z_base + 0.0032),
        (0.0125, z_base + 0.0072),
        (0.0098, z_base + 0.0092),
        (0.0058, z_base + 0.0092),
        (0.0052, z_base + 0.0052),
        (0.0, z_base + 0.0052),
    ]
    verts = [bm.verts.new((r, 0.0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]

    bmesh.ops.spin(
        bm,
        geom=verts + edges,
        cent=(0.0, 0.0, 0.0),
        axis=(0.0, 0.0, 1.0),
        angle=2.0 * math.pi,
        steps=16,
        use_merge=True,
    )
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(cx, cy, 0.0))

    # Merge into target bmesh via temporary mesh
    tmp_mesh = bpy.data.meshes.new("_tmp_bolt")
    bm.to_mesh(tmp_mesh)
    bm.free()
    bm_target.from_mesh(tmp_mesh)
    bpy.data.meshes.remove(tmp_mesh)


def _build_spotlight_pod(
    suffix: str,
    pos_xy: Tuple[float, float],
    aim_target_xyz: Tuple[float, float, float],
    materials: dict,
    parent: bpy.types.Object,
) -> None:
    """
    Build a low-profile paddock spotlight & rear pit-stand bracket assembly
    on the outer perimeter (radius >= 1.45m), aimed cleanly toward the bike.
    """
    px, py = pos_xy
    pod_root = bpy.data.objects.new(f"Paddock_SpotlightPod_{suffix}", None)
    pod_root.location = (px, py, 0.0)
    dx = aim_target_xyz[0] - px
    dy = aim_target_xyz[1] - py
    yaw = math.atan2(dy, dx)
    pod_root.rotation_euler = (0.0, 0.0, yaw)
    link_object(pod_root, parent=parent)

    # 1. Machined dark-gunmetal base plate flush on stage deck (z = 0..0.015)
    base_plate = create_chamfered_box_mesh(
        f"Spotlight_BasePlate_{suffix}",
        size_xyz=(0.135, 0.116, 0.015),
        bevel_width=0.004,
        bevel_segments=2,
        material=materials["gunmetal"],
        smooth_angle_deg=35.0,
        parent=pod_root,
    )
    base_plate.location = (0.0, 0.0, 0.0075)

    # 4 corner anchor bolts on base plate
    bolt_bm = bmesh.new()
    for bx in (-0.048, 0.048):
        for by in (-0.040, 0.040):
            _build_bolt_bmesh(bolt_bm, (bx, by), 0.0145)
    bolt_mesh = bpy.data.meshes.new(f"Spotlight_BaseBolts_{suffix}")
    bolt_bm.to_mesh(bolt_mesh)
    bolt_bm.free()
    bolt_mesh.materials.append(materials["aluminum"])
    bolt_obj = bpy.data.objects.new(f"Spotlight_BaseBolts_{suffix}", bolt_mesh)
    link_object(bolt_obj, parent=pod_root)
    apply_auto_smooth(bolt_obj, angle_deg=36.0)

    # 2. Twin Rear Pit-Stand Style Yoke Arms rising to pivot at z = 0.115m
    for side_name, sy in (("L", 0.052), ("R", -0.052)):
        arm = create_chamfered_box_mesh(
            f"Spotlight_YokeArm_{suffix}_{side_name}",
            size_xyz=(0.036, 0.014, 0.118),
            bevel_width=0.003,
            bevel_segments=2,
            material=materials["aluminum"],
            smooth_angle_deg=35.0,
            parent=pod_root,
        )
        arm.location = (-0.012, sy, 0.068)
        arm.rotation_euler = (0.0, math.radians(-14.0), 0.0)

        # Anodized crimson CNC pivot knob on outer side of yoke arm
        knob_profile = [
            (0.0, -0.006),
            (0.015, -0.006),
            (0.015, 0.004),
            (0.012, 0.008),
            (0.0, 0.008),
        ]
        knob = create_lathe_object(
            f"Spotlight_PivotKnob_{suffix}_{side_name}",
            knob_profile,
            steps=24,
            material=materials["crimson_anodized"],
            smooth_angle_deg=36.0,
            parent=pod_root,
        )
        sign = 1.0 if sy > 0 else -1.0
        knob.location = (-0.022, sy + sign * 0.008, 0.116)
        knob.rotation_euler = (math.radians(-90.0 * sign), 0.0, 0.0)

    # 3. Finned Low-Profile Lamp Head tilted upward toward center bike
    head_pivot = bpy.data.objects.new(f"Spotlight_HeadPivot_{suffix}", None)
    head_pivot.location = (-0.016, 0.0, 0.116)
    horiz_dist = math.hypot(dx, dy)
    dz = aim_target_xyz[2] - 0.116
    pitch_up = math.atan2(dz, max(0.1, horiz_dist))
    # Rotate around local Y so local +Z points along local +X tilted up by pitch_up
    head_pivot.rotation_euler = (0.0, math.radians(90.0) - pitch_up, 0.0)
    link_object(head_pivot, parent=pod_root)

    # Outer barrel + cooling fins (revolved along local Z)
    barrel_profile = [
        (0.0, -0.066),
        (0.036, -0.066),
        (0.044, -0.056),
        # Fin 1
        (0.048, -0.054),
        (0.048, -0.048),
        (0.044, -0.046),
        # Fin 2
        (0.050, -0.043),
        (0.050, -0.037),
        (0.045, -0.035),
        # Fin 3
        (0.052, -0.032),
        (0.052, -0.026),
        (0.046, -0.024),
        # Main housing sleeve
        (0.049, -0.018),
        (0.051, 0.048),
        (0.047, 0.056),
        # Recessed bezel inside lip
        (0.041, 0.056),
        (0.040, 0.042),
        (0.0, 0.042),
    ]
    create_lathe_object(
        f"Spotlight_Barrel_{suffix}",
        barrel_profile,
        steps=36,
        material=materials["gunmetal"],
        smooth_angle_deg=36.0,
        parent=head_pivot,
    )

    # Brushed aluminum front trim bezel ring
    bezel_profile = [
        (0.041, 0.050),
        (0.052, 0.050),
        (0.052, 0.058),
        (0.048, 0.062),
        (0.040, 0.062),
        (0.039, 0.053),
    ]
    create_lathe_object(
        f"Spotlight_FrontBezel_{suffix}",
        bezel_profile,
        steps=36,
        material=materials["aluminum"],
        smooth_angle_deg=38.0,
        closed_ring=True,
        parent=head_pivot,
    )

    # Glowing warm-amber halogen lens disc inside bezel
    lens_profile = [
        (0.0, 0.042),
        (0.039, 0.042),
        (0.039, 0.048),
        (0.024, 0.051),
        (0.0, 0.052),
    ]
    create_lathe_object(
        f"Spotlight_Lens_{suffix}",
        lens_profile,
        steps=28,
        material=materials["spotlight_lens"],
        smooth_angle_deg=42.0,
        parent=head_pivot,
    )

    # Top anti-glare motorsport brow visor hood over front of spotlight bezel
    hood = create_chamfered_box_mesh(
        f"Spotlight_HoodVisor_{suffix}",
        size_xyz=(0.016, 0.074, 0.028),
        bevel_width=0.002,
        bevel_segments=1,
        material=materials["gunmetal"],
        smooth_angle_deg=35.0,
        parent=head_pivot,
    )
    hood.location = (-0.047, 0.0, 0.056)


def build_paddock_stage(out_path: Path) -> None:
    """Build and export assets/showcase/paddock_stage.glb."""
    reset_scene()
    root = create_empty_root("PaddockStageRoot")

    materials = {
        # Exact spec: brushed dark slate (roughness: 0.38, metallic: 0.5)
        "slate": make_pbr_material(
            "Mat_BrushedDarkSlate",
            base_color=(0.046, 0.052, 0.064, 1.0),
            metallic=0.5,
            roughness=0.38,
            specular_ior=0.55,
        ),
        "slate_inner": make_pbr_material(
            "Mat_TurntableDeckSlate",
            base_color=(0.034, 0.038, 0.048, 1.0),
            metallic=0.5,
            roughness=0.38,
            specular_ior=0.50,
        ),
        "aluminum": make_pbr_material(
            "Mat_BrushedAluminum",
            base_color=(0.76, 0.79, 0.84, 1.0),
            metallic=0.92,
            roughness=0.24,
        ),
        "gunmetal": make_pbr_material(
            "Mat_DarkGunmetal",
            base_color=(0.095, 0.105, 0.125, 1.0),
            metallic=0.85,
            roughness=0.32,
        ),
        "amber_glow": make_pbr_material(
            "Mat_AmberGlowRing",
            base_color=(1.0, 0.34, 0.04, 1.0),
            metallic=0.10,
            roughness=0.18,
            emission_color=(1.0, 0.30, 0.04, 1.0),
            emission_strength=2.6,
        ),
        "crimson_glow": make_pbr_material(
            "Mat_CrimsonGlowTrim",
            base_color=(0.94, 0.06, 0.10, 1.0),
            metallic=0.15,
            roughness=0.18,
            emission_color=(0.95, 0.05, 0.09, 1.0),
            emission_strength=2.2,
        ),
        "crimson_anodized": make_pbr_material(
            "Mat_AnodizedCrimson",
            base_color=(0.76, 0.06, 0.09, 1.0),
            metallic=0.88,
            roughness=0.24,
        ),
        "spotlight_lens": make_pbr_material(
            "Mat_SpotlightLens",
            base_color=(1.0, 0.86, 0.62, 1.0),
            metallic=0.05,
            roughness=0.08,
            emission_color=(1.0, 0.80, 0.46, 1.0),
            emission_strength=3.2,
        ),
    }

    # 1. Main Outer Beveled Brushed Dark Slate Plinth (r ~ 1.72m, top deck exactly at z = 0.0)
    #    Inner turntable disc (r <= 1.195m) is flush at z = 0.000; recessed groove at 1.20..1.24m
    #    separates it from the outer shoulder (1.245..1.632m at z = 0.000).
    plinth_profile = [
        (0.0, -0.148),
        (1.655, -0.148),
        (1.655, -0.126),
        (1.720, -0.118),
        (1.706, -0.056),
        (1.662, -0.052),
        (1.662, -0.025),
        (1.688, -0.022),
        (1.635, 0.0),
        (1.245, 0.0),
        (1.240, -0.005),
        (1.200, -0.005),
        (1.195, 0.0),
        (0.0, 0.0),
    ]
    create_lathe_object(
        "Paddock_Plinth_Slate",
        plinth_profile,
        steps=96,
        material=materials["slate"],
        smooth_angle_deg=36.0,
        parent=root,
    )

    # 2. Glowing Amber/Crimson Chamfered Outer Accent Ring seated cleanly in perimeter groove
    amber_ring_profile = [
        (1.664, -0.052),
        (1.706, -0.052),
        (1.714, -0.044),
        (1.714, -0.036),
        (1.706, -0.032),
        (1.664, -0.032),
    ]
    create_lathe_object(
        "Paddock_GlowRing_Amber",
        amber_ring_profile,
        steps=96,
        material=materials["amber_glow"],
        smooth_angle_deg=36.0,
        closed_ring=True,
        parent=root,
    )

    crimson_ring_profile = [
        (1.664, -0.0315),
        (1.705, -0.0315),
        (1.705, -0.0265),
        (1.694, -0.0225),
        (1.664, -0.0225),
    ]
    create_lathe_object(
        "Paddock_GlowRing_Crimson",
        crimson_ring_profile,
        steps=96,
        material=materials["crimson_glow"],
        smooth_angle_deg=36.0,
        closed_ring=True,
        parent=root,
    )

    # 3. Brushed Aluminum Inner Turntable Seam Ring (inlaid at r = 1.201..1.239m, flush below z = 0)
    seam_ring_profile = [
        (1.202, -0.0048),
        (1.238, -0.0048),
        (1.238, -0.0006),
        (1.233, 0.0),
        (1.207, 0.0),
        (1.202, -0.0006),
    ]
    create_lathe_object(
        "Paddock_Turntable_SeamRing",
        seam_ring_profile,
        steps=96,
        material=materials["aluminum"],
        smooth_angle_deg=36.0,
        closed_ring=True,
        parent=root,
    )

    # 4. Subtle Front & Rear Wheel-Index Alignment Bars outside bike footprint (x = +/-1.12m)
    for bar_name, bx in (("Front", 1.115), ("Rear", -1.115)):
        bar = create_chamfered_box_mesh(
            f"Paddock_GridBar_{bar_name}",
            size_xyz=(0.026, 0.240, 0.003),
            bevel_width=0.001,
            bevel_segments=1,
            material=materials["aluminum"],
            smooth_angle_deg=35.0,
            parent=root,
        )
        bar.location = (bx, 0.0, 0.0005)

    # 5. 24 Brushed Aluminum Radial Trim Bolts around outer flange (r = 1.602m)
    bolts_bm = bmesh.new()
    bolt_count = 24
    bolt_radius = 1.602
    for i in range(bolt_count):
        ang = (2.0 * math.pi * i) / bolt_count
        bx = bolt_radius * math.cos(ang)
        by = bolt_radius * math.sin(ang)
        _build_bolt_bmesh(bolts_bm, (bx, by), 0.0)

    bolts_mesh = bpy.data.meshes.new("Paddock_RadialBolts")
    bolts_bm.to_mesh(bolts_mesh)
    bolts_bm.free()
    bolts_mesh.materials.append(materials["aluminum"])
    bolts_obj = bpy.data.objects.new("Paddock_RadialBolts", bolts_mesh)
    link_object(bolts_obj, parent=root)
    apply_auto_smooth(bolts_obj, angle_deg=36.0)

    # 6. Two Low-Profile Paddock Spotlights / Rear Pit-Stand Brackets at outer perimeter (r = 1.53m >= 1.45m)
    #    Positioned at +/-116 deg so they frame the bike symmetrically while leaving ample clearance
    #    for the showroom trophy pedestal at (-1.18, 0, -0.88).
    pod_radius = 1.530
    for suffix, deg in (("Left", 116.0), ("Right", -116.0)):
        rad = math.radians(deg)
        px = pod_radius * math.cos(rad)
        py = pod_radius * math.sin(rad)
        _build_spotlight_pod(
            suffix=suffix,
            pos_xy=(px, py),
            aim_target_xyz=(0.0, 0.0, 0.56),
            materials=materials,
            parent=root,
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_materials="EXPORT",
    )


# ---------------------------------------------------------------------------
# Asset 2: champion_trophy.glb
# ---------------------------------------------------------------------------

def _catmull_rom_point(
    p0: Vector, p1: Vector, p2: Vector, p3: Vector, t: float
) -> Vector:
    """Evaluate a centripetal-like uniform Catmull-Rom spline at t in [0, 1]."""
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        (2.0 * p1)
        + (-p0 + p2) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    )


def _sample_spline(control_pts: Sequence[Vector], samples_per_seg: int = 10) -> List[Vector]:
    """Sample a smooth open curve through control_pts."""
    pts = [control_pts[0]] + list(control_pts) + [control_pts[-1]]
    out: List[Vector] = []
    num_segs = len(control_pts) - 1
    for i in range(num_segs):
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        steps = samples_per_seg if i < num_segs - 1 else samples_per_seg + 1
        for s in range(steps):
            t = s / samples_per_seg
            out.append(_catmull_rom_point(p0, p1, p2, p3, t))
    return out


def _create_swept_handle(
    name: str,
    side_sign: float,
    material: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    """
    Create one sculpted metallic Grand Prix side handle swept cleanly in the XZ plane
    with a beveled elliptical cross-section and zero frame twist.
    """
    ctrl = [
        Vector((side_sign * 0.086, 0.0, 0.398)),
        Vector((side_sign * 0.118, 0.0, 0.415)),
        Vector((side_sign * 0.146, 0.0, 0.404)),
        Vector((side_sign * 0.148, 0.0, 0.352)),
        Vector((side_sign * 0.126, 0.0, 0.292)),
        Vector((side_sign * 0.092, 0.0, 0.252)),
        Vector((side_sign * 0.055, 0.0, 0.244)),
    ]
    path_pts = _sample_spline(ctrl, samples_per_seg=8)

    # Cross-section in local (n_in_plane, binormal_y): sculpted beveled ribbon
    sec_sides = 12
    bm = bmesh.new()
    rings: List[List[bmesh.types.BMVert]] = []
    n_pts = len(path_pts)

    for idx, pt in enumerate(path_pts):
        if idx == 0:
            tangent = (path_pts[1] - path_pts[0]).normalized()
        elif idx == n_pts - 1:
            tangent = (path_pts[-1] - path_pts[-2]).normalized()
        else:
            tangent = (path_pts[idx + 1] - path_pts[idx - 1]).normalized()

        # Curve lies in XZ plane (y=0), so Y-axis is exact constant binormal
        binormal = Vector((0.0, 1.0, 0.0))
        normal = binormal.cross(tangent).normalized()

        # Subtle taper: thicker along outer crest, slightly slender near lower stem joint
        u = idx / max(1, n_pts - 1)
        scale_profile = 1.0 - 0.18 * (u ** 1.4)
        rx = 0.0062 * scale_profile
        ry = 0.0042 * scale_profile

        ring_verts = []
        for j in range(sec_sides):
            theta = (2.0 * math.pi * j) / sec_sides
            # Soft super-ellipse for crisp metallic highlight spine
            ca = math.cos(theta)
            sa = math.sin(theta)
            lx = math.copysign(abs(ca) ** 0.82, ca) * rx
            ly = math.copysign(abs(sa) ** 0.82, sa) * ry
            pos = pt + normal * lx + binormal * ly
            ring_verts.append(bm.verts.new(pos))
        rings.append(ring_verts)

    for i in range(len(rings) - 1):
        r0 = rings[i]
        r1 = rings[i + 1]
        for j in range(sec_sides):
            jn = (j + 1) % sec_sides
            bm.faces.new((r0[j], r0[jn], r1[jn], r1[j]))

    # Cap start and end inside chalice wall
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material)

    obj = bpy.data.objects.new(name, mesh)
    link_object(obj, parent=parent)
    apply_auto_smooth(obj, angle_deg=45.0)
    return obj


def _create_curved_plaque(
    name: str,
    angle_center_rad: float,
    radius: float,
    z_bot: float,
    z_top: float,
    arc_half_rad: float,
    thickness: float,
    material: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    """Create a subtle chamfered curved gold championship nameplate plaque on pedestal tier 2."""
    bm = bmesh.new()
    segs = 10
    r_in = radius - 0.001
    r_out = radius + thickness
    r_bevel = r_out - 0.0012

    # 4 vertical cross-section levels for crisp top/bottom bevels
    z_levels = [z_bot, z_bot + 0.0022, z_top - 0.0022, z_top]
    r_levels = [r_bevel, r_out, r_out, r_bevel]

    front_grid = []
    back_grid = []
    for k in range(segs + 1):
        u = k / segs
        ang = angle_center_rad - arc_half_rad + u * (2.0 * arc_half_rad)
        ca, sa = math.cos(ang), math.sin(ang)
        col_f = []
        col_b = []
        for z_val, r_val in zip(z_levels, r_levels):
            # Side bevel taper at ends
            r_eff = r_bevel if (k == 0 or k == segs) else r_val
            col_f.append(bm.verts.new((r_eff * ca, r_eff * sa, z_val)))
            col_b.append(bm.verts.new((r_in * ca, r_in * sa, z_val)))
        front_grid.append(col_f)
        back_grid.append(col_b)

    # Outer curved face
    for k in range(segs):
        for m in range(len(z_levels) - 1):
            bm.faces.new((
                front_grid[k][m],
                front_grid[k + 1][m],
                front_grid[k + 1][m + 1],
                front_grid[k][m + 1],
            ))
            bm.faces.new((
                back_grid[k + 1][m],
                back_grid[k][m],
                back_grid[k][m + 1],
                back_grid[k + 1][m + 1],
            ))

    # Top and bottom edges
    for k in range(segs):
        bm.faces.new((
            front_grid[k][-1],
            front_grid[k + 1][-1],
            back_grid[k + 1][-1],
            back_grid[k][-1],
        ))
        bm.faces.new((
            back_grid[k][0],
            back_grid[k + 1][0],
            front_grid[k + 1][0],
            front_grid[k][0],
        ))

    # Left and right end caps
    for m in range(len(z_levels) - 1):
        bm.faces.new((
            back_grid[0][m],
            front_grid[0][m],
            front_grid[0][m + 1],
            back_grid[0][m + 1],
        ))
        bm.faces.new((
            front_grid[-1][m],
            back_grid[-1][m],
            back_grid[-1][m + 1],
            front_grid[-1][m + 1],
        ))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material)

    obj = bpy.data.objects.new(name, mesh)
    link_object(obj, parent=parent)
    apply_auto_smooth(obj, angle_deg=35.0)
    return obj


def build_champion_trophy(out_path: Path) -> None:
    """Build and export assets/showcase/champion_trophy.glb (~0.45m tall, base at y=0)."""
    reset_scene()
    root = create_empty_root("ChampionTrophyRoot")

    materials = {
        "obsidian": make_pbr_material(
            "Mat_DarkObsidianMarble",
            base_color=(0.009, 0.010, 0.014, 1.0),
            metallic=0.06,
            roughness=0.12,
            coat_weight=0.92,
            coat_roughness=0.03,
        ),
        "gold_24k": make_pbr_material(
            "Mat_Polished24kGold",
            base_color=(0.985, 0.775, 0.215, 1.0),
            metallic=1.0,
            roughness=0.13,
            coat_weight=0.20,
            coat_roughness=0.06,
        ),
        "champagne_gold": make_pbr_material(
            "Mat_SatinChampagneGold",
            base_color=(0.945, 0.815, 0.420, 1.0),
            metallic=1.0,
            roughness=0.19,
        ),
        "platinum": make_pbr_material(
            "Mat_BeveledPlatinumRing",
            base_color=(0.82, 0.85, 0.89, 1.0),
            metallic=0.96,
            roughness=0.14,
        ),
        "crimson_enamel": make_pbr_material(
            "Mat_ChampionshipCrimsonEnamel",
            base_color=(0.36, 0.02, 0.035, 1.0),
            metallic=0.72,
            roughness=0.16,
            coat_weight=0.90,
            coat_roughness=0.04,
        ),
    }

    # 1. Tiered Dark Marble / Obsidian Pedestal (base strictly at z = 0.000m)
    pedestal_profile = [
        (0.0, 0.0),
        (0.104, 0.0),
        (0.108, 0.004),
        (0.106, 0.041),
        (0.098, 0.047),
        (0.092, 0.047),
        # Step recess for gold collar
        (0.088, 0.052),
        (0.088, 0.094),
        (0.082, 0.100),
        # Upper crown obsidian tier
        (0.076, 0.100),
        (0.076, 0.112),
        (0.069, 0.118),
        (0.0, 0.118),
    ]
    create_lathe_object(
        "Trophy_Pedestal_Obsidian",
        pedestal_profile,
        steps=64,
        material=materials["obsidian"],
        smooth_angle_deg=35.0,
        parent=root,
    )

    # Gold pedestal accent collar rings
    lower_collar = [
        (0.087, 0.0465),
        (0.096, 0.0465),
        (0.097, 0.0495),
        (0.093, 0.0525),
        (0.087, 0.0525),
    ]
    create_lathe_object(
        "Trophy_Pedestal_CollarLower",
        lower_collar,
        steps=64,
        material=materials["gold_24k"],
        smooth_angle_deg=35.0,
        closed_ring=True,
        parent=root,
    )

    upper_collar = [
        (0.075, 0.0985),
        (0.084, 0.0985),
        (0.084, 0.1015),
        (0.080, 0.1040),
        (0.075, 0.1040),
    ]
    create_lathe_object(
        "Trophy_Pedestal_CollarUpper",
        upper_collar,
        steps=64,
        material=materials["gold_24k"],
        smooth_angle_deg=35.0,
        closed_ring=True,
        parent=root,
    )

    # Front & Back curved 24k gold championship nameplate plaques on Tier 2
    for label, ang_deg in (("Front", 90.0), ("Rear", -90.0)):
        _create_curved_plaque(
            name=f"Trophy_Pedestal_Plaque_{label}",
            angle_center_rad=math.radians(ang_deg),
            radius=0.088,
            z_bot=0.057,
            z_top=0.089,
            arc_half_rad=math.radians(26.0),
            thickness=0.0032,
            material=materials["champagne_gold"],
            parent=root,
        )

    # 2. Polished 24k Gold Lathe-Turned Chalice Cup with Flared Rim & Hollow Inner Bowl
    #    Reaches z = 0.450m total height!
    chalice_profile = [
        # Mounting base on pedestal crown
        (0.0, 0.118),
        (0.058, 0.118),
        (0.058, 0.123),
        (0.046, 0.129),
        (0.036, 0.135),
        # Turned base bead
        (0.041, 0.140),
        (0.039, 0.145),
        (0.025, 0.151),
        # Lower stem & knop seat
        (0.022, 0.160),
        (0.032, 0.171),
        (0.035, 0.176),
        (0.031, 0.182),
        (0.023, 0.193),
        # Upper stem collar into chalice lotus cup
        (0.029, 0.204),
        (0.036, 0.211),
        (0.029, 0.215),
        (0.044, 0.223),
        (0.057, 0.233),
        # Turned waist molding rib
        (0.063, 0.239),
        (0.063, 0.244),
        (0.059, 0.247),
        # Sweeping Grand Prix tulip chalice wall
        (0.064, 0.272),
        (0.070, 0.305),
        (0.076, 0.340),
        (0.082, 0.372),
        (0.089, 0.400),
        # Upper decorative collar rib
        (0.094, 0.411),
        (0.095, 0.416),
        (0.093, 0.420),
        # Flared rim sweep
        (0.102, 0.432),
        (0.112, 0.442),
        (0.116, 0.447),
        # Rolled rim crest (max height = 0.450m)
        (0.115, 0.450),
        (0.111, 0.450),
        (0.107, 0.447),
        # Smooth inner concave chalice cavity
        (0.102, 0.439),
        (0.090, 0.422),
        (0.080, 0.394),
        (0.072, 0.356),
        (0.064, 0.314),
        (0.054, 0.276),
        (0.041, 0.253),
        (0.022, 0.242),
        (0.0, 0.239),
    ]
    create_lathe_object(
        "Trophy_Chalice_Gold",
        chalice_profile,
        steps=56,
        material=materials["gold_24k"],
        smooth_angle_deg=44.0,
        parent=root,
    )

    # 3. Subtle Bevelled Championship Ring hugging the stem knop (z = 0.166..0.186m)
    ring_platinum_profile = [
        (0.028, 0.166),
        (0.036, 0.166),
        (0.042, 0.171),
        (0.042, 0.174),
        (0.0405, 0.1745),
        (0.0405, 0.1775),
        (0.042, 0.178),
        (0.042, 0.181),
        (0.036, 0.186),
        (0.028, 0.186),
    ]
    create_lathe_object(
        "Trophy_ChampionshipRing_Bevel",
        ring_platinum_profile,
        steps=48,
        material=materials["platinum"],
        smooth_angle_deg=35.0,
        closed_ring=True,
        parent=root,
    )

    # Subtle recessed deep-crimson metallic championship hairline inside the beveled ring
    ring_enamel_profile = [
        (0.0398, 0.1745),
        (0.0414, 0.1748),
        (0.0414, 0.1772),
        (0.0398, 0.1775),
    ]
    create_lathe_object(
        "Trophy_ChampionshipRing_Enamel",
        ring_enamel_profile,
        steps=48,
        material=materials["crimson_enamel"],
        smooth_angle_deg=35.0,
        closed_ring=True,
        parent=root,
    )

    # 4. Sculpted Metallic Side Handles + Mounting Ferrules on +/-X
    for side_label, sign in (("Right", 1.0), ("Left", -1.0)):
        _create_swept_handle(
            name=f"Trophy_Handle_{side_label}",
            side_sign=sign,
            material=materials["champagne_gold"],
            parent=root,
        )

        # Upper & lower mounting bosses (turned collars where handle enters chalice wall)
        for boss_label, bx, bz, pitch_deg in (
            ("Upper", sign * 0.088, 0.399, 80.0 * sign),
            ("Lower", sign * 0.058, 0.244, 102.0 * sign),
        ):
            boss_profile = [
                (0.0, -0.006),
                (0.011, -0.006),
                (0.010, 0.002),
                (0.008, 0.006),
                (0.0, 0.006),
            ]
            boss = create_lathe_object(
                f"Trophy_HandleBoss_{side_label}_{boss_label}",
                boss_profile,
                steps=24,
                material=materials["gold_24k"],
                smooth_angle_deg=38.0,
                parent=root,
            )
            boss.location = (bx, 0.0, bz)
            boss.rotation_euler = (0.0, math.radians(pitch_deg), 0.0)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_materials="EXPORT",
    )


# ---------------------------------------------------------------------------
# GLB Binary Verification
# ---------------------------------------------------------------------------

def inspect_glb(path: Path) -> dict:
    """Validate GLB header, extract triangle count, mesh count, and Y-up bounding box."""
    data = path.read_bytes()
    if len(data) < 20:
        raise RuntimeError(f"GLB file too small: {path}")

    magic, version, total_length = struct.unpack("<4sII", data[:12])
    if magic != b"glTF":
        raise RuntimeError(f"Invalid GLB magic header {magic!r} in {path}")
    if total_length != len(data):
        raise RuntimeError(f"GLB length mismatch ({total_length} vs {len(data)}) in {path}")

    chunk_len, chunk_type = struct.unpack("<II", data[12:20])
    if chunk_type != 0x4E4F534A:  # 'JSON'
        raise RuntimeError(f"First GLB chunk is not JSON in {path}")

    gltf = json.loads(data[20 : 20 + chunk_len].decode("utf-8"))
    accessors = gltf.get("accessors", [])
    meshes = gltf.get("meshes", [])
    materials = gltf.get("materials", [])

    triangles = 0
    min_xyz = [float("inf"), float("inf"), float("inf")]
    max_xyz = [float("-inf"), float("-inf"), float("-inf")]

    for mesh in meshes:
        for prim in mesh.get("primitives", []):
            indices_idx = prim.get("indices")
            if indices_idx is not None:
                triangles += accessors[indices_idx]["count"] // 3
            else:
                pos_idx = prim["attributes"]["POSITION"]
                triangles += accessors[pos_idx]["count"] // 3

            pos_acc = accessors[prim["attributes"]["POSITION"]]
            pmin = pos_acc.get("min")
            pmax = pos_acc.get("max")
            if pmin and pmax:
                for i in range(3):
                    min_xyz[i] = min(min_xyz[i], pmin[i])
                    max_xyz[i] = max(max_xyz[i], pmax[i])

    # Compute world-space bounds across scene nodes when available
    nodes = gltf.get("nodes", [])
    world_min = [float("inf"), float("inf"), float("inf")]
    world_max = [float("-inf"), float("-inf"), float("-inf")]

    def visit_node(node_idx: int, parent_mat: Matrix) -> None:
        node = nodes[node_idx]
        if "matrix" in node:
            m_raw = node["matrix"]
            local_mat = Matrix((
                (m_raw[0], m_raw[4], m_raw[8], m_raw[12]),
                (m_raw[1], m_raw[5], m_raw[9], m_raw[13]),
                (m_raw[2], m_raw[6], m_raw[10], m_raw[14]),
                (m_raw[3], m_raw[7], m_raw[11], m_raw[15]),
            ))
        else:
            t = Vector(node.get("translation", [0.0, 0.0, 0.0]))
            q = node.get("rotation", [0.0, 0.0, 0.0, 1.0])  # xyzw
            s = Vector(node.get("scale", [1.0, 1.0, 1.0]))
            from mathutils import Quaternion
            rot_m = Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
            scale_m = Matrix.Diagonal((s.x, s.y, s.z, 1.0))
            trans_m = Matrix.Translation(t)
            local_mat = trans_m @ rot_m @ scale_m

        world_mat = parent_mat @ local_mat
        if "mesh" in node:
            mesh = meshes[node["mesh"]]
            for prim in mesh.get("primitives", []):
                pos_acc = accessors[prim["attributes"]["POSITION"]]
                pmin = pos_acc.get("min")
                pmax = pos_acc.get("max")
                if pmin and pmax:
                    for cx in (pmin[0], pmax[0]):
                        for cy in (pmin[1], pmax[1]):
                            for cz in (pmin[2], pmax[2]):
                                wp = world_mat @ Vector((cx, cy, cz))
                                for axis in range(3):
                                    world_min[axis] = min(world_min[axis], wp[axis])
                                    world_max[axis] = max(world_max[axis], wp[axis])
        for child_idx in node.get("children", []):
            visit_node(child_idx, world_mat)

    scene_idx = gltf.get("scene", 0)
    scenes = gltf.get("scenes", [])
    if scenes and nodes:
        for root_node in scenes[scene_idx].get("nodes", []):
            visit_node(root_node, Matrix.Identity(4))
    else:
        world_min, world_max = min_xyz, max_xyz

    return {
        "path": str(path),
        "bytes": len(data),
        "version": version,
        "meshes": len(meshes),
        "materials": len(materials),
        "triangles": triangles,
        "bounds_min": [round(v, 4) for v in world_min],
        "bounds_max": [round(v, 4) for v in world_max],
    }


def main() -> None:
    # Support optional output directory override after '--'
    out_dir = Path(__file__).resolve().parent.parent / "assets" / "showcase"
    argv = sys.argv
    if "--" in argv:
        extra = argv[argv.index("--") + 1 :]
        if "--output-dir" in extra:
            idx = extra.index("--output-dir")
            if idx + 1 < len(extra):
                out_dir = Path(extra[idx + 1]).resolve()

    stage_path = out_dir / "paddock_stage.glb"
    trophy_path = out_dir / "champion_trophy.glb"

    build_paddock_stage(stage_path)
    build_champion_trophy(trophy_path)

    stage_info = inspect_glb(stage_path)
    trophy_info = inspect_glb(trophy_path)
    combined_bytes = stage_info["bytes"] + trophy_info["bytes"]

    print("=== Blender Showcase Asset Build Summary ===")
    print(f"paddock_stage.glb   : {stage_info}")
    print(f"champion_trophy.glb : {trophy_info}")
    print(f"combined_bytes      : {combined_bytes} ({combined_bytes / 1024:.1f} KB)")

    if combined_bytes >= 1_200_000:
        raise RuntimeError(f"Combined GLB size {combined_bytes} exceeds 1.2 MB limit!")


if __name__ == "__main__":
    main()
