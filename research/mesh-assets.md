# Shape catalog and external mesh provenance

## Procedural baseline

`src/geometry/index.ts` exports `createForm(spec)`. The 24 objects are locally constructed meshes, not outputs of a learned 3D generator. Sphere, cube, vase, sword, tree, flower, fish, bird, chair, table, mug, bottle, house, tower, ring, star, heart, knot, shell, cone, pyramid, rock, cloud and mushroom have distinct surface geometry.

- A sword has a diamond-section blade, guard, grip and pommel. A vase and mug have an inner wall and an actual open mouth. Furniture uses separate legs and panels. Animals are intentionally simple silhouettes.
- Each result has positions, UVs, normals and an index. Zero-area triangles are omitted for downstream surface sampling. The default maximum bounding-box dimension is 2.6 units.
- Squareness deforms a rounded object toward a superellipsoid. A cube is already square and ignores this attribute. Elongation, twist, bend and mild coherent roughness transform the vertices. These are geometric controls, not fluid or elastic simulations.
- `count` belongs to scene placement and does not duplicate triangles inside the geometry function.
- The source pieces may intersect; this is constructive assembly without Boolean union. The model can contain hidden internal surfaces. Face sampling on the entire mesh must account for visibility if these would waste letters.
- These meshes have usable UVs but no claim of an optimised seamless unwrap. Triplanar texture projection can provide one common path for imported and generated meshes. Exporting UVs to a conventional material painter may need a later unwrap step.

The research-only viewer at `/src/geometry/preview.html` displays 24 silhouettes; `?deformed` applies combined attributes. It is a verification tool rather than the main app UI. It was opened in headless Chrome on this Mac, and both original and deformed surfaces were captured and visually inspected on 2026-09-30. The captures contain only synthetic geometry.

## Three optional external baselines

[Kenney's official Nature Kit page](https://kenney.nl/assets/nature-kit) lists the models under Creative Commons CC0. The official ZIP was downloaded from its own `kenney.nl` link on 2026-09-30. Its bundled license identifies Nature Kit 2.1. Only three OBJ meshes and the original license are included in this repository:

| File | Archive source | Bytes | SHA-256 |
|---|---|---:|---|
| `tree_oak.obj` | `Models/OBJ format/tree_oak.obj` | 18,279 | `1a1dba69f49a454492db2413110e0867dc6dc3d5fe412d2499047625c93a3c06` |
| `mushroom_red.obj` | `Models/OBJ format/mushroom_red.obj` | 3,429 | `aea11334dbf3e587652405626d3d59ffc91b7e423cfe117e70c68829d55ebd9b` |
| `flower_purpleA.obj` | `Models/OBJ format/flower_purpleA.obj` | 5,745 | `039c21db5a505edeb9d889077436b5f18055ae28b58ad89795b016ee29981479` |

The entire archive is 10,537,521 bytes with SHA-256 `fa7974a0d342bfe63c38664ba9f8ec1a4aab8ea25f099bdc56870e33588c4d9d`. Its download URL, license and per-file hashes are also recorded in `public/models/kenney/manifest.json`. The original `License.txt` is retained beside the meshes.

These are **geometry-only imports** for the letter-surface experiment. Their original MTL materials and colour textures are not copied or loaded; an OBJ loader can parse geometry without fetching the referenced MTL. The common letter shader should replace the original appearance.

Safety checks were limited to official HTTPS provenance, archive listing, restricted extraction of the named data files, hashes, and inspection that the OBJ files contain mesh/material declarations. No executable or remote installation script was run. A cryptographic hash records the downloaded bytes; it is not a malware-scan result or a publisher signature.

License reference: [Creative Commons CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Models by Kenney (www.kenney.nl).
