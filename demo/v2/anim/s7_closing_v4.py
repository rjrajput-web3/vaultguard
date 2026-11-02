"""S7 v4 — CLOSING (19.5s). 3D official VAULTRY logo + credits + CTA.
Replaces the flat drawn shield with the extruded-3D official logo."""
import math, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, "/home/hatch/workspace/vaultguard/demo/v2/anim")
from common import *
from logo_3d import composite_logo_3d, prepare_logo_crop

DUR = 19.5
N = int(DUR * FPS)
OUT = "/home/hatch/workspace/vaultguard/demo/v2/build/s7_v4.mp4"
LOGO_W = 600


def main():
    prepare_logo_crop()
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", "-r", str(FPS), OUT]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    parts = Particles(n=130, seed=99, speed=0.8)
    parts2 = Particles(n=60, seed=171, speed=0.4)

    for k in range(N):
        t = k / FPS
        parts.step()
        parts2.step()
        arr0 = cinematic_bg(t, seed=99)
        img = Image.fromarray(arr0, "RGB").convert("RGBA")
        d = ImageDraw.Draw(img)
        parts2.draw(d, t, alpha=45, link_dist=230)
        parts.draw(d, t, alpha=80)

        # 3D logo reveal (0 - 1.6s), hold with tilt drift
        lp = ease_out_cubic(fade(k, 0, 48))
        if lp > 0.01:
            cy = 390 - 26 * lp
            arr = np.array(img.convert("RGB"))
            arr = composite_logo_3d(arr, LOGO_W, 960, cy, t, lp,
                                    tilt_speed=0.6, tilt_amp=0.05, seed_phase=2.0)
            img = Image.fromarray(arr, "RGB").convert("RGBA")
            d = ImageDraw.Draw(img)

        # credit lines, staggered (below the logo)
        lines = [
            (66, 110, "NEAR Build Beyond Boundaries", CYAN_LT, 36),
            (80, 124, "Unstoppable DeFi  ·  AI Security & Defense  ·  Private AI", CYAN_LT, 30),
            (124, 164, "github.com/rjrajput-web3/vaultguard", WHITE, 38),
            (168, 208, "Verify every transaction yourself on explorer.testnet.near.org", DIM, 30),
        ]
        d = ImageDraw.Draw(img)
        for i, (a, b, txt, col, sz) in enumerate(lines):
            p = ease_out_cubic(fade(k, a, b))
            if p > 0.01:
                d.text((960, 762 + i * 62), txt,
                       font=font(F_MONO if sz <= 30 else F_BOLD, sz),
                       fill=col + (int(255 * p),), anchor="mm")

        arr = np.array(img.convert("RGB"))
        arr = light_sweep(arr, t, period=7.0, strength=0.12)
        proc.stdin.write(arr.tobytes())
        if k % 120 == 0:
            print(f"s7v4 frame {k}/{N}", flush=True)

    proc.stdin.close()
    proc.wait()
    print("S7V4 DONE")


if __name__ == "__main__":
    main()
