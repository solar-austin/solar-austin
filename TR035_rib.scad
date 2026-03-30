// ============================================================
//  TR035 Pottery Shaping Rib — OpenSCAD parametric model
//  Dimensions estimated from product image.  Units: mm.
//  Print flat on bed, no supports needed.
// ============================================================

$fn = 64;

// ── Dimensions ──────────────────────────────────────────────
RIB_H   = 125;    // total height (mm)
RIB_T   = 5;      // plate thickness
HOLE_R  = 9.5;    // finger-hole radius
HOLE_Y1 = 88;     // upper hole centre, from bottom
HOLE_Y2 = 38;     // lower hole centre, from bottom
N       = 150;    // polygon points per side (smoothness)

// ── Right-edge profile control points  [y, half_width] ──────
// The outline is mirror-symmetric about x = 0.
// Cosine-interpolated so transitions are smooth with no kinks.
CTRL = [
  [  0,  25 ],   // bottom edge
  [ 18,  21 ],   // lower waist begins
  [ 38,  17 ],   // lower pinch  (narrowest)
  [ 55,  24 ],   // mid bulge
  [ 63,  26 ],   // centre / widest
  [ 72,  21 ],   // upper waist begins
  [ 90,  17 ],   // upper pinch  (narrowest)
  [108,  23 ],   // upper recovery
  [125,  27 ],   // top flare
];

// ── Smooth cosine interpolation ──────────────────────────────
function coslerp(a, b, t) =
    a + (b - a) * (1 - cos(t * 180)) / 2;

// Find control-point segment index for height y
function seg(y) =
    let(n   = len(CTRL) - 2,
        hits = [for (i = [0:n]) if (CTRL[i][0] <= y) i])
    len(hits) == 0 ? 0 : hits[len(hits) - 1];

// Half-width at height y
function hw(y) =
    let(s  = seg(y),
        y0 = CTRL[s  ][0],  x0 = CTRL[s  ][1],
        y1 = CTRL[s+1][0],  x1 = CTRL[s+1][1],
        t  = (y - y0) / max(0.001, y1 - y0))
    coslerp(x0, x1, t);

// ── 2D outline (symmetric polygon, corners softened) ─────────
module outline_2d() {
    pts = concat(
        [for (i = [0:N])   let(y = RIB_H * i / N) [ hw(y),  y]],
        [for (i = [N:-1:0]) let(y = RIB_H * i / N) [-hw(y), y]]
    );
    // double offset rounds both convex corners and concave pinches
    offset(r = 2.5) offset(r = -2.5)
        polygon(pts);
}

// ── 3D rib with finger holes ─────────────────────────────────
module rib() {
    difference() {
        linear_extrude(RIB_T)
            outline_2d();

        // Upper finger hole
        translate([0, HOLE_Y1, -1])
            cylinder(r = HOLE_R, h = RIB_T + 2);

        // Lower finger hole
        translate([0, HOLE_Y2, -1])
            cylinder(r = HOLE_R, h = RIB_T + 2);
    }
}

rib();
