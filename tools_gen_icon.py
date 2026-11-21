#!/usr/bin/env python3
"""Génère les icônes (PWA + launcher Android) sans dépendance externe.
Cube isométrique orange (pièce en couches) sous une buse, fond sombre arrondi.
Encodeur PNG pur-Python, anticrénelage 3×3."""
import struct, zlib, math, os, sys

BG = (11, 18, 32)
TOP, LEFT, RIGHT = (252, 211, 77), (245, 158, 11), (180, 100, 8)
NOZ = (148, 163, 184)
LINE = (11, 18, 32)

c = 0.5; h = 0.17; w = 0.27
# cube isométrique centré bas
cy = 0.60
top = [(c, cy - h), (c + w, cy - h + w * 0.55 - h * 0.0 - 0.0), (c, cy - h + w * 1.1), (c - w, cy - h + w * 0.55)]
P = lambda x, y: (x, y)
T0 = (c, cy - 0.10); TR = (c + w, cy + 0.05); TB = (c, cy + 0.20); TL = (c - w, cy + 0.05)
B_R = (c + w, TR[1] + 0.26); B_B = (c, TB[1] + 0.26); B_L = (c - w, TL[1] + 0.26)
FACES = [
    ([T0, TR, TB, TL], TOP),
    ([TL, TB, B_B, B_L], LEFT),
    ([TB, TR, B_R, B_B], RIGHT),
]
# buse : bloc + pointe
NOZZLE = [(c - 0.11, 0.08), (c + 0.11, 0.08), (c + 0.11, 0.20), (c + 0.05, 0.20), (c, 0.30), (c - 0.05, 0.20), (c - 0.11, 0.20)]
# lignes de couches sur les faces latérales
def layer_lines():
    segs = []
    for k in range(1, 4):
        t = k * 0.26 / 4
        segs.append(((TL[0], TL[1] + t), (TB[0], TB[1] + t)))
        segs.append(((TB[0], TB[1] + t), (TR[0], TR[1] + t)))
    return segs
SEGS = layer_lines()

def in_poly(px, py, poly):
    inside = False; j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside

def seg_dist(px, py, a, b):
    ax, ay = a; bx, by = b
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)

def color_at(u, v, rad, full):
    if not full:
        cx = min(max(u, rad), 1 - rad); cy2 = min(max(v, rad), 1 - rad)
        if math.hypot(u - cx, v - cy2) > rad: return None
    if in_poly(u, v, NOZZLE): return NOZ
    for poly, col in FACES:
        if in_poly(u, v, poly):
            if col is not TOP and any(seg_dist(u, v, a, b) < 0.008 for a, b in SEGS):
                return tuple(int(x * 0.7) for x in col)
            return col
    return BG

def make(size, full=False, scale=1.0):
    s = size; ss = 3; rad = 0.22
    px = bytearray()
    for y in range(s):
        px.append(0)
        for x in range(s):
            acc = [0, 0, 0, 0]
            for j in range(ss):
                for i in range(ss):
                    u = ((x + (i + .5) / ss) / s - .5) / scale + .5
                    v = ((y + (j + .5) / ss) / s - .5) / scale + .5
                    col = color_at(u, v, rad, full)
                    if col is None: continue
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 255
            n = ss * ss; a = acc[3] / 255
            if a == 0: px += bytes((0, 0, 0, 0)); continue
            px += bytes((int(acc[0] / a), int(acc[1] / a), int(acc[2] / a), int(acc[3] / n)))
    return png(s, s, bytes(px))

def png(w, h, raw):
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")

def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "wb").write(data); print("écrit", path)

if __name__ == "__main__":
    base = os.path.dirname(os.path.abspath(__file__))
    write(os.path.join(base, "www/img/icon-192.png"), make(192))
    write(os.path.join(base, "www/img/icon-512.png"), make(512))
    if "--android" in sys.argv:
        for d, sz in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
            r = f"android/app/src/main/res/mipmap-{d}/"
            write(os.path.join(base, r + "ic_launcher.png"), make(sz))
            write(os.path.join(base, r + "ic_launcher_round.png"), make(sz))
            # icône adaptative : premier plan plein cadre réduit dans la zone sûre
            write(os.path.join(base, r + "ic_launcher_foreground.png"), make(int(sz * 108 / 48), full=True, scale=0.62))
