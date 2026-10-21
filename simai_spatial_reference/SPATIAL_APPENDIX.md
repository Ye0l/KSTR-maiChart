# Simai Spatial Appendix — Machine-Readable Reference

Source: https://w.atwiki.jp/simai/pages/1003.html

Original reference images:
- Slide endpoint validity: https://img.atwiki.jp/simai/attach/1003/54/slides_eng.png
- Sensor layout: https://img.atwiki.jp/simai/attach/1003/52/bg.jpg

This appendix supplements the Simai notation specification. See `spatial_reference.json` for explicit coordinates and machine-readable rules, and `sensor_layout.svg` for a scalable visual layout.

## Coordinates

All positions are approximate centers in a 600 × 600 canvas, with origin top-left, positive X to the right and positive Y downward. The reference diagram is illustrative, not a source of authoritative sensor hitbox polygons. Do not treat these coordinates as game-engine collision geometry.

- The 8 button sectors align with A1–A8.
- A/B sensors are centered at angles -67.5° + 45°(n-1) relative to right, clockwise on screen.
- D/E sensors are centered at angles -90° + 45°(n-1).
- Approximate radii in pixels: A 254, B 120, D 247, E 172; center at (300,300).
- C, C1, C2 are normalized to the same central TOUCH position. The physical center consists of two sensors, which should not be inferred to have identical hardware positions from this diagram.

## Slide endpoint validation

Let `d = (end - start + 8) % 8`, with 1–8 button indices.

| Slide shape | Validity rule per original diagram |
|---|---|
| Straight `-` | d ∈ {2,3,4,5,6} |
| Short arc `^` | d ∈ {1,2,3,5,6,7} |
| V via center `v` | d ∈ {1,2,3,5,6,7} |
| `<`, `>` | Any start/end pair, including same-position pair in source diagram |
| `p`, `q`, `pp`, `qq` | Any start/end pair, including same-position pair in source diagram |
| Thunderbolt `s`, `z` | d = 4 only |
| Fan `w` | d = 4 only |
| Grand V `V` | See below |

A gray `—` in the source means an inapplicable same-point combination, and is not the same as `×` in other tables. For the full-arcs and p/q curves the source marks even identical endpoints as drawable.

### Grand V `V`

Input is `start V middle end`, e.g. `1V35`. Both constraints must hold:

1. `(middle - start + 8) % 8` is 2 or 6.
2. Let `e = (end - middle + 8) % 8`. If e is 3, 4, or 5, the end is valid. If e is 2 or 6, it is valid **only if** `end` is opposite `start`, i.e. `(end - start + 8) % 8 == 4`. All other end positions are invalid.

The numeric cells in the source image designate which start button qualifies for the edge case, not a numeric path parameter.

## Geometry is separate from endpoint validation

SLIDE tokens define symbolic path families. Endpoints plus sensor center coordinates do not determine the precise shape of a `p`, `q`, `pp`, `qq`, `s`, `z`, `w`, or `V` track. Geometrically accurate rendering requires verified control points or a separately specified path implementation. Preserve the symbolic tokens instead of inventing trajectories.

For 3D visualization, the time dimension should be added *after* computing SLIDE waiting and tracing intervals. Use an independent, verified interpolation for each shape.
