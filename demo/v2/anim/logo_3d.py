"""3D logo treatment for the official VAULTRY logo.
Builds a genuine extruded-3D look from the flat logo art:
  - extruded side walls (layered dark-violet offsets = depth)
  - soft drop shadow (darken blend on the scene)
  - subtle reflection below (faded flip, screen blend)
  - animated 3D tilt wobble + scale breathing + light sweep
  - screen-blend composite (logo art sits on near-black, blends cleanly)
All motion stays slow and sophisticated.
"""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

LOGO_SRC = "/home/hatch/workspace/user/files/1000148418_3_2yuy.png"
LOGO_CROP = "/home/hatch/workspace/vaultguard/demo/v2/build/logo_crop.png"

# content region of the 1536x1024 logo art (V mark + wordmark + tagline)
CROP_BOX = (190, 130, 1350, 935)

_logo_cache = {}


def prepare_logo_crop():
    import os
    os.makedirs("/home/hatch/workspace/vaultguard/demo/v2/build", exist_ok=True)
    src = Image.open(LOGO_SRC).convert("RGB")
    crop = src.crop(CROP_BOX)
    crop.save(LOGO_CROP)
    return LOGO_CROP


def _get_logo(width_px):
    if width_px not in _logo_cache:
        crop = Image.open(LOGO_CROP).convert("RGB")
        w0, h0 = crop.size
        h = int(width_px * h0 / w0)
        logo = crop.resize((width_px, h), Image.LANCZOS)
        arr = np.array(logo).astype(np.float32)
        lum = arr.mean(axis=2)
        mask = (lum > 30).astype(np.uint8)
        # remove the background arc in the bottom-left corner (not logo geometry:
        # tagline ends ~y660, wedge starts ~y730 in crop coords)
        hh, ww = mask.shape
        yy, xx = np.mgrid[0:hh, 0:ww]
        wedge = (yy > 700) & (xx < 320)
        mask[wedge] = 0
        # also kill the art itself there so it doesn't screen-blend as a blob
        arr[wedge] = 0
        _logo_cache[width_px] = (logo, arr, Image.fromarray(mask * 255))
    return _logo_cache[width_px]


def render_logo_3d(width_px, t, progress, extrude=16, tilt_speed=0.7,
                   tilt_amp=0.055, seed_phase=0.0):
    """Render the 3D logo as an RGB-on-black canvas + shadow mask.
    Returns (canvas_rgb_uint8, shadow_f32_01, canvas_w, canvas_h).
    progress: 0..1 reveal fade. t: seconds (drives tilt/breathing).
    """
    logo, arr, mask_img = _get_logo(width_px)
    w, h = logo.size
    pad = 70
    refl_h = int(h * 0.32)
    cw, ch = w + pad * 2, h + pad * 2 + refl_h
    ox, oy = pad, pad

    # ---- extruded side walls (dark violet, offset down-right) ----
    wall = Image.new("RGB", (cw, ch), (0, 0, 0))
    wd = ImageDraw.Draw(wall)
    for i in range(extrude, 0, -1):
        dx = int(i * 0.9)
        dy = int(i * 0.9)
        # deepen color toward the logo face
        f = 1.0 - i / (extrude + 2)
        col = (int(30 + 40 * f), int(10 + 22 * f), int(70 + 70 * f))
        wd.bitmap((ox + dx, oy + dy), mask_img, fill=col)

    # ---- soft drop shadow (as alpha mask for darken blend) ----
    sh = Image.new("L", (cw, ch), 0)
    sd = ImageDraw.Draw(sh)
    sd.ellipse([ox + w * 0.08, oy + h * 0.86, ox + w * 0.92, oy + h * 1.06], fill=160)
    sh = sh.filter(ImageFilter.GaussianBlur(28))
    shadow = np.array(sh).astype(np.float32) / 255.0 * 0.55

    # ---- assemble: walls + screen-blended logo face ----
    canvas = np.array(wall).astype(np.float32)
    # screen blend: 255 - (255-a)(255-b)/255
    _pad = np.pad(arr, ((oy, ch - oy - h), (ox, cw - ox - w), (0, 0)),
               mode="constant")
    canvas = 255.0 - (255.0 - canvas) * (255.0 - _pad) / 255.0

    # ---- reflection (flipped, faded) ----
    flip = np.array(logo.transpose(Image.FLIP_TOP_BOTTOM)).astype(np.float32)
    ry0 = oy + h + 6
    rh = min(refl_h - 10, h)
    if rh > 0:
        flip_small = np.array(Image.fromarray(flip.astype(np.uint8)).resize(
            (w, rh), Image.LANCZOS)).astype(np.float32)
        fade = np.linspace(0.30, 0.0, rh, dtype=np.float32)[:, None, None]
        region = canvas[ry0:ry0 + rh, ox:ox + w]
        canvas[ry0:ry0 + rh, ox:ox + w] = 255.0 - (255.0 - region) * (
            1.0 - (flip_small / 255.0) * fade)

    # ---- 3D tilt wobble (rigid object) ----
    pil = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))
    ph = t * tilt_speed + seed_phase
    sq = 1.0 - tilt_amp * (0.5 + 0.5 * math.sin(ph))
    sk = (tilt_amp * 0.7) * math.cos(ph)
    cx, cy = cw / 2, (oy + h / 2)
    m = (sq, sk, cx - sq * cx - sk * cy, 0, 1, 0)
    pil = pil.transform((cw, ch), Image.AFFINE, m, resample=Image.BICUBIC)
    # shadow tilts with the object (approx: same transform)
    sh_pil = Image.fromarray((shadow * 255).astype(np.uint8)).transform(
        (cw, ch), Image.AFFINE, m, resample=Image.BICUBIC)
    shadow = np.array(sh_pil).astype(np.float32) / 255.0 * 0.55

    # ---- breathing scale is applied by the caller via resize; here just fade ----
    canvas = np.array(pil).astype(np.float32)
    canvas *= progress
    shadow *= progress
    return (np.clip(canvas, 0, 255).astype(np.uint8), shadow, cw, ch)


