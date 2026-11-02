"""S7 — CLOSING (19.51s). Cinematic logo, credits, verification CTA."""
import math, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, "/home/hatch/workspace/vaultguard/demo/v2/anim")
from common import *

DUR = 19.51
N = int(DUR * FPS)

def shield_points(cx, cy, s):
    pts = []
    for i in range(21):
        x = cx - s + 2 * s * i / 20
        pts.append((x, cy - s * 0.72))
    for i in range(1, 31):
        a = i / 30
        pts.append((cx + s * math.cos(a * 1.35),
                    cy - s * 0.72 + (s * 1.72) * (a ** 1.35)))
    for i in range(1, 31):
        a = i / 30
        pts.append((cx - s * math.cos((1 - a) * 1.35),
                    cy - s * 0.72 + (s * 1.72) * ((1 - a) ** 1.35)))
    return pts

SHIELD = shield_points(960, 330, 150)

def main():
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", "-r", str(FPS),
           "/home/hatch/workspace/vaultguard/demo/v2/build/s7.mp4"]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    parts = Particles(n=130, seed=99, speed=0.8)

    for k in range(N):
        t = k / FPS
        parts.step()
        # slow push-in feel: scale gradient wobble with t
        base = gradient_bg(wobble=0.8, t=t * 1.2)
        img = Image.fromarray(base, "RGB").convert("RGBA")
        d = ImageDraw.Draw(img)
        parts.draw(d, t, alpha=80)

        # shield emblem (fades in, gentle glow pulse)
        sp = ease_out_cubic(fade(k, 0, 36))
        if sp > 0.01:
            pulse = 0.5 + 0.5 * math.sin(t * 2.2)
            gl = Image.new("RGBA", img.size, (0, 0, 0, 0))
            gd = ImageDraw.Draw(gl)
            gd.line(SHIELD, fill=CYAN + (int(120 * sp),), width=8, joint="curve")
            img.alpha_composite(gl.filter(ImageFilter.GaussianBlur(18)))
            d = ImageDraw.Draw(img)
            d.line(SHIELD, fill=(210, 245, 255, int(255 * sp)), width=3, joint="curve")
            d.polygon(SHIELD, fill=(34, 211, 238, int((20 + 16 * pulse) * sp)))
            # bolt
            bw = 55
            d.line([(960 - bw, 330), (960 - bw * 0.25, 330 + bw * 0.85)],
                   fill=(225, 250, 255, int(235 * sp)), width=10, joint="curve")
            d.line([(960 - bw * 0.25, 330 + bw * 0.85), (960 + bw, 330 - bw * 0.75)],
                   fill=(225, 250, 255, int(235 * sp)), width=10, joint="curve")

        # VAULTGUARD
        lp = ease_out_cubic(fade(k, 18, 54))
        if lp > 0.01:
            y_off = int(24 * (1 - lp))
            glow_text(img, (960, 620 + y_off), "VAULTGUARD", font(F_BOLD, 110),
                      (240, 248, 255), BLUE, 28)

        # credit lines, staggered
        lines = [
            (66, 110, "NEAR Build Beyond Boundaries — Unstoppable DeFi", CYAN_LT, 36),
            (110, 150, "github.com/rjrajput-web3/vaultguard", WHITE, 38),
            (158, 198, "Verify every transaction yourself on explorer.testnet.near.org", DIM, 30),
        ]
        d = ImageDraw.Draw(img)
        for a, b, txt, col, sz in lines:
            p = ease_out_cubic(fade(k, a, b))
            if p > 0.01:
                d.text((960, 730 + (lines.index((a, b, txt, col, sz)) * 62)), txt,
                       font=font(F_MONO if sz <= 30 else F_BOLD, sz),
                       fill=col + (int(255 * p),), anchor="mm")

        arr = np.array(img.convert("RGB"))
        arr = light_sweep(arr, t, period=7.0, strength=0.12)
        arr = vignette(arr)
        proc.stdin.write(arr.tobytes())
        if k % 120 == 0:
            print(f"s7 frame {k}/{N}", flush=True)

    proc.stdin.close()
    proc.wait()
    print("S7 DONE")

if __name__ == "__main__":
    main()
