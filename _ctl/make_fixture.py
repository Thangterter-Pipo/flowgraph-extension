"""Create a tiny, content-free PNG fixture for upload testing.

Deliberately synthetic: a flat colour-block test pattern. No PII, no copyrighted
material, no recognisable subject.
"""
import struct
import zlib

W, H = 320, 180


def chunk(tag: bytes, data: bytes) -> bytes:
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


rows = []
for y in range(H):
    row = bytearray([0])  # filter type 0
    for x in range(W):
        # Four flat quadrants: grey / light grey / mid grey / dark grey.
        v = 200 if (x < W // 2) else 120
        if y >= H // 2:
            v = 160 if (x < W // 2) else 80
        row += bytes((v, v, v))
    rows.append(bytes(row))

raw = b"".join(rows)
png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(raw, 9))
       + chunk(b"IEND", b""))

out = r"e:\Flow_veo\_ctl\fixture_testpattern.png"
with open(out, "wb") as fh:
    fh.write(png)
print(f"wrote {out} ({len(png)} bytes, {W}x{H})")
