#!/usr/bin/env python3
"""
Removes the green chroma-key background from every PNG in the repo root
and writes transparent PNGs into docs/images/.

Algorithm:
    - Read image as RGBA.
    - Compute "greenness" g = G - max(R, B) per pixel.
    - Pixels with high greenness become transparent; medium greenness
      becomes semi-transparent for soft edges; low greenness stays solid.
    - Despill: on partially-green pixels, clamp G to max(R, B) so the
      green halo around hair / shoulders disappears.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT
OUT_DIR = REPO_ROOT / "docs" / "images"


def remove_green(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    arr = np.asarray(img, dtype=np.int16).copy()
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]

    greenness = g - np.maximum(r, b)

    # Thresholds: below low_thr fully opaque, above high_thr fully transparent.
    low_thr = 10
    high_thr = 60

    alpha_factor = np.clip(
        (greenness - low_thr) / float(high_thr - low_thr), 0.0, 1.0
    )
    new_alpha = (a.astype(np.float32) * (1.0 - alpha_factor)).astype(np.uint8)

    # Despill: cap green channel so leftover green halo turns neutral.
    cap = np.maximum(r, b)
    spill_mask = greenness > 0
    new_g = np.where(spill_mask, np.minimum(g, cap), g)

    out = np.zeros_like(arr, dtype=np.uint8)
    out[..., 0] = np.clip(r, 0, 255).astype(np.uint8)
    out[..., 1] = np.clip(new_g, 0, 255).astype(np.uint8)
    out[..., 2] = np.clip(b, 0, 255).astype(np.uint8)
    out[..., 3] = new_alpha
    return Image.fromarray(out, mode="RGBA")


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pngs = sorted(p for p in SRC_DIR.glob("*.png"))
    if not pngs:
        print("No PNGs found in repo root", file=sys.stderr)
        return 1

    for src in pngs:
        img = Image.open(src)
        out_img = remove_green(img)
        dst = OUT_DIR / src.name
        out_img.save(dst, "PNG", optimize=True)
        print(f"  {src.name} -> {dst.relative_to(REPO_ROOT)}")

    print(f"Done. {len(pngs)} images written to {OUT_DIR.relative_to(REPO_ROOT)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
