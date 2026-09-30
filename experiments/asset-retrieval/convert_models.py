"""Create separate geometry-only, Y-up GLBs while keeping every official source file."""
from __future__ import annotations

import datetime
import hashlib
import json
from pathlib import Path
import struct

import numpy as np
import trimesh

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
PUBLIC=ROOT/"public/retrieval-models"
LOCAL=ROOT/".local/asset-retrieval-originals"
DESCRIPTIONS={
    "ceramic_vase_03":"A tall ceramic vase with a narrow rectangular body and an opening at the top.",
    "watering_can_metal_01":"A metal watering can with a rounded container, curved handles and a long spout.",
    "wooden_handle_saber":"A saber with a long curved blade, a wooden handle and a crossguard.",
}


def main():
    manifest=json.loads((HERE/"source-manifest.json").read_text())
    PUBLIC.mkdir(parents=True,exist_ok=True)
    for entry in manifest["files"]:
        raw=(LOCAL/entry["asset"]/entry["relativePath"]).read_bytes()
        if len(raw)!=entry["bytes"] or hashlib.sha256(raw).hexdigest()!=entry["sha256"]:
            raise RuntimeError("Original source changed")
    models=[]
    labels={"ceramic_vase_03":"素材検索: 陶器の花瓶", "watering_can_metal_01":"素材検索: じょうろ", "wooden_handle_saber":"素材検索: 剣（ねじれ未反映）"}
    for model in manifest["models"]:
        source=LOCAL/model["id"]/model["mainFile"]
        scene=trimesh.load_scene(source,process=False)
        combined=scene.to_mesh()
        mesh=trimesh.Trimesh(vertices=combined.vertices.copy(), faces=combined.faces.copy(), vertex_normals=combined.vertex_normals.copy(),process=False)
        if not np.isfinite(mesh.vertices).all() or len(mesh.faces)<4 or mesh.faces.min()<0 or mesh.faces.max()>=len(mesh.vertices):
            raise RuntimeError("Invalid source mesh")
        data=mesh.export(file_type="glb",include_normals=True)
        header_size=struct.unpack_from("<I",data,12)[0]
        gltf=json.loads(data[20:20+header_size])
        if gltf.get("images") or gltf.get("textures"):
            raise RuntimeError("Derived GLB unexpectedly retained textures")
        name=model["id"]+"-geometry.glb"
        with (PUBLIC/name).open("xb") as out:out.write(data)
        reloaded=trimesh.load_scene(PUBLIC/name,process=False).to_mesh()
        if not np.array_equal(reloaded.faces,mesh.faces) or not np.allclose(reloaded.vertices,mesh.vertices,rtol=1e-6,atol=1e-7):
            raise RuntimeError("Geometry changed in export")
        welded=mesh.copy();welded.merge_vertices()
        components=welded.split(only_watertight=False)
        areas=sorted((float(part.area) for part in components),reverse=True)
        models.append({"id":"polyhaven-"+model["id"],"label":labels[model["id"]],"path":"/retrieval-models/"+name,"sha256":hashlib.sha256(data).hexdigest(),"bytes":len(data),
                       "name":model["name"],"description":DESCRIPTIONS[model["id"]],"descriptionOrigin":"New concise factual description written for this experiment; not copied API prose.",
                       "catalogueScope":"One of three already-downloaded assets. The other 518 catalogue meshes are not available locally.",
                       "source":model["source"],"assetId":model["id"],"authors":model["authors"],"license":"CC0-1.0","licenseSource":"https://polyhaven.com/license","credit":"Powered by Poly Haven",
                       "sourceMethod":"Multilingual metadata retrieval of existing CC0 mesh, not 3D generation","originalSourcePreserved":True,
                       "derivation":"Read official glTF2 scene transforms, flatten geometry, preserve normals, omit original material and textures. Y-up per glTF. No repair, simplification or requested twist deformation.",
                       "vertices":len(mesh.vertices),"faces":len(mesh.faces),"bounds":mesh.bounds.tolist(),"finite":bool(np.isfinite(mesh.vertices).all()),"geometryRoundtripVerified":True,
                       "componentsAfterWeldingForInspectionOnly":len(components),"watertightAfterWeldingForInspectionOnly":bool(welded.is_watertight),"largestComponentAreaShare":areas[0]/sum(areas),
                       "retrievalCaveat":"Sword base object found, but requested twist not represented." if model["id"]=="wooden_handle_saber" else "Object and requested material or spout found; mesh details are verified separately in comparison images."})
        print(model["id"],len(mesh.vertices),len(mesh.faces),len(data),flush=True)
    report={"createdUTC":datetime.datetime.now(datetime.timezone.utc).isoformat(),"credit":"Powered by Poly Haven","apiTerms":"https://github.com/Poly-Haven/Public-API/blob/master/ToS.md",
            "license":"CC0-1.0 for these asset-derived GLBs. Bulk API metadata is not redistributed or labeled CC0.","sourceManifest":"experiments/asset-retrieval/source-manifest.json","models":models,
            "runtimeRetrievalScope":{"count":3,"inputFields":["name","description"],"descriptionRights":"Original experiment descriptions; asset names and source links identify CC0 assets. No bulk metadata or site preview is republished.","availability":"Local geometry-only GLBs only; no runtime API download is implied."}}
    with (PUBLIC/"manifest.json").open("x") as out:json.dump(report,out,ensure_ascii=False,indent=2);out.write("\n")


if __name__=="__main__":
    main()
