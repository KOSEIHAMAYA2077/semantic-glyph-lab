"""Preserve three complete official 1K glTF assets, with strict local file bounds."""
from __future__ import annotations

import datetime
import hashlib
import json
from pathlib import Path, PurePosixPath
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
LOCAL = ROOT/".local/asset-retrieval-metadata"
DEST = ROOT/".local/asset-retrieval-originals"
SELECTED = ["ceramic_vase_03", "watering_can_metal_01", "wooden_handle_saber"]
USER_AGENT = "SemanticGlyphLab-AssetRetrieval/0.1 (independent research; local metadata search)"
LIMIT = 1_000_000_000


def valid_path(value):
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in (".", "..") for part in path.parts) or "\\" in value:
        raise RuntimeError("Unsafe relative asset path")
    return path


def main():
    catalogue = json.loads((LOCAL/"catalogue.json").read_text())
    selections = []
    total_bytes = sum(path.stat().st_size for path in LOCAL.iterdir() if path.is_file())
    for asset in SELECTED:
        filedata = json.loads((LOCAL/(asset+"-files.json")).read_text())
        entry = filedata["gltf"]["1k"]["gltf"]
        main_name = PurePosixPath(urllib.parse.urlparse(entry["url"]).path).name
        entries = {main_name:{key:value for key,value in entry.items() if key!="include"}, **entry["include"]}
        total_bytes += sum(item["size"] for item in entries.values())
        selections.append((asset,main_name,entries))
    if total_bytes > LIMIT:
        raise RuntimeError("The selected assets exceed the one-GB budget")
    report = {"startedUTC":datetime.datetime.now(datetime.timezone.utc).isoformat(),"provider":"Poly Haven","credit":"Powered by Poly Haven",
              "assetLicense":"CC0-1.0","licenseSource":"https://polyhaven.com/license","apiTerms":"https://github.com/Poly-Haven/Public-API/blob/master/ToS.md",
              "selectedAfterRetrieval":True,"selectionReason":"Top1 name+description matches the base object for vase, watering can and sword. The saber does not satisfy the requested twist; it remains a partial match.",
              "files":[],"models":[]}
    for asset,main_name,entries in selections:
        directory=DEST/asset
        directory.mkdir(parents=True,exist_ok=True)
        for relative,item in entries.items():
            path=directory/valid_path(relative)
            path.parent.mkdir(parents=True,exist_ok=True)
            parsed=urllib.parse.urlparse(item["url"])
            if parsed.scheme!="https" or parsed.hostname!="dl.polyhaven.org" or not parsed.path.startswith("/file/ph-assets/Models/"):
                raise RuntimeError("Unexpected asset origin")
            request=urllib.request.Request(item["url"],headers={"User-Agent":USER_AGENT})
            sha,md5=hashlib.sha256(),hashlib.md5()
            size=0
            with urllib.request.urlopen(request,timeout=90) as response,path.open("xb") as out:
                while chunk:=response.read(1024*1024):
                    size+=len(chunk)
                    if size>item["size"]:
                        raise RuntimeError("Asset exceeds declared size; partial file retained")
                    out.write(chunk);sha.update(chunk);md5.update(chunk)
            expected_md5=item["md5"].zfill(32)
            if size!=item["size"] or md5.hexdigest()!=expected_md5:
                raise RuntimeError("Official size or MD5 mismatch; source retained")
            report["files"].append({"asset":asset,"relativePath":relative,"source":item["url"],"bytes":size,"sha256":sha.hexdigest(),"officialMD5":item["md5"],"actualMD5":md5.hexdigest()})
        gltf=json.loads((directory/main_name).read_text())
        for item in gltf.get("buffers",[])+gltf.get("images",[]):
            uri=item.get("uri")
            if uri is not None and (str(valid_path(uri)) not in entries or urllib.parse.urlparse(uri).scheme):
                raise RuntimeError("Unlisted glTF dependency")
        if gltf.get("asset",{}).get("version")!="2.0":
            raise RuntimeError("Unsupported glTF version")
        report["models"].append({"id":asset,"name":catalogue[asset]["name"],"source":"https://polyhaven.com/a/"+asset,"authors":catalogue[asset].get("authors",{}),"mainFile":main_name,"gltfExtensionsRequired":gltf.get("extensionsRequired",[]),"sourceKeptUnmodified":True})
        print(asset,"downloaded with all 1K glTF dependencies",flush=True)
    report.update(completedUTC=datetime.datetime.now(datetime.timezone.utc).isoformat(),downloadedAssetBytes=sum(item["bytes"] for item in report["files"]),metadataAndAssetsBytes=total_bytes)
    with (HERE/"source-manifest.json").open("x") as out:
        json.dump(report,out,ensure_ascii=False,indent=2);out.write("\n")


if __name__=="__main__":
    main()
