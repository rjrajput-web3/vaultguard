"""3D feature title overlays — premium product-launch title moments.
Renders RGBA PNG sequences (transparent bg) for ffmpeg overlay:
  CROSS-CHAIN SWAP (S3), ON-CHAIN PROOF (S5), ROUTE GUARDIAN (S6)
3D extruded text, soft shadow, slow push-in, fade in/out. Restrained.
Usage: python title_3d.py
"""
import math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, "/home/hatch/workspace/vaultguard/demo/v2/anim")
from common import *
from logo_3d import extruded_text_3d

OUT_DIR = "/home/hatch/workspace/vaultguard/demo/v2/build/titles"
DUR = 3.4
N = int(DUR * FPS)

TITLES = {
    "s3": ("CROSS-CHAIN SWAP", "live quotes · risk scored before signing"),
    "s5": ("ON-CHAIN PROOF", "six real testnet transactions · verified"),
    "s6": ("ROUTE GUARDIAN", "fallback on degradation · depeg monitor"),
}


def render_title(key, title, sub):
    odir = os.path.join(OUT_DIR, key)
    os.makedirs(odir, exist_ok=True)
    # 3D title canvas (RGB on black) + shadow
    tcanvas, tshadow = extruded_text_3d(title, font(F_BOLD, 96), (238, 244, 255),
                                       depth=12, glow_color=(139, 92, 246))
    th, tw = tcanvas.shape[:2]
    sub_f = font(F_MONO, 30)
    # subtitle as plain RGBA text layer
    sub_img = Image.new("RGBA", (tw, 60), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sub_img)
    sd.text((tw / 2, 30), sub, font=sub_f, fill=(160, 200, 235, 255), anchor="mm")

    for k in range(N):
        fp = os.path.join(odir, f"f{k:03d}.png")
        if os.path.exists(fp):
            continue
        t = k / FPS
        # fade in 0-0.7, hold, fade out 2.7-3.4
        a_in = ease_out_cubic(fade(k, 0, 21))
        a_out = 1.0 - ease_in_out(fade(k, int(2.7 * FPS), N - 1))
        a = a_in * a_out
        # slow push-in
        sc = 0.94 + 0.06 * ease_in_out(k / max(1, N - 1))
        # gentle float
        fy = int(6 * math.sin(t * 1.2))
        # vignette backing for readability
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        if a > 0.01:
            # dark radial behind title
            vg = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            vd = ImageDraw.Draw(vg)
            vd.ellipse([960 - 620, 540 - 190, 960 + 620, 540 + 190], fill=(2, 4, 10, int(150 * a)))
            img.alpha_composite(vg.filter(ImageFilter.GaussianBlur(60)))
            # title layer
            nw, nh = int(tw * sc), int(th * sc)
            tl = Image.fromarray(tcanvas).resize((nw, nh), Image.LANCZOS)
            # tilt wobble (subtle)
            ph = t * 0.8
            sq = 1.0 - 0.03 * (0.5 + 0.5 * math.sin(ph))
            tl = tl.transform((nw, nh), Image.AFFINE,
                              (sq, 0, nw / 2 - sq * nw / 2, 0, 1, 0),
                              resample=Image.BICUBIC)
            # shadow
            sh = Image.fromarray((tshadow * 255).astype(np.uint8)).resize((nw, nh), Image.LANCZOS)
            sha = np.array(sh).astype(np.float32) / 255.0 * a
            # composite: darken then screen
            base = np.array(img).astype(np.float32)
            cx0, cy0 = int(960 - nw / 2), int(540 - nh / 2) + fy - 30
            x0, y0 = max(0, cx0), max(0, cy0)
            x1, y1 = min(W, cx0 + nw), min(H, cy0 + nh)
            if x1 > x0 and y1 > y0:
                ox0, oy0 = x0 - cx0, y0 - cy0
                lg = np.array(tl).astype(np.float32)[oy0:oy0 + (y1 - y0), ox0:ox0 + (x1 - x0)][:, :, :3]
                reg = base[y0:y1, x0:x1]
                reg[:, :, :3] *= (1.0 - sha[oy0:oy0 + (y1 - y0), ox0:ox0 + (x1 - x0)][..., None])
                reg[:, :, :3] = 255.0 - (255.0 - reg[:, :, :3]) * (255.0 - lg * a) / 255.0
                reg[:, :, 3] = np.maximum(reg[:, :, 3],
                                          (lg.mean(axis=2) > 8).astype(np.float32) * 255 * a)
                base[y0:y1, x0:x1] = reg
                img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
            # subtitle
            if a > 0.01:
                sa = int(200 * ease_out_cubic(fade(k, 12, 33)) * a_out)
                if sa > 0:
                    sl = sub_img.copy()
                    sl.putalpha(sl.split()[3].point(lambda v: int(v * sa / 255)))
                    img.alpha_composite(sl, (int(960 - tw / 2), 640 + fy))
        img.save(os.path.join(odir, f"f{k:03d}.png"))
    print(f"TITLE DONE {key}")


def main():
    for key, (title, sub) in TITLES.items():
        render_title(key, title, sub)


if __name__ == "__main__":
    main()
