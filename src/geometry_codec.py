"""Lossless delta encoding for the six-decimal offline map coordinates.

Older zlib/GeoJSON databases remain readable. Unsupported geometries or higher
precision coordinates stay in their original format rather than being rounded.
"""
import json
import sys
import zlib
from array import array
from itertools import accumulate

MAGIC = b'IKG1'
KINDS = ('Polygon', 'MultiPolygon', 'LineString', 'MultiLineString')


def decode_geometry(blob):
    if not blob.startswith(MAGIC):
        return json.loads(zlib.decompress(blob))
    kind = KINDS[blob[4]]
    values = array('i')
    values.frombytes(zlib.decompress(blob[5:]))
    if sys.byteorder != 'little':
        values.byteswap()
    offset = 1
    polygons = []
    for _ in range(values[0]):
        rings = []
        count = values[offset]
        offset += 1
        for _ in range(count):
            length = values[offset]
            offset += 1
            end = offset + length * 2
            xs = accumulate(values[offset:end:2])
            ys = accumulate(values[offset+1:end:2])
            rings.append([[x / 1e6, y / 1e6] for x, y in zip(xs, ys)])
            offset = end
        polygons.append(rings)
    coordinates = (polygons if kind == 'MultiPolygon' else polygons[0] if kind in ('Polygon', 'MultiLineString')
                   else polygons[0][0])
    return {'type': kind, 'coordinates': coordinates}


def pack_geometry(blob):
    if blob.startswith(MAGIC):
        return blob
    geometry = decode_geometry(blob)
    kind = geometry.get('type')
    if kind not in KINDS or set(geometry) != {'type', 'coordinates'}:
        return blob
    coordinates = geometry['coordinates']
    polygons = coordinates if kind == 'MultiPolygon' else [coordinates] if kind in ('Polygon', 'MultiLineString') else [[coordinates]]
    values = array('i', [len(polygons)])
    for rings in polygons:
        values.append(len(rings))
        for ring in rings:
            values.append(len(ring))
            previous_x = previous_y = 0
            for point in ring:
                if len(point) != 2:
                    return blob
                x, y = point
                ix, iy = round(x * 1e6), round(y * 1e6)
                if ix / 1e6 != x or iy / 1e6 != y:
                    return blob
                values.extend((ix - previous_x, iy - previous_y))
                previous_x, previous_y = ix, iy
    if sys.byteorder != 'little':
        values.byteswap()
    encoded = MAGIC + bytes([KINDS.index(kind)]) + zlib.compress(values.tobytes(), 6)
    return encoded if len(encoded) < len(blob) else blob
