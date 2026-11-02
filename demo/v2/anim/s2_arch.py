"""S2 — ARCHITECTURE (26.03s). 4 nodes with flowing pulses, staged reveal + highlight."""
import math, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, "/home/hatch/workspace/vaultguard/demo/v2/anim")
from common import *

DUR = 26.03
N = int(DUR * FPS)

NODES = [
    ("RHEA X Chain SDK", "prices the route", 1.0),
    ("Risk Engine", "scores every quote", 5.0),
    ("NEAR Intents", "fallback router", 10.0),
    ("NEAR Smart Contract", "final authority · on-chain", 15.0),
]
# x centers for 4 nodes
XS = [240, 720, 1200, 1680]
NW, NH = 380, 170
NY = 520

def rrect(d, box, r, outline, width, fill):
    d.rounded_rectangle(box, radius=r, outline=outline, width=width, fill=fill)

def main():
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", "-r", str(FPS),
           "/home/hatch/workspace/vaultguard/demo/v2/build/s2.mp4"]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    parts = Particles(n=70, seed=21, speed=0.7)

    for k in range(N):
        t = k / FPS
        parts.step()
        # subtle camera drift
        drift_x = int(14 * math.sin(t * 0.35))
        drift_y = int(8 * math.sin(t * 0.5 + 1))
        base = gradient_bg(wobble=0.5, t=t)
        img = Image.fromarray(base, "RGB").convert("RGBA")
        d = ImageDraw.Draw(img)
        parts.draw(d, t, alpha=55)

        # title
        tp = ease_out_cubic(fade(k, 0, 30))
        if tp > 0.01:
            d.text((960 + drift_x, 150 + drift_y), "HOW VAULTGUARD PROTECTS EVERY SWAP",
                   font=font(F_MONO, 34), fill=CYAN_LT + (int(255 * tp),), anchor="mm")

        # connectors (draw under nodes), pulses travel continuously
        for i in range(3):
            x0, x1 = XS[i] + NW / 2 + drift_x, XS[i + 1] - NW / 2 + drift_x
            y = NY + drift_y
            # only show connector once both nodes exist
            vis = min(ease_out_cubic(fade(k, int(NODES[i + 1][2] * FPS) - 10, int(NODES[i + 1][2] * FPS) + 10)), 1.0)
            if vis <= 0.01:
                continue
            d.line([(x0, y), (x1, y)], fill=(80, 120, 180, int(140 * vis)), width=3)
            # traveling pulses
            for pj in range(3):
                ph = (t * 0.55 + pj / 3 + i * 0.13) % 1.0
                px = x0 + (x1 - x0) * ph
                pr = 7
                glow_a = int(200 * vis * (0.6 + 0.4 * math.sin(t * 6 + pj)))
                d.ellipse([px - pr * 2, y - pr * 2, px + pr * 2, y + pr * 2],
                          fill=CYAN + (glow_a // 4,))
                d.ellipse([px - pr, y - pr, px + pr, y + pr],
                          fill=(220, 250, 255, int(255 * vis)))
            # arrowhead
            ah = 14
            d.polygon([(x1, y), (x1 - ah, y - ah // 2), (x1 - ah, y + ah // 2)],
                      fill=CYAN + (int(200 * vis),))

        # nodes
        for i, (title, sub, appear) in enumerate(NODES):
            ap = ease_out_cubic(fade(k, int(appear * FPS), int(appear * FPS) + 24))
            if ap <= 0.01:
                continue
            cx = XS[i] + drift_x
            cy = NY + drift_y
            # pop-in scale
            sc = 0.85 + 0.15 * ap
            nw, nh = NW * sc, NH * sc
            box = [cx - nw / 2, cy - nh / 2, cx + nw / 2, cy + nh / 2]
            # active highlight: the most recently appeared node glows stronger
            active = (i == sum(1 for _, _, a2 in NODES if t >= a2) - 1)
            glow = 26 if active else 12
            pulse = 0.5 + 0.5 * math.sin(t * 2.5 + i)
            # glow layer
            gl = Image.new("RGBA", img.size, (0, 0, 0, 0))
            gd = ImageDraw.Draw(gl)
            gd.rounded_rectangle(box, radius=22, outline=CYAN + (int((90 + 60 * pulse) * ap) if active else int(50 * ap),), width=6)
            from PIL import ImageFilter
            img.alpha_composite(gl.filter(ImageFilter.GaussianBlur(glow)))
            d = ImageDraw.Draw(img)
            rrect(d, box, 22, CYAN + (int(220 * ap),), 3, (16, 26, 44, int(235 * ap)))
            # node number chip
            d.ellipse([cx - 22, box[1] - 22, cx + 22, box[1] + 22],
                      fill=(34, 211, 238, int(255 * ap)))
            d.text((cx, box[1]), str(i + 1), font=font(F_BOLD, 30),
                   fill=(7, 11, 20, int(255 * ap)), anchor="mm")
            # title (may wrap)
            d.text((cx, cy - 12), title, font=font(F_BOLD, 40),
                   fill=WHITE + (int(255 * ap),), anchor="mm")
            d.text((cx, cy + 44), sub, font=font(F_REG, 27),
                   fill=DIM + (int(255 * ap),), anchor="mm")

        # bottom caption
        cp = ease_out_cubic(fade(k, int(20 * FPS), int(21.5 * FPS)))
        if cp > 0.01:
            d.text((960, 920), "RHEA-first pricing · Intents fallback · contract enforces on-chain",
                   font=font(F_MONO, 28), fill=(150, 170, 200, int(255 * cp)), anchor="mm")

        arr = np.array(img.convert("RGB"))
        arr = light_sweep(arr, t, period=11.0, strength=0.07)
        arr = vignette(arr)
        proc.stdin.write(arr.tobytes())
        if k % 150 == 0:
            print(f"s2 frame {k}/{N}", flush=True)

    proc.stdin.close()
    proc.wait()
    print("S2 DONE")

if __name__ == "__main__":
    main()
