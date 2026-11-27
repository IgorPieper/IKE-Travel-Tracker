"""Build display-only sea overviews and a coastline with no political borders."""
import gzip
import json
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]


def write(path, data):
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
    path.write_bytes(gzip.compress(body, compresslevel=9, mtime=0))
    print(path.name, len(body), 'decoded bytes;', path.stat().st_size, 'compressed bytes')


def main():
    original = json.loads((ROOT / 'data/challenges/morza-wyzwanie.json').read_bytes())
    for filename, tolerance in (('morza-mapa', .04), ('morza-proste', .3)):
        features = []
        for feature in original['features']:
            geometry = shape(feature['geometry'])
            if geometry.geom_type != 'Point':
                simplified = geometry.simplify(tolerance, preserve_topology=False)
                if not simplified.is_empty:
                    geometry = simplified
            features.append({**feature, 'geometry': mapping(geometry)})
        write(ROOT / f'data/challenges/{filename}.json.gz', {**original, 'features': features})
    base = json.loads(gzip.decompress((ROOT / 'data/maps/podklad.json.gz').read_bytes()))
    countries = [shape(f['geometry']).buffer(0) for f in base['features'] if f['properties'].get('kind') == 'country']
    land = unary_union(countries).simplify(.015, preserve_topology=False)
    assert land.is_valid and not land.is_empty
    write(ROOT / 'data/challenges/morza-lady.json.gz', {
        'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {}, 'geometry': mapping(land)}]})


if __name__ == '__main__':
    main()
