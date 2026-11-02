"""Terminal playback renderer — plays back REAL captured CLI output with typing/scroll motion.
Usage: python term_play.py <input.txt> <start_line> <end_line> <duration_s> <out.mp4> <label> <title>
Lines are 1-based inclusive. Output is real; only the reveal animation is synthetic.
"""
import math, subprocess, sys, textwrap
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, "/home/hatch/workspace/vaultguard/demo/v2/anim")
from common import *

TERM_BG = (10, 14, 23)
TERM_BAR = (18, 26, 42)
WRAP_WIDTH = 92  # mono chars that fit the terminal width at 26px

def colorize(line):
    s = line.strip()
    if s.startswith("===="):
        return CYAN, True
    if s.startswith("STEP"):
        return CYAN_LT, True
    if "DECISION:" in s:
        return AMBER, True
    if "risk=SAFE" in s or "use-primary" in s:
        return GREEN, False
    if "no-route-pause" in s or "DEGRADED" in s or "refuses" in s:
        return (255, 150, 150), False
    if s.startswith("[20"):
        return DIM, False
    if "out=" in s or "tx " in s or "0x" in s or "near:" in s or "8453:" in s:
        return CYAN_LT, False
    if s.startswith("source=") or s.startswith("primary router") or s.startswith("selected"):
        return WHITE, False
    return (200, 208, 224), False

def main():
    inp, ls, le, dur, out, label, title = sys.argv[1:8]
    ls, le, dur = int(ls), int(le), float(dur)
    lines = open(inp).read().split("\n")
    seg = [l.rstrip() for l in lines[ls - 1:le]]
    # drop leading/trailing blank lines
    while seg and not seg[0].strip():
        seg.pop(0)
    while seg and not seg[-1].strip():
        seg.pop()

    # wrap long lines so nothing is cut off horizontally; keep color of original line
    wrapped = []  # (text, orig_index)
    for i, l in enumerate(seg):
        if len(l) <= WRAP_WIDTH:
            wrapped.append((l, i))
        else:
            for p in textwrap.wrap(l, width=WRAP_WIDTH, break_long_words=True,
                                   break_on_hyphens=False):
                wrapped.append((p, i))
    N = int(dur * FPS)
    mono = font(F_MONO_R, 26)
    mono_b = font(F_MONO, 26)
    # typing plan: total chars -> chars per frame
    full = "\n".join(t for t, _ in wrapped)
    total_chars = len(full) + len(wrapped)  # + newlines
    # reveal over first 55% of duration (fast start — no empty-feeling opening), hold rest
    reveal_frames = int(N * 0.55)
    cpf = max(1, total_chars / max(1, reveal_frames))

    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", "-r", str(FPS), out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    # precompute char offsets per (wrapped) line
    line_starts = []
    acc = 0
    for t, _ in wrapped:
        line_starts.append(acc)
        acc += len(t) + 1

    max_visible = 20  # lines that fit the terminal area at 34px line height
    line_h = 34
    term_x0, term_y0 = 110, 150
    term_w, term_h = 1700, 800

    for k in range(N):
        t = k / FPS
        base = gradient_bg(top=(5, 8, 16), bottom=(10, 16, 30), wobble=0.4, t=t)
        img = Image.fromarray(base, "RGB").convert("RGBA")
        d = ImageDraw.Draw(img)

        # label top-left
        lp = ease_out_cubic(fade(k, 0, 20))
        if lp > 0.01:
            d.text((110, 62), label, font=font(F_MONO, 28),
                   fill=AMBER + (int(255 * lp),), anchor="lm")
            d.text((1810, 62), "● REC", font=font(F_MONO, 24),
                   fill=RED + (int(255 * lp * (0.5 + 0.5 * math.sin(t * 4))),), anchor="rm")

        # terminal window
        d.rounded_rectangle([term_x0, term_y0, term_x0 + term_w, term_y0 + term_h],
                            radius=16, fill=TERM_BG + (255,), outline=(60, 90, 140, 255), width=2)
        # title bar
        d.rounded_rectangle([term_x0, term_y0, term_x0 + term_w, term_y0 + 52],
                            radius=16, fill=TERM_BAR + (255,))
        d.rectangle([term_x0, term_y0 + 26, term_x0 + term_w, term_y0 + 52], fill=TERM_BAR + (255,))
        for ci, cc in enumerate([RED, AMBER, GREEN]):
            d.ellipse([term_x0 + 24 + ci * 30, term_y0 + 18, term_x0 + 42 + ci * 30, term_y0 + 36],
                      fill=cc + (255,))
        d.text((term_x0 + 130, term_y0 + 27), title, font=font(F_MONO_R, 22),
               fill=DIM + (255,), anchor="lm")

        # revealed text
        n_chars = int(min(1.0, k / max(1, reveal_frames)) * total_chars)
        # find which lines are fully/partially visible
        vis_lines = []
        for wi, (l, oi) in enumerate(wrapped):
            s0 = line_starts[wi]
            if n_chars <= s0:
                break
            shown = min(len(l), n_chars - s0)
            vis_lines.append((l[:shown], oi))
        # scroll: keep last max_visible lines
        if len(vis_lines) > max_visible:
            vis_lines = vis_lines[-max_visible:]
        y = term_y0 + 78
        for txt, i in vis_lines:
            col, bold = colorize(seg[i])
            d.text((term_x0 + 30, y), txt, font=mono_b if bold else mono,
                   fill=col + (255,), anchor="lm")
            y += line_h
        # blinking cursor at end
        if k % 30 < 18 and vis_lines:
            last_y = term_y0 + 78 + (len(vis_lines) - 1) * line_h
            last_txt, last_i = vis_lines[-1]
            cx = term_x0 + 30 + (mono_b if colorize(seg[last_i])[1] else mono).getlength(last_txt) + 6
            d.rectangle([cx, last_y - 12, cx + 14, last_y + 12], fill=CYAN + (220,))

        arr = np.array(img.convert("RGB"))
        arr = vignette(arr, 0.3)
        proc.stdin.write(arr.tobytes())
        if k % 150 == 0:
            print(f"term {k}/{N}", flush=True)

    proc.stdin.close()
    proc.wait()
    print("TERM DONE", out)

if __name__ == "__main__":
    main()
