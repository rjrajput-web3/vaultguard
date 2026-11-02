"""S5 — ON-CHAIN PROOF (35.78s). 6 cinematic proof cards with REAL tx data.
Hashes + outcomes from the real Phase-D transcript; 4 success txs re-verified
live via NEAR testnet RPC during this build. Explorer page recordings were
impossible (VM egress proxy blocks headless Chromium) — data shown is real,
labeled RPC-verified with the explorer URL pattern for independent checks.
"""
import math, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, "/home/hatch/workspace/vaultguard/demo/v2/anim")
from common import *

DUR = 35.78
N = int(DUR * FPS)

CARDS = [
    ("APPROVED", GREEN, "Withdraw 500 USDC — within the 1000 per-tx cap",
     "EEHfcL14YnABocSomyUJGNTozoBQFrLRHqinPAa2na5j", "request_withdraw", ""),
    ("REJECTED", RED, "Withdraw 2000 USDC — over the per-tx cap",
     "BLLd3UdF36pSjjotwodNcj5SZXEp4itwf96guHwZf5b1", "request_withdraw (receipt)",
     "VAULTGUARD: amount exceeds per-tx spend cap"),
    ("VAULT PAUSED", AMBER, "Guardian calls set_paused(true) — every withdrawal halts",
     "Dq8R4nZqRoSsUYnHD2MTh4NNVjrMF9k5cRLhBJ3PcdWo", "set_paused", ""),
    ("REJECTED", RED, "Withdraw 100 USDC — while the vault is paused",
     "g6xTryWvhgtdkzTd5Nf438uvxoPXajGXow3m32fCKDK", "request_withdraw (receipt)",
     "VAULTGUARD: vault is paused — guardian halt in effect"),
    ("VAULT RESUMED", GREEN, "Guardian calls set_paused(false) — withdrawals resume",
     "FR5g2Xm9fCK63Tj9sG91jGcTLYbpQxdGERo1Vb2nvkfB", "set_paused", ""),
    ("APPROVED", GREEN, "Withdraw 100 USDC — after unpause, recovery proven",
     "Goz6hbkT5LyVdKCP7sv4SZqMJ4dE98hqRB3CaHqYgbNy", "request_withdraw", ""),
]

PER = DUR / len(CARDS)

def draw_card(img, card, local_t, idx):
    d = ImageDraw.Draw(img)
    status, color, desc, hsh, method, panic = card
    # slide-in from right
    slide = ease_out_cubic(min(1.0, local_t / 0.7))
    ox = int(300 * (1 - slide))
    alpha = min(1.0, local_t / 0.5)

    # stamp: scale pop
    pop = ease_out_cubic(min(1.0, local_t / 0.45))
    sc = 0.6 + 0.4 * pop
    fs = int(92 * sc)
    # stamp box
    tw = font(F_BOLD, fs).getlength(status) + 90
    bx0, by0 = 960 - tw / 2 + ox, 330 - 62
    bx1, by1 = 960 + tw / 2 + ox, 330 + 62
    gl = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(gl)
    gd.rounded_rectangle([bx0, by0, bx1, by1], radius=20, outline=color + (int(200 * alpha),), width=4)
    img.alpha_composite(gl.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=20,
                        outline=color + (int(255 * alpha),), width=4,
                        fill=(color[0] // 6, color[1] // 6, color[2] // 6, int(200 * alpha)))
    sym = "✓" if color == GREEN else ("✗" if color == RED else "❚❚")
    d.text((960 + ox, 330), f"{sym} {status}", font=font(F_BOLD, fs),
           fill=(245, 250, 255, int(255 * alpha)), anchor="mm")

    # description
    dp = ease_out_cubic(min(1.0, max(0.0, (local_t - 0.5) / 0.5)))
    if dp > 0:
        d.text((960 + ox, 470), desc, font=font(F_REG, 38),
               fill=WHITE + (int(255 * dp),), anchor="mm")

    # hash typing
    hp = min(1.0, max(0.0, (local_t - 1.0) / 1.6))
    if hp > 0:
        shown = hsh[:int(len(hsh) * hp)]
        d.text((960 + ox, 585), shown, font=font(F_MONO, 34),
               fill=CYAN_LT + (int(255 * alpha),), anchor="mm")
        d.text((960 + ox, 640), "explorer.testnet.near.org/transactions/",
               font=font(F_MONO_R, 24), fill=DIM + (int(200 * alpha),), anchor="mm")

    # method + contract
    mp = ease_out_cubic(min(1.0, max(0.0, (local_t - 1.8) / 0.6)))
    if mp > 0:
        d.text((960 + ox, 730), f"{method}  →  vaultguard.vgdeployer.testnet",
               font=font(F_MONO, 28), fill=(170, 190, 215, int(255 * mp),), anchor="mm")

    # panic message for rejections
    if panic:
        pp = ease_out_cubic(min(1.0, max(0.0, (local_t - 2.4) / 0.6)))
        if pp > 0:
            d.text((960 + ox, 800), panic, font=font(F_MONO_R, 26),
                   fill=(255, 150, 150, int(255 * pp),), anchor="mm")

    # card counter
    d.text((960, 985), f"{idx + 1} / {len(CARDS)}", font=font(F_MONO, 24),
           fill=DIM + (int(180 * alpha),), anchor="mm")

def main():
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", "-r", str(FPS),
           "/home/hatch/workspace/vaultguard/demo/v2/build/s5.mp4"]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    parts = Particles(n=80, seed=55, speed=0.8)

    for k in range(N):
        t = k / FPS
        parts.step()
        base = gradient_bg(wobble=0.5, t=t)
        img = Image.fromarray(base, "RGB").convert("RGBA")
        d = ImageDraw.Draw(img)
        parts.draw(d, t, alpha=55)

        # header (persistent)
        d.text((960, 78), "ON-CHAIN PROOF · NEAR TESTNET",
               font=font(F_MONO, 30), fill=CYAN_LT + (255,), anchor="mm")
        d.text((960, 122), "hashes + outcomes from the real Phase-D run · 4 txs re-verified live via RPC",
               font=font(F_MONO_R, 22), fill=DIM + (255,), anchor="mm")

        idx = min(len(CARDS) - 1, int(t / PER))
        local_t = t - idx * PER
        # cross-slide between cards over 0.4s
        draw_card(img, CARDS[idx], local_t, idx)

        arr = np.array(img.convert("RGB"))
        arr = vignette(arr)
        proc.stdin.write(arr.tobytes())
        if k % 150 == 0:
            print(f"s5 frame {k}/{N}", flush=True)

    proc.stdin.close()
    proc.wait()
    print("S5 DONE")

if __name__ == "__main__":
    main()
