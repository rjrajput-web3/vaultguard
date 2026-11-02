"""S1 — HOOK (17.94s). Alert pulse -> shield forms -> VAULTGUARD logo reveal."""
import math, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, "/home/hatch/workspace/vaultguard/demo/v2/anim")
from common import *

DUR = 17.94
N = int(DUR * FPS)

def shield_points(cx, cy, s):
    """Shield outline as point list (top edge, right curve to bottom point, left curve back)."""
    pts = []
    # top-left to top-right
    for i in range(21):
        x = cx - s + 2 * s * i / 20
        pts.append((x, cy - s * 0.72))
    # right side curving down to bottom point
    for i in range(1, 31):
        a = i / 30
        x = cx + s * math.cos(a * 1.35)
        y = cy - s * 0.72 + (s * 1.72) * (a ** 1.35)
        pts.append((x, y))
    # left side back up
    for i in range(1, 31):
        a = i / 30
        x = cx - s * math.cos((1 - a) * 1.35)
        y = cy - s * 0.72 + (s * 1.72) * ((1 - a) ** 1.35)
        pts.append((x, y))
    return pts

SHIELD = shield_points(960, 400, 250)

def frame(k):
    t = k / FPS
    base = gradient_bg(wobble=0.6, t=t)
    img = Image.fromarray(base, "RGB").convert("RGBA")
    d = ImageDraw.Draw(img)
    parts = Particles(n=110, seed=7, speed=1.0)
    # advance particles deterministically-ish per frame (cheap: precompute via t)
    for _ in range(0):  # placeholder
        pass
    # Instead of stateful stepping, compute drifted positions analytically
    return img, d, t

def main():
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", "-r", str(FPS),
           "/home/hatch/workspace/vaultguard/demo/v2/build/s1.mp4"]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    parts = Particles(n=110, seed=7, speed=1.0)

    for k in range(N):
        t = k / FPS
        parts.step()
        arr0 = cinematic_bg(t, seed=7)
        img = Image.fromarray(arr0, "RGB").convert("RGBA")
        d = ImageDraw.Draw(img)
        parts.draw(d, t, alpha=70)

        # ---- Phase A: alert (0 - 4.5s) ----
        if t < 5.2:
            a_in = ease_out_cubic(fade(k, 0, 18))
            a_out = 1 - ease_in_out(fade(k, 108, 156))  # fade out 3.6s-5.2s
            a = a_in * a_out
            if a > 0.01:
                # expanding red rings
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

        # ---- Phase B: shield draws (4.2 - 10s), with subtle 3D tilt ----
        if t > 4.2:
            p = ease_in_out(fade(k, int(4.2 * FPS), int(9.5 * FPS)))
            if p > 0.01:
                sl = Image.new("RGBA", img.size, (0, 0, 0, 0))
                sd = ImageDraw.Draw(sl)
                nseg = int(len(SHIELD) * p)
                if nseg > 1:
                    sd.line(SHIELD[:nseg], fill=CYAN + (90,), width=10, joint="curve")
                    sd.line(SHIELD[:nseg], fill=(200, 245, 255, 255), width=4, joint="curve")
                # shield fill pulse once complete
                if p >= 1.0:
                    pulse = 0.5 + 0.5 * math.sin(t * 2.4)
                    fill_a = int(26 + 20 * pulse)
                    sd.polygon(SHIELD, fill=(34, 211, 238, fill_a))
                    # inner check / bolt
                    bw = 90
                    by = 400
                    sd.line([(960 - bw, by), (960 - bw * 0.25, by + bw * 0.85)], fill=(220, 250, 255, 230), width=16, joint="curve")
                    sd.line([(960 - bw * 0.25, by + bw * 0.85), (960 + bw, by - bw * 0.75)], fill=(220, 250, 255, 230), width=16, joint="curve")
                # 3D tilt around shield center
                sl = tilt_3d(sl, t, 960, 400, speed=0.7, squeeze_amp=0.06, skew_amp=0.04)
                img.alpha_composite(sl)
                d = ImageDraw.Draw(img)

        # ---- Phase C: logo reveal (9.8s - end) ----
        if t > 9.8:
            lp = ease_out_cubic(fade(k, int(9.8 * FPS), int(12.2 * FPS)))
            if lp > 0.01:
                # slight rise-in
                y_off = int(26 * (1 - lp))
                glow_text(img, (960, 760 + y_off), "VAULTRY", font(F_BOLD, 118),
                          (240, 248, 255), BLUE, 30)
                tp = ease_out_cubic(fade(k, int(12.6 * FPS), int(14.2 * FPS)))
                if tp > 0.01:
                    d2 = ImageDraw.Draw(img)
                    # letter-spaced tagline
                    tag = "NEVER BLIND SWAPS"
                    d2.text((960, 858), tag, font=font(F_MONO, 40),
                            fill=CYAN_LT + (int(255 * tp),), anchor="mm")
                    # rule lines
                    lw = int(340 * tp)
                    d2.line([(960 - lw - 60, 858), (960 - 60, 858)], fill=CYAN + (int(160 * tp),), width=2)
                    d2.line([(960 + 60, 858), (960 + 60 + lw, 858)], fill=CYAN + (int(160 * tp),), width=2)

        arr = np.array(img.convert("RGB"))
        arr = light_sweep(arr, t, period=9.0, strength=0.10 if t > 9.8 else 0.05)
        proc.stdin.write(arr.tobytes())
        if k % 120 == 0:
            print(f"s1 frame {k}/{N}", flush=True)

    proc.stdin.close()
    proc.wait()
    print("S1 DONE")

if __name__ == "__main__":
    main()
