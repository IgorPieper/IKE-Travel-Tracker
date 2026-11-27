import gzip
import io
import json
import random
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from src.geometry_codec import pack_geometry, decode_geometry, MAGIC
from src.http_assets import send_asset, accepts_gzip, asset_body, basemap_layer
from src.photos import photo_thumbnail
from src import atlas


class GeometryCompressionTests(unittest.TestCase):
    def test_lossless_round_trip_for_each_supported_type_including_holes_and_negative_coordinates(self):
        rng = random.Random(1)
        ring = [[round(rng.uniform(-180, 180), 6), round(rng.uniform(-85, 85), 6)] for _ in range(100)]
        for kind, coordinates in [('Polygon', [ring, ring[:10]]), ('MultiPolygon', [[ring], [ring[:10]]]),
                                  ('LineString', ring), ('MultiLineString', [ring, ring[:10]])]:
            geometry = {'type': kind, 'coordinates': coordinates}
            blob = zlib.compress(json.dumps(geometry).encode())
            packed = pack_geometry(blob)
            self.assertTrue(packed.startswith(MAGIC))
            self.assertLess(len(packed), len(blob))
            self.assertEqual(decode_geometry(packed), geometry)
            self.assertEqual(decode_geometry(blob), geometry)
            self.assertEqual(pack_geometry(packed), packed)

    def test_higher_precision_and_extra_dimensions_are_never_rounded_or_discarded(self):
        for geometry in [
            {'type': 'LineString', 'coordinates': [[1.123456789, 2], [3, 4]]},
            {'type': 'LineString', 'coordinates': [[1, 2, 3], [4, 5, 6]]},
            {'type': 'Point', 'coordinates': [1, 2]},
        ]:
            blob = zlib.compress(json.dumps(geometry).encode())
            self.assertEqual(pack_geometry(blob), blob)


class Handler:
    def __init__(self, headers=None):
        self.headers = headers or {}
        self.output_headers = {}
        self.body = None
        self.status = None
    def send_response(self, status): self.status = status
    def send_header(self, name, value): self.output_headers[name] = value
    def end_headers(self): pass
    def send_data(self, body, media_type, **options):
        self.status = 200
        self.body = body
        self.options = options


class AssetCacheTests(unittest.TestCase):
    def test_lazy_basemap_layers_reconstruct_the_original_without_changing_coastlines(self):
        path = atlas.ASSET_FILES['podklad.json.gz']
        stat = path.stat()
        original = json.loads(gzip.decompress(path.read_bytes()))['features']
        combined = []
        for kind in ('country', 'water'):
            body, compressed = basemap_layer(path, stat.st_mtime_ns, stat.st_size, kind)
            self.assertEqual(gzip.decompress(compressed), body)
            features = json.loads(body)['features']
            self.assertEqual(features, [f for f in original if (f['properties'].get('kind') == 'country') == (kind == 'country')])
            combined.extend(features)
        self.assertEqual(len(combined), len(original))

    def test_compression_conditional_requests_and_external_file_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'example.js'
            original = b'const value = "hello";\n' * 1000
            path.write_bytes(original)
            first = Handler({'Accept-Encoding': 'gzip'})
            send_asset(first, path, 'text/javascript')
            self.assertEqual(gzip.decompress(first.body), original)
            self.assertLess(len(first.body), len(original) / 10)
            etag = first.options['etag']
            second = Handler({'Accept-Encoding': 'gzip', 'If-None-Match': etag})
            send_asset(second, path, 'text/javascript')
            self.assertEqual(second.status, 304)
            self.assertIsNone(second.body)
            path.write_bytes(original + b'// edited')
            third = Handler({'Accept-Encoding': 'gzip', 'If-None-Match': etag})
            send_asset(third, path, 'text/javascript')
            self.assertEqual(third.status, 200)
            self.assertNotEqual(third.options['etag'], etag)
            self.assertEqual(gzip.decompress(third.body), path.read_bytes())

    def test_precompressed_map_can_also_be_read_by_a_client_without_gzip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'map.json.gz'
            body = b'{"features":[]}'
            path.write_bytes(gzip.compress(body))
            plain = Handler()
            send_asset(plain, path, 'application/geo+json')
            self.assertEqual(plain.body, body)
            archive = Handler()
            send_asset(archive, path, 'application/gzip')
            self.assertEqual(gzip.decompress(archive.body), body)
            self.assertIsNone(archive.options['encoding'])
        self.assertFalse(accepts_gzip('gzip;q=0'))
        self.assertFalse(accepts_gzip('gzip;q=invalid'))

    def test_visit_cache_returns_independent_rows_and_detects_manual_csv_edits(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(atlas, 'CSV', Path(directory) / 'visits.csv'):
            atlas.write_visits([{'kategoria': 'panstwo', 'id': 'first', 'notatka': 'original'}])
            rows = atlas.read_visits()
            rows[0]['notatka'] = 'changed in memory'
            self.assertEqual(atlas.read_visits()[0]['notatka'], 'original')
            atlas.write_visits([{'kategoria': 'panstwo', 'id': 'second'}])
            self.assertEqual(atlas.read_visits()[0]['id'], 'second')

    def test_summary_has_all_challenge_entries_without_geometry(self):
        summaries = json.loads(atlas.challenge_summaries())
        self.assertEqual(len(summaries), 6)
        self.assertEqual(len(summaries['seas']['data']['features']), 52)
        self.assertEqual(sum(not f['properties'].get('optional') for f in summaries['seas']['data']['features']), 48)
        self.assertTrue(summaries['parks']['attractions'])
        for summary in summaries.values():
            self.assertTrue(all(f['geometry'] is None for f in summary['data']['features']))

    def test_photo_preview_is_small_and_never_changes_the_original(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'photo.jpg'
            Image.effect_noise((1600, 1200), 80).convert('RGB').save(path, quality=90)
            original = path.read_bytes()
            stat = path.stat()
            thumbnail = photo_thumbnail(path, stat.st_mtime_ns, stat.st_size)
            self.assertEqual(path.read_bytes(), original)
            with Image.open(io.BytesIO(thumbnail)) as image:
                self.assertLessEqual(max(image.size), 640)
            self.assertLess(len(thumbnail), len(original) / 2)


if __name__ == '__main__':
    unittest.main()
