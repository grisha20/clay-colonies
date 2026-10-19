"""Procedural PBR Texture Generator for Clayfolk 3D.

Generates tileable tangent-space normal maps and roughness maps for:
- Terracotta matte clay (with gentle thumbprint waves and fine porous grain)
- Woven grass cord (helical fibers)
- Thatch reed roof (directional straw texture)
"""

import os
import numpy as np
import cv2

REPO_ROOT = os.path.realpath(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
TEXTURE_DIR = os.path.join(REPO_ROOT, "godot", "assets", "textures")

def make_seamless_clay_height(size=512):
    np.random.seed(42)
    h = np.zeros((size, size), dtype=np.float32)

    # 1. Broad gentle thumbprint contours (low frequencies)
    for k in range(1, 5):
        freq = k
        amp = 1.0 / (k ** 1.2)
        px = np.random.uniform(0, 2 * np.pi)
        py = np.random.uniform(0, 2 * np.pi)
        x = np.linspace(0, 2 * np.pi * freq, size, endpoint=False)
        y = np.linspace(0, 2 * np.pi * freq, size, endpoint=False)
        xx, yy = np.meshgrid(x, y)
        h += amp * (np.sin(xx + px) * np.cos(yy + py) + 0.5 * np.cos(xx * 1.3 - yy * 0.7 + px))

    # 2. Medium clay kneading ripple
    for k in range(5, 12):
        freq = k
        amp = 0.4 / (k ** 0.8)
        px = np.random.uniform(0, 2 * np.pi)
        py = np.random.uniform(0, 2 * np.pi)
        x = np.linspace(0, 2 * np.pi * freq, size, endpoint=False)
        y = np.linspace(0, 2 * np.pi * freq, size, endpoint=False)
        xx, yy = np.meshgrid(x, y)
        h += amp * (np.sin(xx + yy + px) + np.cos(xx - yy + py))

    # 3. Micro clay pores
    fine = np.random.normal(0, 0.12, (size, size)).astype(np.float32)
    fine = cv2.GaussianBlur(fine, (3, 3), 0.7)
    h = h * 0.8 + fine * 0.2

    # Normalize to [0, 1]
    h = (h - h.min()) / (h.max() - h.min() + 1e-6)
    return h

def height_to_normal(h, strength=1.2):
    pad = 4
    h_pad = np.pad(h.astype(np.float32), pad, mode="wrap")
    dx = cv2.Sobel(h_pad, cv2.CV_32F, 1, 0, ksize=3)[pad:-pad, pad:-pad]
    dy = cv2.Sobel(h_pad, cv2.CV_32F, 0, 1, ksize=3)[pad:-pad, pad:-pad]

    # Godot / OpenGL tangent space: Red = X, Green = -Y (up), Blue = Z
    nx = -dx * strength * 4.0
    ny = dy * strength * 4.0
    nz = np.ones_like(nx)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx /= norm
    ny /= norm
    nz /= norm

    b = np.clip((nz * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8)
    g = np.clip((ny * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8)
    r = np.clip((nx * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8)
    return cv2.merge([b, g, r])

def generate_textures():
    os.makedirs(TEXTURE_DIR, exist_ok=True)

    # 1. Terracotta Clay Normal Map (512x512)
    print("Generating clay_normal.png...")
    clay_h = make_seamless_clay_height(512)
    clay_n = height_to_normal(clay_h, strength=0.85)
    clay_n_path = os.path.join(TEXTURE_DIR, "clay_normal.png")
    cv2.imwrite(clay_n_path, clay_n)
    print(f"Saved: {clay_n_path}")

    # 2. Terracotta Clay Roughness Map (512x512, matte 0.82 +/- 0.08)
    print("Generating clay_roughness.png...")
    clay_r = np.clip((0.82 + (clay_h - 0.5) * 0.16) * 255, 0, 255).astype(np.uint8)
    clay_r_path = os.path.join(TEXTURE_DIR, "clay_roughness.png")
    cv2.imwrite(clay_r_path, clay_r)
    print(f"Saved: {clay_r_path}")

    # 3. Woven Cord Normal Map (256x256)
    print("Generating cord_normal.png...")
    size = 256
    y = np.linspace(0, 2 * np.pi * 16, size, endpoint=False)
    x = np.linspace(0, 2 * np.pi * 3, size, endpoint=False)
    xx, yy = np.meshgrid(x, y)
    cord_h = np.sin(xx + yy * 0.5) * 0.7 + np.cos(xx * 2.0 - yy * 0.5) * 0.3
    cord_h = (cord_h - cord_h.min()) / (cord_h.max() - cord_h.min() + 1e-6)
    cord_n = height_to_normal(cord_h, strength=1.4)
    cord_n_path = os.path.join(TEXTURE_DIR, "cord_normal.png")
    cv2.imwrite(cord_n_path, cord_n)
    print(f"Saved: {cord_n_path}")

    # 4. Thatch Reed Normal Map (512x512)
    print("Generating thatch_normal.png...")
    x = np.linspace(0, 2 * np.pi * 24, 512, endpoint=False)
    y = np.linspace(0, 2 * np.pi * 2, 512, endpoint=False)
    xx, yy = np.meshgrid(x, y)
    noise = np.random.normal(0, 0.1, (512, 512)).astype(np.float32)
    thatch_h = np.sin(xx + noise * 1.5) * 0.8 + np.cos(yy * 4.0) * 0.2
    thatch_h = (thatch_h - thatch_h.min()) / (thatch_h.max() - thatch_h.min() + 1e-6)
    thatch_n = height_to_normal(thatch_h, strength=1.2)
    thatch_n_path = os.path.join(TEXTURE_DIR, "thatch_normal.png")
    cv2.imwrite(thatch_n_path, thatch_n)
    print(f"Saved: {thatch_n_path}")

    print("All PBR textures generated successfully!")

if __name__ == "__main__":
    generate_textures()
