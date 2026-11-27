import gzip
import json
import unittest
from pathlib import Path

from shapely.geometry import shape


class CoastalBasemapTests(unittest.TestCase):
    def test_capital_outlines_align_with_the_country_land_underneath(self):
        maps = Path(__file__).resolve().parents[1]/'data/maps'
        countries = json.loads((maps/'mapa.json').read_bytes())['panstwo']
        base = json.loads(gzip.decompress((maps/'podklad.json.gz').read_bytes()))['features']
        capitals = json.loads(gzip.decompress((maps/'stolice.json.gz').read_bytes()))['features']
        # Administrative limits may include harbour/estuary water. Most of a
        # coastal capital must nevertheless stand on the displayed land mask.
        for code, maximum_water in [('PT',.08),('DZ',.025),('MC',.001)]:
            with self.subTest(country=code):
                identifier = next(row[0] for row in countries if row[5] == code)
                land = shape(next(f['geometry'] for f in base if f['properties'].get('country_id') == identifier))
                city = shape(next(f['geometry'] for f in capitals if f['properties']['country'] == code))
                self.assertLess(city.difference(land).area/city.area,maximum_water)


if __name__ == '__main__':unittest.main()
