"""Keep country coastlines and the ocean land mask aligned with capital data."""
import gzip
import json
import math
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union


def project(lon, lat):
    p = math.radians(lat);p2 = p*p;p4 = p2*p2
    x = math.radians(lon)*(.8707-.131979*p2+p4*(-.013791+p4*(.003971*p2-.001529*p4)))
    y = p*(1.007226+p2*(.015085+p4*(-.044475+.028874*p2-.005916*p4)))
    return 500+182.75*x,260-182.75*y


def svg_path(geometry):
    polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    return ' '.join('M'+' '.join(f'{x:.5f},{y:.5f}' for x,y in map(lambda p:project(*p[:2]),ring))+'Z'
                    for polygon in polygons for ring in polygon)


def main():
    root = Path(__file__).resolve().parents[1];maps = root/'data/maps'
    admin = json.loads((root/'.local/boundaries/natural-earth-adm1.geojson').read_bytes())['features']
    base = json.loads(gzip.decompress((maps/'podklad.json.gz').read_bytes()))
    rows = json.loads((maps/'mapa.json').read_bytes())
    capitals = json.loads(gzip.decompress((maps/'stolice.json.gz').read_bytes()))['features']
    for code in ('PT','DZ','MC'):
        outline = (shape(next(f['geometry'] for f in capitals if f['properties']['country'] == code)) if code == 'MC'
                   else unary_union([shape(f['geometry']) for f in admin if f['properties']['iso_a2'] == code]))
        assert outline.is_valid and not outline.is_empty
        row = next(r for r in rows['panstwo'] if r[5] == code)
        feature = next(f for f in base['features'] if f['properties'].get('country_id') == row[0])
        feature['geometry'] = mapping(outline)
        row[2] = svg_path(feature['geometry'])
    (maps/'podklad.json.gz').write_bytes(gzip.compress(json.dumps(base,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
    (maps/'mapa.json').write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    manifest_path = maps/'stolice-zrodla.json'
    manifest = json.loads(manifest_path.read_bytes())
    manifest['coastline_alignment'] = {'date':'2026-11-26','countries':['PT','DZ','MC'],
        'source':'Natural Earth administrative boundaries; geoBoundaries Monaco land quartiers',
        'note':'The ocean land mask follows country coastlines rather than simplified continent silhouettes.'}
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')


if __name__ == '__main__':main()