def composite_logo_3d(scene_rgb, width_px, cx, cy, t, progress, **kw):
    """Composite the 3D logo onto a scene RGB array (H,W,3 uint8).
    Returns new uint8 array. scene is darkened by the shadow, logo screened on.
    """
    from common import W, H  # noqa
    canvas, shadow, cw, ch = render_logo_3d(width_px, t, progress, **kw)
    x0 = int(cx - cw / 2)
    y0 = int(cy - ch / 2)
    # clip to frame
    sx0, sy0 = max(0, -x0), max(0, -y0)
    dx0, dy0 = max(0, x0), max(0, y0)
    sx1, sy1 = min(cw, W - x0), min(ch, H - y0)
    dx1, dy1 = dx0 + (sx1 - sx0), dy0 + (sy1 - sy0)
    if sx1 <= sx0 or sy1 <= sy0:
        return scene_rgb
    base = scene_rgb.astype(np.float32)
    sh = shadow[sy0:sy1, sx0:sx1][..., None]
    region = base[dy0:dy1, dx0:dx1]
    # 1) darken by shadow
    region = region * (1.0 - sh)
    # 2) screen blend logo
    lg = canvas[sy0:sy1, sx0:sx1].astype(np.float32)
    region = 255.0 - (255.0 - region) * (255.0 - lg) / 255.0
    base[dy0:dy1, dx0:dx1] = region
    return np.clip(base, 0, 255).astype(np.uint8)


def extruded_text_3d(text, fnt, fill, depth=10, glow_color=(139, 92, 246)):
    """Render 3D-extruded title text -> (RGB-on-black canvas, shadow mask).
    Caller composites with composite_rgb_on_black()."""
    # measure
    tmp = Image.new("RGB", (8, 8))
    td = ImageDraw.Draw(tmp)
    bb = td.textbbox((0, 0), text, font=fnt)
    tw, th = bb[2] - bb[0] + 40, bb[3] - bb[1] + 40
    pad = 40
    cw, ch = tw + pad * 2 + depth + 8, th + pad * 2 + depth + 8
    # text mask
    mimg = Image.new("L", (tw, th), 0)
    md = ImageDraw.Draw(mimg)
    md.text((20 - bb[0], 20 - bb[1]), text, font=fnt, fill=255)
    # walls
    wall = Image.new("RGB", (cw, ch), (0, 0, 0))
    wd = ImageDraw.Draw(wall)
    for i in range(depth, 0, -1):
        f = 1.0 - i / (depth + 2)
        col = (int(30 + 50 * f), int(16 + 30 * f), int(80 + 90 * f))
        wd.bitmap((pad + i, pad + i), mimg, fill=col)
    canvas = np.array(wall).astype(np.float32)
    # face: draw text in fill color via mask
    face = np.zeros((ch, cw, 3), dtype=np.float32)
    m = (np.array(mimg).astype(np.float32) / 255.0)
    fc = np.array(fill, dtype=np.float32)
    fh, fw = m.shape
    face[pad:pad + fh, pad:pad + fw] = m[..., None] * fc[None, None, :]
    canvas = 255.0 - (255.0 - canvas) * (255.0 - face) / 255.0
    # glow behind
    gl = Image.new("RGB", (cw, ch), (0, 0, 0))
    gd = ImageDraw.Draw(gl)
    gd.bitmap((pad, pad), mimg, fill=glow_color)
    gl = gl.filter(ImageFilter.GaussianBlur(24))
    gla = np.array(gl).astype(np.float32)
    canvas = 255.0 - (255.0 - canvas) * (255.0 - np.clip(gla * 0.8, 0, 255)) / 255.0
    # shadow mask
    sh = Image.new("L", (cw, ch), 0)
    ImageDraw.Draw(sh).bitmap((pad + 6, pad + 14), mimg, fill=150)
    shadow = np.array(sh.filter(ImageFilter.GaussianBlur(18))).astype(np.float32) / 255.0 * 0.5
    return np.clip(canvas, 0, 255).astype(np.uint8), shadow


def composite_rgb_on_black(scene_rgb, canvas, shadow, cx, cy, alpha):
    """Screen-blend an RGB-on-black canvas + darken shadow onto scene."""
    from common import W, H  # noqa
    ch, cw = canvas.shape[:2]
    x0, y0 = int(cx - cw / 2), int(cy - ch / 2)
    sx0, sy0 = max(0, -x0), max(0, -y0)
    dx0, dy0 = max(0, x0), max(0, y0)
    sx1, sy1 = min(cw, W - x0), min(ch, H - y0)
    dx1, dy1 = dx0 + (sx1 - sx0), dy0 + (sy1 - sy0)
    if sx1 <= sx0 or sy1 <= sy0 or alpha <= 0:
        return scene_rgb
    base = scene_rgb.astype(np.float32)
    sh = (shadow[sy0:sy1, sx0:sx1] * alpha)[..., None]
    region = base[dy0:dy1, dx0:dx1]
    region = region * (1.0 - sh)
    lg = canvas[sy0:sy1, sx0:sx1].astype(np.float32) * alpha
    region = 255.0 - (255.0 - region) * (255.0 - lg) / 255.0
    base[dy0:dy1, dx0:dx1] = region
    return np.clip(base, 0, 255).astype(np.uint8)
