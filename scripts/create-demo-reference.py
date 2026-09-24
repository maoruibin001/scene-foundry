"""Create a small, deterministic PNG for the documented end-to-end smoke run."""

import pathlib
import struct
import sys
import zlib


WIDTH, HEIGHT = 640, 400
pixels = bytearray(WIDTH * HEIGHT * 3)


def paint(x, y, color):
    if 0 <= x < WIDTH and 0 <= y < HEIGHT:
        offset = (y * WIDTH + x) * 3
        pixels[offset : offset + 3] = bytes(color)


def rectangle(x0, y0, x1, y1, color):
    for y in range(max(0, y0), min(HEIGHT, y1)):
        for x in range(max(0, x0), min(WIDTH, x1)):
            paint(x, y, color)


def polygon(points, color):
    for y in range(max(0, min(point[1] for point in points)), min(HEIGHT, max(point[1] for point in points) + 1)):
        crossings = []
        for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]):
            if (y0 <= y < y1) or (y1 <= y < y0):
                crossings.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
        crossings.sort()
        for left, right in zip(crossings[::2], crossings[1::2]):
            rectangle(max(0, int(left)), y, min(WIDTH, int(right) + 1), y + 1, color)


def chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


for y in range(HEIGHT):
    sky = (157 + y // 30, 203 + y // 60, 225 + y // 90)
    rectangle(0, y, WIDTH, y + 1, sky)

rectangle(0, 286, WIDTH, HEIGHT, (64, 121, 153))
polygon([(50, 326), (143, 268), (292, 267), (391, 309), (531, 319), (574, 374), (43, 374)], (113, 106, 91))
polygon([(50, 326), (143, 268), (292, 267), (391, 309), (334, 330), (82, 346)], (151, 144, 123))

# A single red-and-white lighthouse and a blue maintenance platform make the
# test input's main objects and spatial relation easy to inspect.
polygon([(230, 252), (258, 102), (302, 102), (330, 252)], (239, 235, 217))
polygon([(292, 102), (302, 102), (330, 252), (304, 252)], (189, 186, 177))
polygon([(247, 160), (311, 160), (318, 190), (241, 190)], (184, 55, 48))
polygon([(237, 221), (324, 221), (330, 252), (230, 252)], (184, 55, 48))
rectangle(262, 83, 299, 103, (45, 65, 73))
rectangle(268, 87, 293, 100, (249, 215, 116))
polygon([(254, 83), (281, 61), (307, 83)], (171, 48, 43))
rectangle(279, 49, 283, 63, (70, 77, 75))
rectangle(274, 203, 287, 229, (45, 72, 80))

polygon([(321, 225), (433, 225), (466, 245), (349, 245)], (52, 116, 163))
polygon([(349, 245), (466, 245), (459, 252), (350, 252)], (36, 78, 113))
for x in (351, 444):
    rectangle(x, 250, x + 7, 302, (48, 75, 83))
for x in (348, 386, 424, 456):
    rectangle(x, 208, x + 4, 225, (51, 86, 100))
rectangle(348, 208, 460, 212, (51, 86, 100))

rows = b"".join(b"\x00" + pixels[y * WIDTH * 3 : (y + 1) * WIDTH * 3] for y in range(HEIGHT))
png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress(rows, 9))
    + chunk(b"IEND", b"")
)
destination = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "demo-reference.png")
destination.write_bytes(png)
print(destination)
