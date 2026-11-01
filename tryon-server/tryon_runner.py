"""CatVTON model wrapper. Mirrors the official CatVTON `app.py` (Zheng-Chong/CatVTON): same imports, same pipeline and
AutoMasker construction, same mask blur and pipeline call. Requires the CatVTON repo on PYTHONPATH (the Dockerfile
clones it to /opt/CatVTON) and an NVIDIA GPU (~8 GB VRAM for bf16 at 1024x768 according to the CatVTON README).

NOT TESTED IN THIS REPOSITORY'S CI: it needs a GPU and several GB of weights. See README.md for the first-run checklist.

LICENSE NOTICE: CatVTON code and weights are CC BY-NC-SA 4.0 (non-commercial).
"""

import os

import torch
from diffusers.image_processor import VaeImageProcessor
from huggingface_hub import snapshot_download
from PIL import Image

# These come from the CatVTON repository (PYTHONPATH=/opt/CatVTON), not from this folder.
from model.cloth_masker import AutoMasker
from model.pipeline import CatVTONPipeline
from utils import init_weight_dtype, resize_and_crop, resize_and_padding

RESUME_PATH = os.environ.get("CATVTON_WEIGHTS", "zhengchong/CatVTON")
# CatVTON's default base model is a Stable Diffusion inpainting checkpoint. If this download 404s, set BASE_MODEL to
# the value of --base_model_path in the CatVTON app.py you cloned.
BASE_MODEL = os.environ.get("BASE_MODEL", "booksforcharlie/stable-diffusion-inpainting")
WIDTH = int(os.environ.get("TRYON_WIDTH", 768))
HEIGHT = int(os.environ.get("TRYON_HEIGHT", 1024))
STEPS = int(os.environ.get("TRYON_STEPS", 30))  # CatVTON's UI default is 50; 30 is noticeably faster with little loss
GUIDANCE = float(os.environ.get("TRYON_GUIDANCE", 2.5))
PRECISION = os.environ.get("TRYON_PRECISION", "bf16")  # use "fp16" on GPUs without bf16 (e.g. T4)


class CatVTONRunner:
    def __init__(self) -> None:
        if not torch.cuda.is_available():
            raise RuntimeError("No CUDA GPU found. CatVTON needs an NVIDIA GPU.")
        repo_path = snapshot_download(repo_id=RESUME_PATH)
        self.pipeline = CatVTONPipeline(
            base_ckpt=BASE_MODEL,
            attn_ckpt=repo_path,
            attn_ckpt_version="mix",
            weight_dtype=init_weight_dtype(PRECISION),
            use_tf32=True,
            device="cuda",
        )
        self.mask_processor = VaeImageProcessor(
            vae_scale_factor=8, do_normalize=False, do_binarize=True, do_convert_grayscale=True
        )
        self.automasker = AutoMasker(
            densepose_ckpt=os.path.join(repo_path, "DensePose"),
            schp_ckpt=os.path.join(repo_path, "SCHP"),
            device="cuda",
        )

    def run(self, person: Image.Image, garment: Image.Image, cloth_type: str, seed: int) -> Image.Image:
        person = resize_and_crop(person, (WIDTH, HEIGHT))
        cloth = resize_and_padding(garment, (WIDTH, HEIGHT))
        mask = self.automasker(person, cloth_type)["mask"]
        mask = self.mask_processor.blur(mask, blur_factor=9)
        generator = torch.Generator(device="cuda").manual_seed(seed) if seed != -1 else None
        with torch.no_grad():
            result = self.pipeline(
                image=person,
                condition_image=cloth,
                mask=mask,
                num_inference_steps=STEPS,
                guidance_scale=GUIDANCE,
                generator=generator,
            )[0]
        torch.cuda.empty_cache()
        return result
