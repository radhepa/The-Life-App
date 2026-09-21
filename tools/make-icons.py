#!/usr/bin/env python3
"""Generate the app icons in icons/ (requires Pillow).

    python tools/make-icons.py

The mark is a progress ring — the same shape as the focus timer — on the app's
sage green. It is drawn full-bleed with everything inside the centre 60%, so the
same artwork works as a plain icon, an iOS home-screen icon (iOS rounds the
corners itself) and a maskable Android icon.
"""
import math
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'icons')
BASE = 1024          # draw big, then downsample for clean edges

TOP, BOTTOM = (134, 199, 149), (95, 159, 110)     # gradient, top -> bottom
WHITE = (255, 255, 255)


def gradient(size):
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        row = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        for x in range(size):
            px[x, y] = row
    return img


def ring_layer(size):
    """White ring: faint full track, bright ~72% arc from 12 o'clock, centre dot."""
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = size / 2
    r = size * 0.27                     # ring centre-line radius
    w = size * 0.085                    # stroke width
    R = r + w / 2                       # PIL strokes inward from the box edge
    box = [c - R, c - R, c + R, c + R]

    d.ellipse(box, outline=WHITE + (70,), width=round(w))          # track

    start, sweep = -90, 260                                         # degrees
    d.arc(box, start, start + sweep, fill=WHITE + (255,), width=round(w))
    for ang in (start, start + sweep):                              # round caps
        x = c + r * math.cos(math.radians(ang))
        y = c + r * math.sin(math.radians(ang))
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=WHITE + (255,))

    dot = size * 0.055                                              # centre dot
    d.ellipse([c - dot, c - dot, c + dot, c + dot], fill=WHITE + (255,))
    return layer


def make(px):
    art = gradient(BASE).convert('RGBA')
    art.alpha_composite(ring_layer(BASE))
    return art.convert('RGB').resize((px, px), Image.LANCZOS)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, px in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
        make(px).save(os.path.join(OUT, name), optimize=True)
        print('wrote', name, px)
