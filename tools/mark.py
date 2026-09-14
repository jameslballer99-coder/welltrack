"""The WellTrack mark: one definition for every icon the app ships.

A heart with a heartbeat cut clean through it, and a leaf sprouting from the
cleft: heart health that grows from what you eat. The pulse is cut out of the
heart (the green shows through) rather than drawn on top, so it stays crisp and
still reads as a single shape at favicon size. The leaf sits clear of the right
lobe so the heart silhouette is never broken.

Run:  python tools/mark.py            -> writes icons/
      python tools/mark.py preview.png -> also writes a contact sheet
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SS = 4  # supersample, downsampled at the end for smooth edges

GREEN_TOP = (64, 145, 96)
GREEN_BOTTOM = (22, 66, 45)
HEART = (252, 250, 243)
LEAF = (182, 230, 104)
MIDRIB = (120, 176, 72)

# Heart-local units. The heart is two overlapping circles joined to a point by
# tangent lines: convex sides, so it stays a bold heart and never pinches in.
LOBE_R, LOBE_X, LOBE_Y = 9.0, 7.2, -3.5
TIP = (0.0, 14.0)
# Whole mark spans y -24.5 (leaf tip) .. 14 (heart point).
UNIT = 0.0178
CENTRE_Y = -5.25
CENTRE_X = -0.8
PULSE = [(-20, 1.0), (-7.5, 1.0), (-4.6, -4.2), (-1.2, 7.4), (2.6, -7.6), (5.4, 1.0), (20, 1.0)]
PULSE_W = 2.5


def tangent_point(centre, r, external, outer_sign):
    """Point where a line from `external` touches the circle, on the side facing `outer_sign` in x."""
    cx, cy = centre
    ex, ey = external
    d = math.hypot(ex - cx, ey - cy)
    base = math.atan2(ey - cy, ex - cx)
    alpha = math.acos(r / d)
    pts = [(cx + r * math.cos(base + s * alpha), cy + r * math.sin(base + s * alpha)) for s in (1, -1)]
    return min(pts, key=lambda p: p[0] * -outer_sign)


def leaf_points(p0, p1, width, n=80):
    """A pointed leaf along p0→p1: widest just below the middle, tapering to both ends."""
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    side_a, side_b = [], []
    for i in range(n + 1):
        s = i / n
        half = width / 2 * math.sin(math.pi * s ** 0.85) ** 1.1
        cx, cy = x0 + dx * s, y0 + dy * s
        side_a.append((cx + nx * half, cy + ny * half))
        side_b.append((cx - nx * half, cy - ny * half))
    return side_a + side_b[::-1]


def bezier(p0, p1, p2, n=40):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in (i / n for i in range(n + 1))]


def draw_mark(size, maskable=False, rounded=True):
    """Render at `size` px. `maskable` = full-bleed with the mark inside Android's safe zone."""
    s = size * SS
    k = 0.80 if maskable else 1.0

    grad = Image.linear_gradient("L").resize((s, s))
    im = Image.composite(Image.new("RGB", (s, s), GREEN_BOTTOM), Image.new("RGB", (s, s), GREEN_TOP), grad)

    # Soft light from the top-left so the tile doesn't look flat.
    glow = Image.new("L", (s, s), 0)
    ImageDraw.Draw(glow).ellipse([-0.3 * s, -0.4 * s, 0.7 * s, 0.5 * s], fill=46)
    glow = glow.filter(ImageFilter.GaussianBlur(0.12 * s))
    im = Image.composite(Image.new("RGB", (s, s), (255, 255, 255)), im, glow)

    def P(x, y):
        return (0.5 + (x - CENTRE_X) * UNIT * k) * s, (0.5 + (y - CENTRE_Y) * UNIT * k) * s

    def W(w):
        return max(1, round(w * UNIT * k * s))

    # Heart with the pulse cut out of it.
    heart = Image.new("L", (s, s), 0)
    hd = ImageDraw.Draw(heart)
    for sign in (-1, 1):
        cx, cy = P(sign * LOBE_X, LOBE_Y)
        rr = LOBE_R * UNIT * k * s
        hd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=255)
    left = tangent_point((-LOBE_X, LOBE_Y), LOBE_R, TIP, -1)
    right = tangent_point((LOBE_X, LOBE_Y), LOBE_R, TIP, 1)
    hd.polygon([P(*left), P(-LOBE_X, LOBE_Y), P(0, LOBE_Y - 3), P(LOBE_X, LOBE_Y), P(*right), P(*TIP)], fill=255)
    pulse = [P(x, y) for x, y in PULSE]
    hd.line(pulse, fill=0, width=W(PULSE_W), joint="curve")
    r = W(PULSE_W) / 2
    for px, py in pulse[1:-1]:
        hd.ellipse([px - r, py - r, px + r, py + r], fill=0)
    im.paste(Image.new("RGB", (s, s), HEART), (0, 0), heart)

    # Stem and leaf.
    d = ImageDraw.Draw(im)
    d.line([P(*p) for p in bezier((0, -8.2), (0.1, -12.5), (2.6, -15.2))], fill=LEAF, width=W(1.5), joint="curve")
    d.polygon([P(*p) for p in leaf_points((2.0, -14.6), (11.5, -24.5), 7.4)], fill=LEAF)
    d.line([P(*p) for p in bezier((3.0, -15.6), (6.8, -19.0), (9.8, -22.6))], fill=MIDRIB, width=W(0.7))

    im = im.resize((size, size), Image.LANCZOS)
    if maskable or not rounded:
        return im

    # Rounded tile with transparent corners for "any" icons and the favicon.
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=0.23 * s, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask.resize((size, size), Image.LANCZOS))
    return out


def main():
    icons = Path(__file__).resolve().parent.parent / "icons"
    targets = {
        "icon-192.png": draw_mark(192),
        "icon-512.png": draw_mark(512),
        "icon-maskable-192.png": draw_mark(192, maskable=True),
        "icon-maskable-512.png": draw_mark(512, maskable=True),
        "apple-touch-icon.png": draw_mark(180, rounded=False),  # iOS rounds it itself
        "favicon-32.png": draw_mark(32),
    }
    for name, img in targets.items():
        img.save(icons / name, optimize=True)
        print("wrote", name)

    if len(sys.argv) > 1:
        sheet = Image.new("RGB", (1180, 620), (245, 245, 241))
        dark = Image.new("RGB", (590, 300), (17, 20, 18))
        sheet.paste(dark, (590, 320))
        big = draw_mark(512)
        sheet.paste(big.resize((280, 280), Image.LANCZOS), (20, 20), big.resize((280, 280), Image.LANCZOS))
        m = draw_mark(512, maskable=True).resize((280, 280), Image.LANCZOS)
        circle = Image.new("L", (280, 280), 0)
        ImageDraw.Draw(circle).ellipse([0, 0, 279, 279], fill=255)
        sheet.paste(m, (320, 20), circle)  # how Android shows a maskable icon in a circle
        x = 640
        for px in (96, 64, 48, 32, 16):
            ic = draw_mark(px)
            sheet.paste(ic, (x, 120 - px // 2), ic)
            sheet.paste(ic, (x, 470 - px // 2), ic)
            x += px + 24
        sheet.save(sys.argv[1])
        print("wrote", sys.argv[1])


if __name__ == "__main__":
    main()
