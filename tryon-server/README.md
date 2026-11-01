# Tryanything CatVTON server

A small GPU server that dresses a person photo in a garment photo with [CatVTON](https://github.com/Zheng-Chong/CatVTON)
(a diffusion virtual try-on model). The Next.js site calls it from `/api/v1/tryon-photo` when `CATVTON_URL` is set.
It removes the person's current clothing and fits the new garment, like Decart does, but on **still photos**, not live video.

## ⚠️ License: non-commercial only

CatVTON's **code and weights are CC BY-NC-SA 4.0**: no commercial use, attribution required, derivatives must use the same
licence. Use this for personal, research or educational projects. To charge money, show ads, or use it in a business you
need a commercial licence from the CatVTON authors, or a different model. This is the user's responsibility.

## What is and isn't verified

| | Status |
|---|---|
| HTTP API (auth, validation, limits, queue, error handling) | ✅ 10 automated tests (`pytest tests`) with a fake model |
| `tryon_runner.py` syntax and fidelity to CatVTON's official `app.py` | ✅ syntax-checked; code mirrors the upstream pipeline/AutoMasker/mask-blur/call |
| The real model producing a good picture | ❌ **never run**: development machine has no NVIDIA GPU |
| Docker image build | ❌ never built |

Expect to debug the first run (version pins in CatVTON's `requirements.txt` are old: torch 2.1.2, Python 3.9-era).

## Requirements

- NVIDIA GPU. CatVTON's README states about **8 GB VRAM** for bf16 at 1024×768; 12–16 GB is safer.
  GPUs without bf16 (e.g. T4): set `TRYON_PRECISION=fp16`.
- Docker with the NVIDIA container toolkit, and ~15 GB disk for weights.
- A public **HTTPS** URL for the site to call (cloud GPU providers usually give you one, or put Caddy/nginx in front).
  A GPU you pay for by the hour costs money while idle; stop it when you're not using it.

## Run

```bash
cd tryon-server
docker build -t tryon-server --build-arg CATVTON_REF=main .
docker run --gpus all -p 8000:8000 -v tryon-models:/models \
  -e TRYON_TOKEN="$(openssl rand -hex 32)" tryon-server
```
Keep the token: the website needs the same value. First start downloads the weights (several GB).

Check readiness:
```bash
curl http://localhost:8000/healthz        # {"ready":false,"loading":true,...} → wait → {"ready":true,...}
```
Try it:
```bash
curl -X POST http://localhost:8000/tryon \
  -H "Authorization: Bearer <TRYON_TOKEN>" \
  -F person=@me.jpg -F garment=@shirt.jpg -F cloth_type=upper -o result.png
```
`cloth_type`: `upper` (tops/jackets), `lower` (trousers/skirts), `overall` (dresses/full outfits).

## Connect the website (Vercel → Settings → Environment Variables)

| Name | Value |
|---|---|
| `CATVTON_URL` | `https://your-gpu-host.example.com` (no trailing slash, no path) |
| `CATVTON_TOKEN` | the same `TRYON_TOKEN` |

Redeploy. The "Realistic photo" button now uses your server. If both `CATVTON_URL` and `GEMINI_API_KEY` are set, CatVTON
wins unless you set `TRYON_PROVIDER=gemini`. The first request after the server starts can take over a minute while the
model loads; the site's request limit is 60 s, so wait for `/healthz` to say `ready` before testing.

## Settings (environment variables)

| Name | Default | Meaning |
|---|---|---|
| `TRYON_TOKEN` | — (required) | Bearer token the website must send |
| `TRYON_PRECISION` | `bf16` | `fp16` for GPUs without bf16 |
| `TRYON_STEPS` | `30` | Diffusion steps (CatVTON's UI default is 50; fewer = faster) |
| `TRYON_WIDTH` / `TRYON_HEIGHT` | `768` / `1024` | Working resolution |
| `BASE_MODEL` | `booksforcharlie/stable-diffusion-inpainting` | If this 404s, use the `--base_model_path` default from the CatVTON `app.py` you cloned |
| `MAX_QUEUE` | `3` | Requests allowed to wait for the GPU before replying 503 |

## Troubleshooting

- `/healthz` returns an `error`: it is shown there (e.g. "No CUDA GPU found", a missing weights file, an import error).
- `ModuleNotFoundError: model` / `utils`: `PYTHONPATH` must include the cloned CatVTON repo (the Dockerfile sets it).
- Out of memory: lower `TRYON_WIDTH`/`TRYON_HEIGHT`, use `fp16`, or a bigger GPU.
- Poor result: use a clear, front-facing photo with the upper body visible; plain-background garment photos work best.
