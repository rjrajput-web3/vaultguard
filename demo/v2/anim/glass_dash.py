"""Glass dashboard renderer v2 (optimized) for S3 (live quote) and S6 (guardian trail).
Futuristic frosted-glass dashboard. ALL content is the real verified data.
Usage: python glass_dash.py <s3|s6> <duration_s> <out.mp4>
"""
import math, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, "/home/hatch/workspace/vaultguard/demo/v2/anim")
from common import *

# ---- REAL verified content (same as v2 terminal) ----
S3_ROWS = [
    ("Source", "oneclick", WHITE),
    ("Router", "nearintents", WHITE),
    ("Out", "999846", CYAN_LT),
    ("Min", "994846", CYAN_LT),
    ("Slippage", "0.50%", CYAN_LT),
    ("Risk", "SAFE (15.7)", GREEN),
    ("Alternatives", "0", DIM),
]

S6_CARDS = [
    {
        "decision": "use-primary",
        "color": GREEN,
        "rows": [
            ("primary router", "nearintents"),
            ("selected router", "nearintents"),
            ("excluded", "(none)"),
            ("selected route", "out 999846 / min 994846 (slippage 0.50%)"),
            ("policy allowed", "true"),
        ],
        "trail": [
            ("09:28:55", "Quote received: 8453:0x833589\u2026bda02913 \u2192 near:17208628\u2026e36133a1"),
            ("09:28:55", 'Primary router "nearintents" healthy \u2014 no degradation detected'),
            ("09:28:55", "Policy check PASSED for primary route"),
        ],
    },
    {
        "decision": "no-route-pause",
        "color": AMBER,
        "rows": [
            ("primary router", "nearintents"),
            ("selected router", "(none \u2014 paused)"),
            ("excluded", "nearintents"),
            ("policy allowed", "false"),
            ("policy reasons", 'primary degraded, no healthy alternatives'),
        ],
        "trail": [
            ("09:28:55", 'Primary router "nearintents" is DEGRADED (simulated outage)'),
            ("09:28:55", "No healthy alternatives remain after excluding degraded routers"),
            ("09:28:55", "DECISION: no-route-pause \u2014 vault pauses instead of blind-swapping"),
        ],
    },
]

def build_bg(seed):
    """Precompute static cinematic background (orbs don't move per-frame)."""
    rng = np.random.default_rng(seed)
    y = np.linspace(0, 1, H)[:, None, None]
    top = np.array([4, 7, 15], dtype=np.float32)
    bot = np.array([9, 14, 28], dtype=np.float32)
    img = (top * (1 - y) + bot * y)
    img = np.broadcast_to(img, (H, W, 3)).copy()
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    orbs = [
        (0.22, 0.30, 0.42, (28, 90, 160)),
        (0.80, 0.65, 0.46, (16, 110, 130)),
        (0.55, 0.12, 0.30, (70, 40, 120)),
    ]
    for bx, by, rad, col in orbs:
        cx, cy = bx * W, by * H
        r = rad * W
        d2 = ((xx - cx) ** 2 + (yy - cy) ** 2) / (r ** 2)
        glow = np.exp(-d2 * 2.2)
        for c in range(3):
            img[:, :, c] += glow * col[c] * 0.55
    gx = np.abs(np.sin(xx / 90)) ** 24
    gy = np.abs(np.sin(yy / 90)) ** 24
    img += np.minimum(gx, gy)[:, :, None] * 14
    return np.clip(img, 0, 255).astype(np.uint8)

