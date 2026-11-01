"""API tests with a fake model: no GPU, no weights, no torch. Run: pytest tryon-server/tests"""

import io
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tryon_api  # noqa: E402

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def png(size=(64, 96), color=(200, 30, 30), mode="RGB", fmt="PNG") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, color if mode == "RGB" else color + (128,)).save(buf, format=fmt)
    return buf.getvalue()


class FakeRunner:
    def __init__(self):
        self.calls = []

    def run(self, person, garment, cloth_type, seed):
        self.calls.append((person.size, garment.size, cloth_type, seed, person.mode, garment.mode))
        return Image.new("RGB", (32, 48), (0, 255, 0))


@pytest.fixture
def client_and_runner():
    runner = FakeRunner()
    app = tryon_api.create_app(runner_factory=lambda: runner, token=TOKEN)
    with TestClient(app) as c:  # runs the startup hook (background load)
        for _ in range(50):
            if c.get("/healthz").json()["ready"]:
                break
            time.sleep(0.05)
        yield c, runner


def files(person=None, garment=None):
    return {
        "person": ("p.png", person if person is not None else png(), "image/png"),
        "garment": ("g.png", garment if garment is not None else png(color=(10, 10, 200)), "image/png"),
    }


def test_healthz_reports_ready(client_and_runner):
    c, _ = client_and_runner
    assert c.get("/healthz").json() == {"ready": True, "loading": False, "error": None}


def test_returns_a_png_and_passes_options_to_the_model(client_and_runner):
    c, runner = client_and_runner
    r = c.post("/tryon", files=files(), data={"cloth_type": "overall", "seed": "7"}, headers=AUTH)
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(r.content)).size == (32, 48)
    assert runner.calls == [((64, 96), (64, 96), "overall", 7, "RGB", "RGB")]


def test_requires_the_bearer_token(client_and_runner):
    c, runner = client_and_runner
    assert c.post("/tryon", files=files()).status_code == 401
    assert c.post("/tryon", files=files(), headers={"Authorization": "Bearer nope"}).status_code == 401
    assert runner.calls == []


def test_refuses_to_run_without_a_configured_token():
    app = tryon_api.create_app(runner_factory=FakeRunner, token="")
    with TestClient(app) as c:
        assert c.post("/tryon", files=files(), headers=AUTH).status_code == 503


def test_validates_cloth_type_and_seed(client_and_runner):
    c, runner = client_and_runner
    assert c.post("/tryon", files=files(), data={"cloth_type": "hat"}, headers=AUTH).status_code == 400
    assert c.post("/tryon", files=files(), data={"seed": "99999999999"}, headers=AUTH).status_code == 400
    assert runner.calls == []


def test_rejects_non_images_and_unsupported_formats(client_and_runner):
    c, runner = client_and_runner
    assert c.post("/tryon", files=files(person=b"<svg/>"), headers=AUTH).status_code == 415
    assert c.post("/tryon", files=files(person=b""), headers=AUTH).status_code == 400
    assert c.post("/tryon", files=files(garment=png(fmt="GIF", mode="RGB")), headers=AUTH).status_code == 415
    assert runner.calls == []


def test_rejects_oversized_uploads_and_dimensions(client_and_runner, monkeypatch):
    c, runner = client_and_runner
    monkeypatch.setattr(tryon_api, "MAX_UPLOAD_BYTES", 1000)
    assert c.post("/tryon", files=files(person=b"\xff\xd8\xff" + b"0" * 2000), headers=AUTH).status_code == 413
    monkeypatch.setattr(tryon_api, "MAX_UPLOAD_BYTES", 6 * 1024 * 1024)
    monkeypatch.setattr(tryon_api, "MAX_SIDE", 50)
    assert c.post("/tryon", files=files(), headers=AUTH).status_code == 413
    assert runner.calls == []


def test_transparent_garments_are_flattened_to_rgb_on_white(client_and_runner):
    c, runner = client_and_runner
    rgba = png(mode="RGBA", color=(10, 20, 30), fmt="PNG")
    assert c.post("/tryon", files=files(garment=rgba), headers=AUTH).status_code == 200
    assert runner.calls[0][5] == "RGB"


def test_model_failures_are_generic_and_do_not_leak_details():
    class Boom:
        def run(self, *a):
            raise RuntimeError("CUDA out of memory secret-path /root/x")

    app = tryon_api.create_app(runner_factory=Boom, token=TOKEN)
    with TestClient(app) as c:
        for _ in range(50):
            if c.get("/healthz").json()["ready"]:
                break
            time.sleep(0.05)
        r = c.post("/tryon", files=files(), headers=AUTH)
    assert r.status_code == 500
    assert "CUDA" not in r.text and "secret-path" not in r.text


def test_load_failure_is_reported_by_healthz_and_blocks_requests():
    def broken():
        raise RuntimeError("No CUDA GPU found")

    app = tryon_api.create_app(runner_factory=broken, token=TOKEN)
    with TestClient(app) as c:
        for _ in range(50):
            if c.get("/healthz").json()["error"]:
                break
            time.sleep(0.05)
        h = c.get("/healthz")
        assert h.status_code == 500 and "No CUDA GPU" in h.json()["error"]
        assert c.post("/tryon", files=files(), headers=AUTH).status_code == 503
