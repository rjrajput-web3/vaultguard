"""S1 v4 — HOOK (17.9s). Alert pulse -> 3D official VAULTRY logo reveal.
Replaces the flat drawn shield with the extruded-3D official logo
(extrusion, shadow, reflection, tilt, light sweep)."""
import math, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, "/home/hatch/workspace/vaultguard/demo/v2/anim")
from common import *
from logo_3d import composite_logo_3d, prepare_logo_crop

DUR = 17.9
N = int(DUR * FPS)
OUT = "/home/hatch/workspace/vaultguard/demo/v2/build/s1_v4.mp4"
LOGO_W = 780


def main():
    prepare_logo_crop()
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", "-r", str(FPS), OUT]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    parts = Particles(n=110, seed=7, speed=1.0)
    parts2 = Particles(n=55, seed=71, speed=0.45)  # parallax back layer

    for k in range(N):
        t = k / FPS
        parts.step()
        parts2.step()
        arr0 = cinematic_bg(t, seed=7)
        img = Image.fromarray(arr0, "RGB").convert("RGBA")
        d = ImageDraw.Draw(img)
        parts2.draw(d, t, alpha=45, link_dist=230)
        parts.draw(d, t, alpha=70)

        # ---- Phase A: alert (0 - 5.2s), unchanged ----
        if t < 5.2:
            a_in = ease_out_cubic(fade(k, 0, 18))
            a_out = 1 - ease_in_out(fade(k, 108, 156))
            a = a_in * a_out
            if a > 0.01:
                for r_i in range(3):
                    ph = (t * 0.9 + r_i / 3) % 1.0
                    r = 60 + ph * 420
                    alpha = int(150 * (1 - ph) * a)
                    d.ellipse([960 - r, 400 - r, 960 + r, 400 + r],
                              outline=RED + (alpha,), width=3)
                glow_text(img, (960, 330), "$18.4M", font(F_BOLD, 150),
                          (255, 120, 120), RED, 26)
                d2 = ImageDraw.Draw(img)
                d2.text((960, 445), "DRAINED · SINGLE FLAWED SWAP FUNCTION",
                        font=font(F_MONO, 30), fill=(255, 150, 150, int(255 * a)), anchor="mm")
                d2.text((960, 495), "RHEA — APRIL 2026",
                        font=font(F_MONO, 26), fill=DIM + (int(255 * a),), anchor="mm")

        # ---- Phase B: 3D logo reveal (5.6 - 8.6s), then hold with drift ----
        if t > 5.6:
            lp = ease_out_cubic(fade(k, int(5.6 * FPS), int(8.6 * FPS)))
            if lp > 0.01:
                # rise-in + breathe
                cy = 470 - 40 * lp
                arr = np.array(img.convert("RGB"))
                arr = composite_logo_3d(arr, LOGO_W, 960, cy, t, lp,
                                        tilt_speed=0.7, tilt_amp=0.055, seed_phase=1.0)
                img = Image.fromarray(arr, "RGB").convert("RGBA")
                d = ImageDraw.Draw(img)

        # ---- Phase C: video tagline (9.2s - end) ----
        if t > 9.2:
            tp = ease_out_cubic(fade(k, int(9.2 * FPS), int(10.8 * FPS)))
            if tp > 0.01:
                d2 = ImageDraw.Draw(img)
                tag = "NEVER BLIND SWAPS"
                d2.text((960, 948), tag, font=font(F_MONO, 40),
                        fill=CYAN_LT + (int(255 * tp),), anchor="mm")
                lw = int(340 * tp)
                d2.line([(960 - lw - 60, 948), (960 - 60, 948)], fill=CYAN + (int(160 * tp),), width=2)
                d2.line([(960 + 60, 948), (960 + 60 + lw, 948)], fill=CYAN + (int(160 * tp),), width=2)

        arr = np.array(img.convert("RGB"))
        arr = light_sweep(arr, t, period=9.0, strength=0.10 if t > 5.6 else 0.05)
        proc.stdin.write(arr.tobytes())
        if k % 120 == 0:
            print(f"s1v4 frame {k}/{N}", flush=True)

    proc.stdin.close()
    proc.wait()
    print("S1V4 DONE")


if __name__ == "__main__":
    main()
