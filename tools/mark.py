"""The WellTrack mark: one definition for every icon the app ships.

A cream heart inside a lime ring that is most of the way round, the same idea as
the progress bars on the Log screen: your heart, and how close you are to today's
goals. The unfilled part of the ring is a deeper green, so the gap still reads as
"track" rather than a broken circle at small sizes.

Run:  python tools/mark.py             -> writes icons/
      python tools/mark.py preview.png -> also writes a contact sheet
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SS = 4  # supersample, downsampled at the end for smooth edges

GREEN = (30, 90, 60)       # #1e5a3c: tile, splash screen and theme colour
GREEN_DEEP = (20, 66, 44)  # unfilled part of the ring
CREAM = (250, 246, 234)
LIME = (190, 232, 110)

RING_R, RING_W = 0.33, 0.075          # centre-line radius and stroke, as fractions of the tile
ARC_START, ARC_END = -90, 190         # degrees, clockwise from 3 o'clock; starts at 12
HEART_W = 0.30


def heart_mask(s, cx, cy, w):
    """Bold convex heart of width w centred at (cx, cy): two circles joined to a point by tangents."""
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    r = w * 0.29
    lx, ly = w * 0.21, -w * 0.12
    tip = (0, w * 0.46)
    for sign in (-1, 1):
        d.ellipse([cx + sign * lx - r, cy + ly - r, cx + sign * lx + r, cy + ly + r], fill=255)
    tangents = []
    for sign in (-1, 1):
        ccx, ccy = sign * lx, ly
        dist = math.hypot(tip[0] - ccx, tip[1] - ccy)
        base = math.atan2(tip[1] - ccy, tip[0] - ccx)
        a = math.acos(r / dist)
        cand = [(ccx + r * math.cos(base + k * a), ccy + r * math.sin(base + k * a)) for k in (1, -1)]
        tangents.append(max(cand, key=lambda p: p[0] * sign))
    (ax, ay), (bx, by) = tangents
    d.polygon([(cx + ax, cy + ay), (cx - lx, cy + ly), (cx, cy + ly - r * 0.3),
               (cx + lx, cy + ly), (cx + bx, cy + by), (cx + tip[0], cy + tip[1])], fill=255)
    return m


def draw_mark(size, maskable=False, rounded=True):
    """Render at `size` px. `maskable` = full-bleed, shrunk slightly into Android's safe zone."""
    s = size * SS
    k = 0.88 if maskable else 1.0
    im = Image.new("RGB", (s, s), GREEN)
    d = ImageDraw.Draw(im)

    c = s / 2
    R, w = RING_R * k * s, RING_W * k * s
    box = [c - R - w / 2, c - R - w / 2, c + R + w / 2, c + R + w / 2]
    d.arc(box, 0, 360, fill=GREEN_DEEP, width=round(w))
    d.arc(box, ARC_START, ARC_END, fill=LIME, width=round(w))
    for ang in (ARC_START, ARC_END):  # round caps
        x, y = c + R * math.cos(math.radians(ang)), c + R * math.sin(math.radians(ang))
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=LIME)

    im.paste(Image.new("RGB", (s, s), CREAM), (0, 0), heart_mask(s, c, c + 0.005 * s, HEART_W * k * s))
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
        sheet = Image.new("RGB", (1000, 340), (244, 244, 240))
        sheet.paste(Image.new("RGB", (500, 340), (17, 20, 18)), (500, 0))
        big = draw_mark(512).resize((260, 260), Image.LANCZOS)
        sheet.paste(big, (30, 40), big)
        m = draw_mark(512, maskable=True).resize((180, 180), Image.LANCZOS)
        circle = Image.new("L", (180, 180), 0)
        ImageDraw.Draw(circle).ellipse([0, 0, 179, 179], fill=255)
        sheet.paste(m, (310, 80), circle)  # Android's circular crop of the maskable icon
        x = 540
        for px in (120, 64, 48, 32):
            ic = draw_mark(px)
            sheet.paste(ic, (x, 170 - px // 2), ic)
            x += px + 30
        sheet.save(sys.argv[1])
        print("wrote", sys.argv[1])


if __name__ == "__main__":
    main()