def build_panel(box, radius=26):
    """Precompute frosted-glass panel (shadow + frost + glow border)."""
    x0, y0, x1, y1 = box
    pw, ph = x1 - x0, y1 - y0
    # frosted fill from blurred dark navy
    frost = Image.new("RGBA", (pw, ph), (14, 22, 40, 235))
    fr = np.array(frost).astype(np.float32)
    fr[:, :, :3] *= 1.06
    frost = Image.fromarray(fr.astype(np.uint8))
    mask = Image.new("L", (pw, ph), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, pw, ph], radius=radius, fill=255)

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # shadow
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([x0 + 6, y0 + 14, x1 + 6, y1 + 14],
                                         radius=radius, fill=(0, 0, 0, 110))
    layer.alpha_composite(sh.filter(ImageFilter.GaussianBlur(22)))
    # frost body
    layer.paste(frost, (x0, y0), mask)
    # tint sheen (diagonal)
    sheen = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.polygon([(0, 0), (pw, 0), (int(pw * 0.45), ph), (0, ph)], fill=(150, 200, 255, 14))
    layer.paste(sheen, (x0, y0), mask)
    # glow border
    gl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(gl).rounded_rectangle(box, radius=radius, outline=CYAN + (80,), width=7)
    layer.alpha_composite(gl.filter(ImageFilter.GaussianBlur(10)))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(box, radius=radius, outline=CYAN + (200,), width=2)
    d.line([(x0 + 40, y0 + 2), (x1 - 40, y0 + 2)], fill=(255, 255, 255, 50), width=2)
    return layer

def build_vignette_mask(strength=0.42):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    dx = (xx - W / 2) / (W / 2)
    dy = (yy - H / 2) / (H / 2)
    d = np.sqrt(dx * dx + dy * dy)
    return (1.0 - strength * np.clip((d - 0.55) / 0.75, 0, 1) ** 1.6).astype(np.float32)

