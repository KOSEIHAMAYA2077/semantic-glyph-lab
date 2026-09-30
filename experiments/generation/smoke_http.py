"""One explicitly artificial prompt. Only this evaluation writes its output."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import numpy as np
import trimesh

FOLDER = Path(__file__).resolve().parent
PROMPT = "a teapot"
OUT = FOLDER / "teapot-v1.glb"
REPORT = FOLDER / "teapot-v1.json"
if OUT.exists() or REPORT.exists():
    raise SystemExit("Existing experiment retained. Choose a new output name for another run.")


def request(text):
    started = time.perf_counter()
    req = Request("http://127.0.0.1:4186/generate", data=json.dumps({"text": text}).encode(), headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:4183"})
    try: response = urlopen(req, timeout=150)
    except HTTPError as error: response = error
    data = response.read()
    return response.status, dict(response.headers), data, round((time.perf_counter() - started) * 1000)


with ThreadPoolExecutor(max_workers=1) as pool:
    future = pool.submit(request, PROMPT)
    deadline = time.perf_counter() + 15
    busy = False
    while time.perf_counter() < deadline:
        with urlopen("http://127.0.0.1:4186/health", timeout=5) as response:
            busy = json.load(response)["busy"]
        if busy: break
        time.sleep(.1)
    if not busy: raise RuntimeError("Service did not enter its busy state")
    busy_status, _, _, busy_ms = request("a cube")
    if busy_status != 503: raise RuntimeError("Concurrent request was not rejected")
    status, headers, data, wall_ms = future.result()

if status != 200: raise RuntimeError(f"Generation failed with HTTP {status}")
mesh = trimesh.load(io.BytesIO(data), file_type="glb", force="mesh", process=False)
if len(mesh.faces) < 4 or not np.isfinite(mesh.vertices).all(): raise RuntimeError("Invalid GLB round-trip")
with OUT.open("xb") as file: file.write(data)
report = {
    "input": PROMPT, "purpose": "artificial HTTP integration case; not user text",
    "status": status, "httpWallMs": wall_ms,
    "generationMs": int(headers["X-Generation-Ms"]), "sampleMs": int(headers["X-Sample-Ms"]),
    "clipTokens": int(headers["X-CLIP-Tokens"]), "seed": int(headers["X-Generation-Seed"]),
    "steps": 32, "grid": 128, "device": "mps", "bytes": len(data),
    "sha256": hashlib.sha256(data).hexdigest(), "vertices": len(mesh.vertices), "faces": len(mesh.faces),
    "finite": bool(np.isfinite(mesh.vertices).all()), "bounds": mesh.bounds.tolist(),
    "area": float(mesh.area), "watertight": bool(mesh.is_watertight),
    "windingConsistent": bool(mesh.is_winding_consistent), "components": len(mesh.split(only_watertight=False)),
    "concurrentRequest": {"status": busy_status, "wallMs": busy_ms},
    "output": OUT.name,
}
with REPORT.open("x") as file: json.dump(report, file, indent=2)
print(json.dumps(report), flush=True)
