"""Shared cinematic animation helpers for VAULTGUARD v2 final video.
Abstract motion graphics only — no fake UI, faces, or products.
1920x1080@30fps, dark navy / electric blue / cyan palette.
"""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1920, 1080
FPS = 30

NAVY = (7, 11, 20)
NAVY2 = (13, 20, 36)
BLUE = (59, 130, 246)
CYAN = (34, 211, 238)
CYAN_LT = (125, 211, 252)
WHITE = (235, 240, 250)
DIM = (140, 155, 180)
RED = (239, 68, 68)
GREEN = (34, 197, 94)
AMBER = (245, 158, 11)

F_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
F_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
F_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
F_MONO_R = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

_fonts = {}
def font(path, size):
    key = (path, size)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(path, size)
    return _fonts[key]

def gradient_bg(top=NAVY, bottom=NAVY2, wobble=0.0, t=0.0):
    """Vertical gradient with subtle animated wobble."""
    y = np.linspace(0, 1, H)[:, None, None]
    if wobble:
        y = y + wobble * math.sin(t * 0.7) * 0.05
    top_a = np.array(top, dtype=np.float32)[None, None, :]
    bot_a = np.array(bottom, dtype=np.float32)[None, None, :]
    img = top_a * (1 - y) + bot_a * y
    return np.clip(img, 0, 255).astype(np.uint8)

def vignette(img, strength=0.35):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    dx = (xx - W / 2) / (W / 2)
    dy = (yy - H / 2) / (H / 2)
    d = np.sqrt(dx * dx + dy * dy)
    mask = 1.0 - strength * np.clip((d - 0.55) / 0.75, 0, 1) ** 1.6
    return (img.astype(np.float32) * mask[:, :, None]).astype(np.uint8)

class Particles:
    """Drifting particle field with connecting lines (network feel)."""
    def __init__(self, n=110, seed=7, speed=1.0, color=CYAN):
        rng = np.random.default_rng(seed)
        self.n = n
        self.pos = rng.random((n, 2)) * np.array([W, H])
        self.vel = (rng.random((n, 2)) - 0.5) * 28 * speed
        self.size = rng.integers(2, 5, n)
        self.color = color
        self.tw = rng.random(n) * math.tau

    def step(self, dt=1 / FPS):
        self.pos += self.vel * dt
        self.pos[:, 0] %= W
        self.pos[:, 1] %= H

    def draw(self, draw: ImageDraw.ImageDraw, t, alpha=90, link_dist=190):
        for i in range(self.n):
            x, y = self.pos[i]
            tw = 0.55 + 0.45 * math.sin(t * 2.2 + self.tw[i])
            a = int(alpha * tw)
            r = int(self.size[i])
            draw.ellipse([x - r, y - r, x + r, y + r],
                         fill=self.color + (a,))
        # sparse links
        p = self.pos
        for i in range(0, self.n, 4):
            dx = p - p[i]
            d = np.hypot(dx[:, 0], dx[:, 1])
            for j in np.where((d < link_dist) & (d > 1))[0][:3]:
                if j <= i:
                    continue
                a = int(38 * (1 - d[j] / link_dist))
                draw.line([tuple(p[i]), tuple(p[j])], fill=self.color + (a,), width=1)

def glow_text(base: Image.Image, xy, text, fnt, fill, glow_color, glow_radius=18, anchor="mm"):
    """Draw text with an outer glow on an RGBA base image."""
    glow_layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow_layer)
    gd.text(xy, text, font=fnt, fill=glow_color + (255,), anchor=anchor)
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(glow_radius))
    base.alpha_composite(glow_layer)
    d = ImageDraw.Draw(base)
    d.text(xy, text, font=fnt, fill=fill + (255,), anchor=anchor)
    return base

def light_sweep(img: np.ndarray, t, period=6.0, width=320, strength=0.16):
    """Diagonal light band sweeping across the frame."""
    ph = ((t % period) / period)
    cx = -width + ph * (W + 2 * width)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    band = np.exp(-((xx - yy * 0.35 - cx) ** 2) / (2 * (width / 2.4) ** 2))
    add = (band * 255 * strength)[:, :, None]
    return np.clip(img.astype(np.float32) + add, 0, 255).astype(np.uint8)

def ease_out_cubic(x):
    x = min(max(x, 0.0), 1.0)
    return 1 - (1 - x) ** 3

def ease_in_out(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)

def fade(k, a, b):
    """0..1 fade between frame counts a..b."""
    if k < a:
        return 0.0
    if k > b:
        return 1.0
    return (k - a) / max(1, b - a)