def main():
    mode, dur, out = sys.argv[1:4]
    dur = float(dur)
    N = int(dur * FPS)
    mono = font(F_MONO_R, 26)
    mono_b = font(F_MONO, 26)
    label_f = font(F_MONO, 28)

    bg_base = build_bg(21)
    vmask = build_vignette_mask()[..., None]
    box = [140, 140, 1780, 940] if mode == "s3" else [110, 130, 1810, 950]
    panel = build_panel(box)

    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", "-r", str(FPS), out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    parts = Particles(n=90, seed=21, speed=0.9)

    if mode == "s3":
        label = "Dry-run \u2014 live pricing, no funds move"
        title = "LIVE QUOTE"
        sub = "STEP 1 \u2014 live quote  \u00b7  RHEA first, 1Click fallback"
    else:
        label = "Degradation simulated \u2014 dry-run \u00b7 Depeg monitor: function-level verification"
        title = "GUARDIAN DECISION TRAIL"
        sub = "real decision log \u00b7 2026-11-02T09:28:55Z"

    for k in range(N):
        t = k / FPS
        parts.step()
        img = Image.fromarray(bg_base, "RGB").convert("RGBA")
        # slow drifting glow sprite for life
        parts.draw(ImageDraw.Draw(img), t, alpha=60)
        d = ImageDraw.Draw(img)

        lp = ease_out_cubic(fade(k, 0, 20))
        if lp > 0.01:
            d.text((110, 62), label, font=label_f, fill=AMBER + (int(255 * lp),), anchor="lm")
            d.text((1810, 62), "\u25cf REC", font=font(F_MONO, 24),
                   fill=RED + (int(255 * lp * (0.5 + 0.5 * math.sin(t * 4))),), anchor="rm")

        pp = ease_out_cubic(fade(k, 0, 24))
        if pp > 0.01:
            pl = panel.copy()
            pl.putalpha(pl.split()[3].point(lambda a: int(a * pp)))
            img.alpha_composite(pl)
            d = ImageDraw.Draw(img)

            if mode == "s3":
                hp = ease_out_cubic(fade(k, 10, 30))
                if hp > 0.01:
                    a = int(255 * hp)
                    d.text((200, 210), title, font=font(F_BOLD, 44), fill=WHITE + (a,), anchor="lm")
                    # DRY RUN pill (cheap: no full-frame blur)
                    ptxt, pf = "DRY RUN", font(F_MONO, 24)
                    tw = pf.getlength(ptxt)
                    px, py = 1620, 215
                    d.rounded_rectangle([px - tw/2 - 18, py - 14, px + tw/2 + 18, py + 14],
                                        radius=14, fill=(10, 16, 28, 220),
                                        outline=CYAN + (255,), width=2)
                    d.text((px, py - 1), ptxt, font=pf, fill=CYAN + (255,), anchor="mm")
                    d.text((200, 262), sub, font=font(F_MONO_R, 24), fill=DIM + (a,), anchor="lm")
                    d.line([(200, 300), (1720, 300)], fill=CYAN + (int(90 * hp),), width=2)
                y = 360
                for i, (lab, val, col) in enumerate(S3_ROWS):
                    rp = ease_out_cubic(fade(k, 24 + i * 14, 38 + i * 14))
                    if rp > 0.01:
                        a = int(255 * rp)
                        xo = int(30 * (1 - rp))
                        d.text((220 + xo, y), lab, font=font(F_MONO_R, 27),
                               fill=DIM + (a,), anchor="lm")
                        d.text((560 + xo, y), val, font=mono_b, fill=col + (a,), anchor="lm")
                        if lab == "Risk":
                            twv = mono_b.getlength(val)
                            d.ellipse([560 + twv + 22, y - 8, 560 + twv + 38, y + 8],
                                      fill=GREEN + (int(200 * rp),))
                        y += 68
                fp = ease_out_cubic(fade(k, 130, 160))
                if fp > 0.01:
                    d.text((960, 880), "Live pricing \u00b7 scored before signing \u00b7 no funds move",
                           font=font(F_MONO_R, 22), fill=DIM + (int(200 * fp),), anchor="mm")
            else:
                hp = ease_out_cubic(fade(k, 10, 30))
                if hp > 0.01:
                    a = int(255 * hp)
                    d.text((170, 196), title, font=font(F_BOLD, 40), fill=WHITE + (a,), anchor="lm")
                    d.text((170, 244), sub, font=font(F_MONO_R, 22), fill=DIM + (a,), anchor="lm")
                for ci, card in enumerate(S6_CARDS):
                    cx0 = 170 + ci * 790
                    cp = ease_out_cubic(fade(k, 20 + ci * 90, 44 + ci * 90))
                    if cp <= 0.01:
                        continue
                    a = int(255 * cp)
                    cbox = [cx0, 290, cx0 + 740, 560]
                    d.rounded_rectangle(cbox, radius=18, fill=(8, 14, 26, 200),
                                         outline=card["color"] + (160,), width=2)
                    d.text((cx0 + 30, 330), "DECISION:", font=font(F_MONO, 24),
                           fill=DIM + (a,), anchor="lm")
                    d.text((cx0 + 200, 330), card["decision"], font=mono_b,
                           fill=card["color"] + (a,), anchor="lm")
                    ry = 378
                    for lab, val in card["rows"]:
                        d.text((cx0 + 30, ry), lab, font=font(F_MONO_R, 21),
                               fill=DIM + (a,), anchor="lm")
                        d.text((cx0 + 290, ry), val, font=font(F_MONO_R, 21),
                               fill=WHITE + (a,), anchor="lm")
                        ry += 36
                tp = ease_out_cubic(fade(k, 200, 230))
                if tp > 0.01:
                    a = int(255 * tp)
                    d.text((170, 610), "Decision trail \u2014 real log:",
                           font=font(F_MONO, 24), fill=CYAN_LT + (a,), anchor="lm")
                    ty = 656
                    for ti, (ts, txt) in enumerate(S6_CARDS[0]["trail"] + S6_CARDS[1]["trail"]):
                        ep = ease_out_cubic(fade(k, 215 + ti * 28, 235 + ti * 28))
                        if ep <= 0.01:
                            continue
                        ea = int(a * ep)
                        d.ellipse([180, ty - 6, 192, ty + 6], fill=CYAN + (ea,))
                        if ti > 0:
                            d.line([(186, ty - 30), (186, ty - 8)], fill=CYAN + (ea // 3,), width=2)
                        d.text((210, ty - 2), f"[{ts}]", font=font(F_MONO_R, 20),
                               fill=DIM + (ea,), anchor="lm")
                        d.text((340, ty - 2), txt, font=font(F_MONO_R, 20),
                               fill=(200, 208, 224, ea), anchor="lm")
                        ty += 40

        arr = np.array(img.convert("RGB")).astype(np.float32)
        arr *= vmask
        arr = light_sweep(arr.astype(np.uint8), t, period=8.0, strength=0.08)
        proc.stdin.write(arr.tobytes())
        if k % 150 == 0:
            print(f"glass {mode} {k}/{N}", flush=True)

    proc.stdin.close()
    proc.wait()
    print("GLASS DONE", mode, out)

if __name__ == "__main__":
    main()
