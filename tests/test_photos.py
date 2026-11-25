import base64
import csv
import io
import json
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image
from src import atlas, photos
from src.photo_properties import read_properties, properties_exif, update_jpeg_properties, write_photo_atomic
from src.journal_export import build_journal
from test_journal_export import fixture


def encoded_image(size=(2200, 1200), color='teal'):
    output = io.BytesIO()
    image = Image.new('RGB', size, color)
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = 'private metadata'
    image.save(output, 'JPEG', exif=exif)
    return base64.b64encode(output.getvalue()).decode()


class PhotoTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.patch = patch.object(atlas, 'USER_DATA', self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_compression_orientation_metadata_and_deduplication(self):
        encoded = encoded_image()
        photo = photos.store_photo(encoded)
        path = photos.photo_path(photo['id'])
        self.assertLessEqual(path.stat().st_size, 300 * 1024)
        with Image.open(path) as image:
            self.assertLessEqual(max(image.size), 1600)
            self.assertGreater(image.height, image.width)
            self.assertNotIn(274, image.getexif())
            self.assertNotIn(34853, image.getexif())
            self.assertEqual(read_properties(image)["title"], "private metadata")
        self.assertEqual(photo['id'], photos.store_photo(encoded)['id'])
        self.assertEqual(len(list(photos.photo_dir().iterdir())), 1)
        noise = Image.effect_noise((1800, 1600), 100).convert('RGB')
        output = io.BytesIO(); noise.save(output, 'PNG')
        noisy = photos.store_photo(base64.b64encode(output.getvalue()).decode())
        self.assertLessEqual(noisy['bytes'], 300 * 1024)

    def test_invalid_images_and_references(self):
        for value in ('!!!', base64.b64encode(b'not a photo').decode(), None):
            with self.assertRaises(ValueError): photos.store_photo(value)
        for value in ('../outside', 'a' * 63, 'A' * 64):
            with self.assertRaises(ValueError): photos.photo_path(value)
        refs = [{'id': 'a' * 64, 'caption': 'A'}, {'id': 'b' * 64, 'caption': 'B'}]
        with self.assertRaises(ValueError): atlas.visit_details({'zdjecia': refs})
        self.assertEqual(photos.photo_refs(photos.encoded_refs(refs, True)), refs)
        with self.assertRaises(ValueError): photos.photo_refs([{'id': 'a' * 64, 'caption': 'x' * 501}])

    def test_trip_tags_include_member_photos_and_follow_trip_changes(self):
        _, rows = fixture()
        one = photos.store_photo(encoded_image())
        two = photos.store_photo(encoded_image(color='gold'))
        rows[2]['zdjecia'] = photos.encoded_refs([{'id': one['id'], 'caption': ''}])
        rows[-1]['zdjecia'] = photos.encoded_refs([{'id': two['id'], 'caption': ''}])
        trip = rows[-1]
        trip_id = 'trip:' + trip['id']
        result = {photo['id']: photo for photo in photos.gallery(rows)['photos']}
        self.assertEqual(result[one['id']]['tags'], [{'id': trip_id, 'name': trip['nazwa'], 'kind': 'trip'}])
        self.assertEqual(result[two['id']]['tags'], result[one['id']]['tags'])
        trip['nazwa'] = 'Renamed trip'
        self.assertEqual(photos.trip_photo_tags(rows)[one['id']][0]['name'], 'Renamed trip')
        # A return visit carries its place's photo into another trip too.
        repeat = json.loads(rows[2]['kolejne_wizyty'])[0]['id']
        other = {**trip, 'id': '44444444-4444-4444-8444-444444444444', 'nazwa': 'Return trip',
                 'zdjecia': '', 'miejsca': json.dumps(['miasto:osm:1:visit:' + repeat])}
        rows.append(other)
        self.assertEqual(len(photos.trip_photo_tags(rows)[one['id']]), 2)
        trip['miejsca'] = '[]'
        self.assertEqual([tag['name'] for tag in photos.trip_photo_tags(rows)[one['id']]], ['Return trip'])
        self.assertNotIn(one['id'], photos.trip_photo_tags([row for row in rows if row['kategoria'] != 'wycieczka']))

    def test_manual_tags_persist_normalize_remove_and_survive_legacy_updates(self):
        with patch.object(atlas, 'CSV', self.root / 'visits.csv'):
            photo = photos.store_photo(encoded_image())
            atlas.write_visits([])
            change = {'id': photo['id'], 'action': 'update', 'title': 'Photo', 'taken': '', 'description': 'Caption'}
            photos.update_gallery({**change, 'tags': [' USA ', 'usa', '  New   York ', 'Polska']}, [])
            info = photos.gallery([])['photos'][0]
            self.assertEqual(info['manualTags'], ['USA', 'New York', 'Polska'])
            self.assertEqual([tag['id'] for tag in info['tags']], ['manual:usa', 'manual:new york', 'manual:polska'])
            self.assertTrue(all(tag['kind'] == 'manual' for tag in info['tags']))
            photos.update_gallery(change, [])  # Older clients must not erase tags.
            self.assertEqual(photos.gallery([])['photos'][0]['manualTags'], info['manualTags'])
            photos.update_gallery({**change, 'tags': ['USA']}, [])
            self.assertEqual(photos.gallery([])['photos'][0]['manualTags'], ['USA'])
            photos.update_gallery({**change, 'tags': []}, [])
            self.assertEqual(photos.gallery([])['photos'][0]['manualTags'], [])
            before = photos.photo_path(photo['id']).read_bytes()
            for invalid in (None, [''], ['x' * 61], ['bad\x00tag'], [1], ['tag'] * 51):
                with self.assertRaises(ValueError): photos.update_gallery({**change, 'tags': invalid}, [])
                self.assertEqual(photos.photo_path(photo['id']).read_bytes(), before)
            photos.update_gallery({**change, 'tags': ['USA', '海']}, [])
            output = io.BytesIO(); photos.archive_photos([], output)
            with zipfile.ZipFile(output) as archive:
                rows = list(csv.DictReader(io.StringIO(archive.read('photos/opisy.csv').decode('utf-8-sig'))))
                self.assertEqual(json.loads(rows[0]['tags']), ['USA', '海'])
            photos.update_gallery({'id': photo['id'], 'action': 'delete'}, [])
            photos.update_gallery({'id': photo['id'], 'action': 'restore'}, [])
            self.assertEqual(photos.gallery([])['photos'][0]['manualTags'], ['USA', '海'])

    def test_live_tag_update_preserves_caption_progress_and_embedded_properties(self):
        with patch.object(atlas, 'CSV', self.root / 'visits.csv'):
            _, rows = fixture()
            photo = photos.store_photo(encoded_image())
            rows[-1]['zdjecia'] = photos.encoded_refs([{'id': photo['id'], 'caption': 'Keep this caption'}])
            atlas.write_visits(rows)
            before_csv, before_image = atlas.CSV.read_bytes(), photos.photo_path(photo['id']).read_bytes()
            photos.update_gallery({'id': photo['id'], 'action': 'tags', 'tags': ['USA']}, rows)
            info = photos.gallery(rows)['photos'][0]
            self.assertEqual(info['manualTags'], ['USA'])
            self.assertEqual(info['description'], 'Keep this caption')
            self.assertTrue(any(tag['kind'] == 'trip' for tag in info['tags']))
            self.assertEqual(atlas.CSV.read_bytes(), before_csv)
            self.assertEqual(photos.photo_path(photo['id']).read_bytes(), before_image)
            photos.update_gallery({'id': photo['id'], 'action': 'tags', 'tags': []}, rows)
            self.assertEqual(photos.gallery(rows)['photos'][0]['manualTags'], [])

    def test_gallery_metadata_usage_delete_and_restore(self):
        with patch.object(atlas, 'CSV', self.root / 'visits.csv'):
            _, rows = fixture()
            photo = photos.store_photo(encoded_image())
            unused = photos.store_photo(encoded_image(color='gold'))
            refs = [{'id': photo['id'], 'caption': 'Original caption'}]
            rows[2]['zdjecia'] = photos.encoded_refs(refs)
            rows[-1]['zdjecia'] = photos.encoded_refs(refs, True)
            atlas.write_visits(rows)
            gallery = photos.gallery(rows)
            self.assertEqual(len(gallery['photos']), 2)
            self.assertEqual(len(next(p for p in gallery['photos'] if p['id'] == photo['id'])['uses']), 2)
            photos.update_gallery({'id': photo['id'], 'action': 'update', 'title': '=Family trip',
                                   'taken': '2020-06-12', 'description': '+New description'}, rows)
            saved = atlas.read_visits()
            self.assertEqual(photos.photo_refs(saved[2]['zdjecia'])[0]['caption'], '+New description')
            info = next(p for p in photos.gallery(saved)['photos'] if p['id'] == photo['id'])
            self.assertEqual((info['title'], info['taken'], info['description']), ('=Family trip', '2020-06-12', '+New description'))
            self.assertIn("'+New description", (photos.photo_dir() / 'opisy.csv').read_text(encoding='utf-8-sig'))
            photos.update_gallery({'id': photo['id'], 'action': 'delete'}, saved)
            self.assertFalse(photos.photo_path(photo['id']).exists())
            self.assertTrue(all(not row.get('zdjecia') for row in atlas.read_visits()))
            self.assertEqual(photos.gallery(atlas.read_visits())['deleted'], photo['id'])
            self.assertEqual([p['id'] for p in photos.gallery([])['photos']], [unused['id']])
            photos.update_gallery({'id': photo['id'], 'action': 'restore'}, atlas.read_visits())
            restored = atlas.read_visits()
            self.assertEqual(photos.photo_refs(restored[2]['zdjecia']), photos.photo_refs(saved[2]['zdjecia']))
            self.assertEqual(photos.photo_refs(restored[-1]['zdjecia']), photos.photo_refs(saved[-1]['zdjecia']))
            self.assertIsNone(photos.gallery(restored)['deleted'])
            output = io.BytesIO(); photos.archive_photos(restored, output)
            with zipfile.ZipFile(output) as archive:
                self.assertIn('photos/opisy.csv', archive.namelist())

    def test_embedded_properties_import_edit_and_read_only_size(self):
        with patch.object(atlas, 'CSV', self.root / 'visits.csv'):
            source = io.BytesIO()
            Image.new('RGB', (200, 100), 'navy').save(source, 'JPEG', exif=properties_exif('Łódź 東京', '2001-03-02', '12:34:56').tobytes())
            original = photos.store_photo(base64.b64encode(source.getvalue()).decode(), 'filename.jpg')
            path = photos.photo_path(original['id'])
            before = path.read_bytes()
            info = photos.gallery([])['photos'][0]
            self.assertEqual((info['title'], info['taken']), ('Łódź 東京', '2001-03-02'))
            self.assertEqual((info['width'], info['height'], info['bytes']), (200, 100, len(before)))
            atlas.write_visits([])
            change = {'id': original['id'], 'action': 'update', 'title': 'Gdańsk', 'taken': '2026-06-12', 'description': 'Edited'}
            photos.update_gallery(change, [])
            after = path.read_bytes()
            self.assertEqual(before[before.index(b'\xff\xda'):], after[after.index(b'\xff\xda'):])
            with Image.open(path) as image:
                properties = read_properties(image)
                self.assertEqual(image.size, (200, 100))
                self.assertEqual((properties['title'], properties['taken'], properties['time']), ('Gdańsk', '2026-06-12', '12:34:56'))
            # Read the actual file properties again, including external edits.
            write_photo_atomic(path, update_jpeg_properties(after, 'Changed outside the app', '2025-01-02'))
            info = photos.gallery([])['photos'][0]
            self.assertEqual((info['title'], info['taken']), ('Changed outside the app', '2025-01-02'))
            for update in ({'width': 100, 'height': 50}, {'bytes': 123}, {'taken': '2026-02-30'}, {'id': '../bad'}):
                with self.assertRaises(ValueError): photos.update_gallery({**change, **update}, [])
            photos.update_gallery({**change, 'title': '', 'taken': ''}, [])
            with Image.open(path) as image:
                self.assertEqual((read_properties(image)['title'], read_properties(image)['taken']), ('', ''))

    def test_filename_fallback_and_existing_gallery_properties_migrate_into_file(self):
        source = io.BytesIO(); Image.new('RGB', (200, 100), 'red').save(source, 'PNG')
        photo = photos.store_photo(base64.b64encode(source.getvalue()).decode(), 'Holiday.jpg')
        with Image.open(photos.photo_path(photo['id'])) as image:
            self.assertEqual(read_properties(image)['title'], 'Holiday')
        self.assertEqual(photos.gallery([])['photos'][0]['taken'], '')
        # Previous versions stored these values only in a CSV.
        path = photos.photo_path(photo['id'])
        write_photo_atomic(path, update_jpeg_properties(path.read_bytes(), '', ''))
        photos.write_metadata({photo['id']: {'id': photo['id'], 'title': 'Legacy title', 'taken': '2020-07-08', 'description': 'Legacy caption'}})
        info = photos.gallery([])['photos'][0]
        self.assertEqual((info['title'], info['taken']), ('Legacy title', '2020-07-08'))
        with Image.open(path) as image:
            self.assertEqual((read_properties(image)['title'], read_properties(image)['taken']), ('Legacy title', '2020-07-08'))
        output = io.BytesIO(); photos.archive_photos([], output)
        with zipfile.ZipFile(output) as archive:
            with Image.open(io.BytesIO(archive.read('photos/' + photo['id'] + '.jpg'))) as image:
                self.assertEqual(read_properties(image)['title'], 'Legacy title')

    def test_csv_backup_round_trip_and_legacy_header(self):
        server, rows = fixture()
        rows = [row for row in rows if row['kategoria'] != 'latarnia']
        server.places = {(row['kategoria'], row['id']): row for row in rows if row['kategoria'] == 'panstwo'}
        refs = [{'id': 'a' * 64, 'caption': 'Family photo'}]
        rows[2]['zdjecia'] = photos.encoded_refs(refs)
        rows[-1]['zdjecia'] = photos.encoded_refs(refs + [{'id': 'b' * 64, 'caption': 'Sunset'}], True)
        for format in ('csv', 'json'):
            data = atlas.export_progress(rows, format, server)[0]
            restored = atlas.import_progress(data.decode('utf-8-sig'), format, server)
            self.assertEqual(photos.photo_refs(restored[2]['zdjecia']), refs)
            self.assertEqual(len(photos.photo_refs(restored[-1]['zdjecia'])), 2)
        legacy = io.StringIO(newline='')
        writer = csv.DictWriter(legacy, [field for field in atlas.FIELDS if field != 'zdjecia'], extrasaction='ignore')
        writer.writeheader(); writer.writerows(rows)
        self.assertTrue(all(not row['zdjecia'] for row in atlas.import_progress(legacy.getvalue(), 'csv', server)))

    def test_archive_and_journal_embed_place_and_trip_photos(self):
        from docx import Document
        from pypdf import PdfReader
        server, rows = fixture()
        one = photos.store_photo(encoded_image(color='teal'))
        two = photos.store_photo(encoded_image(color='gold'))
        rows[2]['zdjecia'] = photos.encoded_refs([{'id': one['id'], 'caption': ''}])
        rows[-1]['zdjecia'] = photos.encoded_refs([{'id': two['id'], 'caption': 'Family sunset'}], True)
        output = io.BytesIO(); photos.archive_photos(rows, output)
        with zipfile.ZipFile(output) as archive:
            self.assertIsNone(archive.testzip())
            self.assertIn('photos/' + one['id'] + '.jpg', archive.namelist())
            self.assertIn('Family sunset', archive.read('photos.csv').decode('utf-8-sig'))
        model = atlas.journal_model(rows, server)
        trip = model['years'][0][1][0]
        self.assertEqual(trip['photos'][0]['id'], two['id'])
        self.assertEqual(trip['members'][1]['photos'][0]['id'], one['id'])
        for format in ('pdf', 'docx'):
            data = build_journal(model, atlas.country_shapes(), format)
            if format == 'docx':
                document = Document(io.BytesIO(data))
                self.assertGreaterEqual(len(document.inline_shapes), 4)
                text = '\n'.join(p.text for p in document.paragraphs)
            else:
                reader = PdfReader(io.BytesIO(data))
                self.assertGreaterEqual(sum(len(page.images) for page in reader.pages), 4)
                text = '\n'.join(page.extract_text() for page in reader.pages)
            self.assertIn('Family sunset', text)

    def test_upload_read_archive_endpoints_and_origin_protection(self):
        with patch.object(atlas, 'CSV', self.root / 'visits.csv'):
            atlas.write_visits([])
            server = atlas.AtlasServer(('127.0.0.1', 0), atlas.App)
            worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
            try:
                origin = 'http://127.0.0.1:' + str(server.server_port)
                payload = json.dumps({'data': encoded_image()}).encode()
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(origin + '/api/zdjecia', payload))
                self.assertEqual(error.exception.code, 403)
                with urlopen(Request(origin + '/api/zdjecia', payload, {'Origin': origin, 'Content-Type': 'application/json'})) as response:
                    photo = json.load(response)
                with urlopen(origin + '/photos/' + photo['id'] + '.jpg') as response:
                    self.assertEqual(response.headers.get_content_type(), 'image/jpeg')
                    self.assertLessEqual(len(response.read()), 300 * 1024)
                gallery_change = {'id': photo['id'], 'action': 'update', 'title': 'Family photo', 'taken': '2026-11-25', 'description': 'A memory'}
                with urlopen(Request(origin + '/api/galeria', json.dumps(gallery_change).encode(), {'Origin': origin, 'Content-Type': 'application/json'})) as response:
                    self.assertEqual(json.load(response)['photos'][0]['title'], 'Family photo')
                with urlopen(origin + '/api/galeria') as response:
                    self.assertEqual(json.load(response)['photos'][0]['description'], 'A memory')
                with urlopen(origin + '/api/eksport-zdjec') as response:
                    with zipfile.ZipFile(io.BytesIO(response.read())) as archive:
                        self.assertIn('photos/' + photo['id'] + '.jpg', archive.namelist())
            finally:
                server.shutdown(); server.server_close(); worker.join()
