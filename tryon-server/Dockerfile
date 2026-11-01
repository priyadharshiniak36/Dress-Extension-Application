# Self-hosted CatVTON try-on server. Needs an NVIDIA GPU at runtime (nvidia-container-toolkit on the host).
# LICENSE: CatVTON code and weights are CC BY-NC-SA 4.0 (non-commercial). See README.md.
#
# NOT BUILT OR RUN IN THIS REPOSITORY'S DEVELOPMENT ENVIRONMENT (no Docker / NVIDIA GPU available there).
# Pin CATVTON_REF to a commit you have verified: the CatVTON repo is unversioned and its layout may change.
FROM pytorch/pytorch:2.1.2-cuda12.1-cudnn8-runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends git libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

ARG CATVTON_REF=main
RUN git clone https://github.com/Zheng-Chong/CatVTON.git /opt/CatVTON \
 && cd /opt/CatVTON && git checkout "${CATVTON_REF}"

# CatVTON's own requirements, minus what is already in the base image or only the Gradio demo needs.
RUN grep -viE '^(gradio|setuptools|torch|torchvision|ninja)' /opt/CatVTON/requirements.txt > /tmp/catvton-req.txt \
 && pip install --no-cache-dir -r /tmp/catvton-req.txt

WORKDIR /srv/tryon
COPY requirements-server.txt .
RUN pip install --no-cache-dir -r requirements-server.txt
COPY tryon_api.py tryon_runner.py ./

# CatVTON's `model` and `utils` packages are imported from the cloned repo; ours are named tryon_* to avoid clashes.
ENV PYTHONPATH=/opt/CatVTON:/srv/tryon \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models

# Weights (several GB) download on first start into /models; mount a volume there so restarts are fast.
VOLUME ["/models"]
EXPOSE 8000
CMD ["uvicorn", "tryon_api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
