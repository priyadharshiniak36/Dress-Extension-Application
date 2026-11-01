"""HTTP API for the self-hosted CatVTON try-on service.

The model code lives in tryon_runner.py and is imported lazily, so everything in this file (auth, validation,
queueing, limits) runs and is tested without a GPU. Module names are prefixed `tryon_` on purpose: CatVTON's own
repository has `app.py` and `utils.py`, which must stay importable under their original names.

LICENSE NOTICE: CatVTON's code and weights are CC BY-NC-SA 4.0 (non-commercial, share-alike). This service is for
personal / research / educational use unless you obtain a commercial licence from the CatVTON authors.
"""

from __future__ import annotations

import asyncio
import hmac
import io
import os
import threading
from contextlib import asynccontextmanager
from typing import Callable, Optional, Protocol

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image, UnidentifiedImageError

MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", 6 * 1024 * 1024))
MAX_SIDE = 4096  # reject absurd dimensions before any decoding work (decompression bombs)
CLOTH_TYPES = ("upper", "lower", "overall")
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

# Hard limit on how many requests may wait for the single GPU; the rest get a quick 503 instead of timing out.
MAX_QUEUE = int(os.environ.get("MAX_QUEUE", 3))


class Runner(Protocol):
    def run(self, person: Image.Image, garment: Image.Image, cloth_type: str, seed: int) -> Image.Image: ...


def _decode(data: bytes, field: str) -> Image.Image:
    if not data:
        raise HTTPException(400, f"`{field}` is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"`{field}` is too large.")
    try:
        probe = Image.open(io.BytesIO(data))
        fmt = probe.format
        if fmt not in ALLOWED_FORMATS:
            raise HTTPException(415, f"`{field}` must be a JPEG, PNG or WebP image.")
        if max(probe.size) > MAX_SIDE:
            raise HTTPException(413, f"`{field}` dimensions are too large.")
        img = Image.open(io.BytesIO(data))
        img.load()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(415, f"`{field}` is not a valid image.") from None
    if img.mode in ("RGBA", "LA", "P"):
        # Flatten transparency onto white (product photos), like the web app does.
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        bg.alpha_composite(img)
        img = bg
    return img.convert("RGB")


def create_app(runner_factory: Optional[Callable[[], Runner]] = None, token: Optional[str] = None) -> FastAPI:
    """`runner_factory` builds the model (slow, GPU). Tests pass a fake one."""
    secret = token if token is not None else os.environ.get("TRYON_TOKEN", "")
    state: dict = {"runner": None, "error": None, "waiting": 0}
    gpu_lock = asyncio.Lock()

    def load() -> None:
        try:
            factory = runner_factory
            if factory is None:
                from tryon_runner import CatVTONRunner  # heavy imports happen here, not at import time

                factory = CatVTONRunner
            state["runner"] = factory()
        except Exception as exc:  # noqa: BLE001 - surfaced through /healthz, not swallowed
            state["error"] = f"{type(exc).__name__}: {exc}"

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        # Load the model in the background so the server answers /healthz immediately while weights download.
        threading.Thread(target=load, name="model-loader", daemon=True).start()
        yield

    app = FastAPI(title="Tryanything CatVTON server", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    @app.get("/healthz")
    def healthz() -> JSONResponse:
        ready = state["runner"] is not None
        body = {"ready": ready, "loading": not ready and state["error"] is None, "error": state["error"]}
        return JSONResponse(body, status_code=200 if ready or state["error"] is None else 500)

    @app.post("/tryon")
    async def tryon(
        person: UploadFile = File(...),
        garment: UploadFile = File(...),
        cloth_type: str = Form("upper"),
        seed: int = Form(42),
        authorization: Optional[str] = Header(default=None),
    ) -> Response:
        if not secret:
            raise HTTPException(503, "Server has no TRYON_TOKEN configured.")
        given = (authorization or "").removeprefix("Bearer ").strip()
        if not hmac.compare_digest(given.encode(), secret.encode()):
            raise HTTPException(401, "Unauthorized.")
        if cloth_type not in CLOTH_TYPES:
            raise HTTPException(400, f"cloth_type must be one of {', '.join(CLOTH_TYPES)}.")
        if not -1 <= seed <= 2**31 - 1:
            raise HTTPException(400, "seed out of range.")

        person_img = _decode(await person.read(MAX_UPLOAD_BYTES + 1), "person")
        garment_img = _decode(await garment.read(MAX_UPLOAD_BYTES + 1), "garment")

        runner = state["runner"]
        if runner is None:
            raise HTTPException(503, "Model is still loading. Try again in a minute." if state["error"] is None else "Model failed to load.")
        if state["waiting"] >= MAX_QUEUE:
            raise HTTPException(503, "Busy. Try again shortly.")

        state["waiting"] += 1
        try:
            async with gpu_lock:  # one inference at a time on the GPU
                result = await asyncio.to_thread(runner.run, person_img, garment_img, cloth_type, seed)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            # Log the detail server-side only; never echo model/stack details to the caller.
            print(f"[tryon] inference failed: {type(exc).__name__}: {exc}", flush=True)
            raise HTTPException(500, "Inference failed.") from None
        finally:
            state["waiting"] -= 1

        buf = io.BytesIO()
        result.convert("RGB").save(buf, format="PNG")
        return Response(buf.getvalue(), media_type="image/png", headers={"Cache-Control": "no-store"})

    return app
