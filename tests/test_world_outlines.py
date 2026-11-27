import gzip
import json
import unittest
from shapely.geometry import shape
from src import atlas


def points(geometry):
    polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    return sum(len(ring) for polygon in polygons for ring in polygon)


class WorldOutlineTests(unittest.TestCase):
    def test_display_levels_preserve_every_country_and_continent_without_replacing_original_geography(self):
        countries = json.loads(gzip.decompress(atlas.static_bytes('podklad.json.gz')))['features']
        countries = [f for f in countries if f['properties'].get('kind') == 'country']
        continents = json.loads(gzip.decompress(atlas.static_bytes('kontynenty-obrysy.json.gz')))['features']
        for name, original in (('panstwa', countries), ('kontynenty', continents)):
            previous = sum(points(f['geometry']) for f in original)
            for level in ('lekkie', 'proste'):
                with self.subTest(kind=name, level=level):
                    data = json.loads(gzip.decompress(atlas.static_bytes(f'{name}-{level}.json.gz')))['features']
                    self.assertEqual([f['properties'] for f in data], [f['properties'] for f in original])
                    self.assertTrue(all(not shape(f['geometry']).is_empty for f in data))
                    current = sum(points(f['geometry']) for f in data)
                    self.assertLess(current, previous)
                    previous = current
        self.assertEqual(atlas.DEFAULT_LAYOUT['map_simple'], 'off')
        self.assertEqual(atlas.DEFAULT_LAYOUT['seas_simple'], 'on')
