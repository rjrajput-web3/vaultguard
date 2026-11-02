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
    """Vertical gradient with subtle animated wobble. Returns (H, W, 3) uint8."""
    y = np.linspace(0, 1, H)[:, None, None]
    if wobble:
        y = y + wobble * math.sin(t * 0.7) * 0.05
    top_a = np.array(top, dtype=np.float32)[None, None, :]
    bot_a = np.array(bottom, dtype=np.float32)[None, None, :]
    img = top_a * (1 - y) + bot_a * y
    img = np.broadcast_to(img, (H, W, 3))
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

def cinematic_bg(t, seed=11, orbs=None):
    """Cinematic background: deep navy base + drifting radial glow orbs +
    particle network + vignette. Returns (H, W, 3) uint8 RGB array.
    orbs: list of (base_x, base_y, radius, color, drift_speed, phase) in 0..1 coords.
    """
    rng = np.random.default_rng(seed)
    # deep base with subtle vertical gradient
    y = np.linspace(0, 1, H)[:, None, None]
    top = np.array([4, 7, 15], dtype=np.float32)
    bot = np.array([9, 14, 28], dtype=np.float32)
    img = (top * (1 - y) + bot * y)
    img = np.broadcast_to(img, (H, W, 3)).copy()
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    if orbs is None:
        orbs = [
            (0.22, 0.30, 0.42, (28, 90, 160), 0.05, 0.0),    # blue left
            (0.80, 0.65, 0.46, (16, 110, 130), 0.04, 2.1),   # teal right
            (0.55, 0.12, 0.30, (70, 40, 120), 0.06, 4.2),    # violet top
        ]
    for bx, by, rad, col, dsp, ph in orbs:
        cx = (bx + dsp * math.sin(t * 0.35 + ph)) * W
        cy = (by + dsp * 0.7 * math.cos(t * 0.28 + ph)) * H
        r = rad * W
        d2 = ((xx - cx) ** 2 + (yy - cy) ** 2) / (r ** 2)
        glow = np.exp(-d2 * 2.2)
        for c in range(3):
            img[:, :, c] += glow * col[c] * 0.55
    # faint grid pulse
    gx = np.abs(np.sin(xx / 90 + t * 0.15)) ** 24
    gy = np.abs(np.sin(yy / 90 - t * 0.12)) ** 24
    grid = np.minimum(gx, gy) * 14
    img += grid[:, :, None]
    out = np.clip(img, 0, 255).astype(np.uint8)
    # vignette
    out = vignette(out, 0.42)
    return out

def tilt_3d(layer: Image.Image, t, cx, cy, speed=0.75, squeeze_amp=0.075, skew_amp=0.05):
    """Fake 3D Y-rotation on an RGBA layer: oscillating x-squeeze + skew.
    Returns transformed layer (same size). Tasteful, not gimmicky.
    """
    ph = t * speed
    sq = 1.0 - squeeze_amp * (0.5 + 0.5 * math.sin(ph))   # 0.925..1.0
    sk = skew_amp * math.cos(ph)
    w, h = layer.size
    m = (sq, sk, cx - sq * cx - sk * cy,
         0, 1, 0)
    return layer.transform((w, h), Image.AFFINE, m, resample=Image.BICUBIC)

def frosted_panel(base: Image.Image, box, radius=24, tint=(150, 200, 255),
                  tint_alpha=22, border_color=CYAN, border_alpha=200):
    """Draw a frosted-glass panel on RGBA base. box=(x0,y0,x1,y1).
    Returns base with panel composited (adds blur-behind, tint, glow border, shadow).
    """
    x0, y0, x1, y1 = box
    # drop shadow
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ds = ImageDraw.Draw(sh)
    ds.rounded_rectangle([x0 + 6, y0 + 14, x1 + 6, y1 + 14], radius=radius,
                         fill=(0, 0, 0, 110))
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(22)))
    # frosted: blurred brightened copy of the region beneath
    region = base.crop((x0, y0, x1, y1)).filter(ImageFilter.GaussianBlur(14))
    arr = np.array(region).astype(np.float32)
    arr[:, :, :3] = np.clip(arr[:, :, :3] * 1.12 + np.array(tint) * 0.10, 0, 255)
    arr[:, :, 3] = np.clip(arr[:, :, 3] * 0.55 + tint_alpha, 0, 255)
    frost = Image.fromarray(arr.astype(np.uint8))
    mask = Image.new("L", (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, x1 - x0, y1 - y0], radius=radius, fill=255)
    base.paste(frost, (x0, y0), mask)
    # glowing border
    gl = Image.new("RGBA", base.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(gl)
    gd.rounded_rectangle(box, radius=radius, outline=border_color + (90,), width=7)
    base.alpha_composite(gl.filter(ImageFilter.GaussianBlur(10)))
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(box, radius=radius, outline=border_color + (border_alpha,), width=2)
    # top highlight streak
    d.rounded_rectangle([x0 + 2, y0 + 2, x1 - 2, y0 + 60], radius=radius,
                        outline=(255, 255, 255, 40), width=2)
    return base

def fade(k, a, b):
    """0..1 fade between frame counts a..b."""
    if k < a:
        return 0.0
    if k > b:
        return 1.0
    return (k - a) / max(1, b - a)
