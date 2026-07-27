"""
Phase B Stage 5 — Modal service ที่รันโมเดล GGUF ของเราเอง (Typhoon2-Qwen2.5-7B Q4_K_M)
บน GPU T4 แล้วเปิดเป็น web endpoint ให้เว็บ (Vercel) ยิงมาสรุปการ์ดไทยทีละ batch

Deploy:
    modal secret create thai-summarizer-auth AUTH_TOKEN=<สุ่มสตริงยาวๆ>
    modal deploy phase-b/serve/modal_app.py     # ได้ URL มาใส่ env MODAL_SUMMARIZER_URL

โมเดลตรงกับ eval notebook (phase-b/notebooks/eval_gguf_colab.ipynb) เป๊ะ:
Llama(n_gpu_layers=-1, n_ctx=4096) + create_chat_completion(max_tokens=1024, temperature=0.0).
prompt (system/user) เว็บเป็นคนสร้างจาก SYSTEM_PROMPT + buildUserPrompt ใน src/lib/gemini.ts
แล้วส่งมาเป็น messages ตรงๆ — ที่นี่ไม่ยุ่งกับ prompt ไทย (single source of truth ที่ฝั่งเว็บ)
"""

import os

import modal

# ตัวโมเดลที่ชนะ Stage 3 → GGUF Q4 บน HF Hub (public repo, โหลดได้โดยไม่ต้อง token)
REPO_ID = "Tana-Pun/thai-paper-summarizer-7b"
GGUF_FILE = "typhoon2-qwen2.5-7b-instruct.Q4_K_M.gguf"
CACHE_DIR = "/cache"  # โมเดล cache บน Volume — cold start รอบถัดไปไม่ต้องโหลดใหม่

app = modal.App("thai-paper-summarizer")

# สร้าง llama-cpp-python จาก source พร้อม CUDA (เชื่อถือได้กว่าพึ่ง prebuilt wheel
# ที่บางเวอร์ชันไม่มีให้ตรง CUDA/Python) — build นานหน่อยตอนแรก แต่ทำครั้งเดียว
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-devel-ubuntu22.04", add_python="3.11"
    )
    .apt_install("git", "build-essential", "cmake")
    # Modal's builder defaults CC=clang, but we only ship gcc — pin gcc/g++ so
    # CMake finds a real compiler when building llama-cpp with CUDA.
    .env(
        {
            "CMAKE_ARGS": "-DGGML_CUDA=on",
            "FORCE_CMAKE": "1",
            "CC": "gcc",
            "CXX": "g++",
            "HF_HUB_ENABLE_HF_TRANSFER": "1",
        }
    )
    .pip_install(
        "llama-cpp-python",
        "huggingface_hub",
        "hf_transfer",
        "fastapi[standard]",
    )
)

cache = modal.Volume.from_name("thai-summarizer-cache", create_if_missing=True)

# หน่วงตัวสรุปต่อใบ ~10 วิ, batch ≤10 → เผื่อ timeout ยาวๆ ไว้
GEN_MAX_TOKENS = 1024


@app.cls(
    image=image,
    gpu="T4",
    volumes={CACHE_DIR: cache},
    secrets=[modal.Secret.from_name("thai-summarizer-auth")],
    scaledown_window=120,  # container อยู่ต่ออีก 2 นาทีหลัง request สุดท้าย (batch อยู่ครบ)
    timeout=600,
)
class Summarizer:
    @modal.enter()
    def load(self):
        from huggingface_hub import hf_hub_download
        from llama_cpp import Llama

        path = hf_hub_download(REPO_ID, GGUF_FILE, local_dir=CACHE_DIR)
        cache.commit()  # เก็บไฟล์ลง Volume ให้รอบหน้าใช้ซ้ำ
        self.llm = Llama(
            model_path=path,
            n_gpu_layers=-1,  # offload ทุก layer ขึ้น GPU
            n_ctx=4096,
            verbose=False,
        )
        print(f"[modal] loaded {GGUF_FILE}")

    @modal.fastapi_endpoint(method="POST")
    def generate(self, data: dict):
        """
        รับ:  {"token": "<AUTH_TOKEN>", "items": [{"system": str, "user": str}, ...]}
        คืน:  {"results": [{"raw": str} | {"error": str}, ...]}  (ลำดับตรงกับ items)
        """
        from fastapi import HTTPException

        expected = os.environ.get("AUTH_TOKEN")
        if not expected or data.get("token") != expected:
            raise HTTPException(status_code=401, detail="unauthorized")

        items = data.get("items") or []
        results = []
        for it in items:
            try:
                resp = self.llm.create_chat_completion(
                    messages=[
                        {"role": "system", "content": it["system"]},
                        {"role": "user", "content": it["user"]},
                    ],
                    max_tokens=GEN_MAX_TOKENS,
                    temperature=0.0,  # greedy — deterministic เหมือนตอน eval
                )
                results.append({"raw": resp["choices"][0]["message"]["content"]})
            except Exception as e:  # ใบไหนพังแยกใบ ไม่ทำทั้ง batch ล้ม (เว็บจะ fallback Gemini)
                results.append({"error": str(e)})
        return {"results": results}
