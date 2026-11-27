"""Display-only country and continent outlines; keep original IDs and geography."""
import gzip
import json
from pathlib import Path
from shapely.geometry import shape, mapping

ROOT = Path(__file__).resolve().parents[1]
MAPS = ROOT / 'data/maps'


def main():
    countries = json.loads(gzip.decompress((MAPS / 'podklad.json.gz').read_bytes()))
    countries['features'] = [f for f in countries['features'] if f['properties'].get('kind') == 'country']
    continents = json.loads(gzip.decompress((MAPS / 'kontynenty-obrysy.json.gz').read_bytes()))
    for name, original in (('panstwa', countries), ('kontynenty', continents)):
        for level, tolerance in (('lekkie', .04), ('proste', .3)):
            features = []
            for feature in original['features']:
                geometry = shape(feature['geometry'])
                simplified = geometry.simplify(tolerance, preserve_topology=False)
                # Small states and islands must remain selectable, even when
                # their complete shape is smaller than the display tolerance.
                if simplified.is_empty or not simplified.is_valid:
                    simplified = geometry
                features.append({**feature, 'geometry': mapping(simplified)})
            body = json.dumps({**original, 'features': features}, ensure_ascii=False, separators=(',', ':')).encode()
            path = MAPS / f'{name}-{level}.json.gz'
            path.write_bytes(gzip.compress(body, compresslevel=9, mtime=0))
            print(path.name, len(body), 'decoded bytes;', path.stat().st_size, 'compressed bytes')


if __name__ == '__main__':
    main()
