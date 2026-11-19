"""Progress backups must round-trip and never partially overwrite saved visits."""
import io
import json
import tempfile
import threading
import unittest
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from src import atlas


class ProgressTransferTests(unittest.TestCase):
    def setUp(self):
        country = {"kategoria": "panstwo", "id": "pl", "nazwa": "Polska", "lon": "19", "lat": "52"}
        self.server = SimpleNamespace(places={("panstwo", "pl"): country}, countries={"pl": country})
        self.rows = [
            {**country, "data": "2020-02-29", "ocena": "8.5", "notatka": "=Not a formula\nŁódź, 東京"},
            {"kategoria": "miasto", "id": "osm:123", "nazwa": "Test", "panstwo_id": "pl", "lon": "19", "lat": "52", "tryb": "plan", "data": "2027-06-01"},
            {"kategoria": "pinezka", "id": "11111111-1111-4111-8111-111111111111", "nazwa": "'Pinezka", "lon": "0", "lat": "0", "kolor": "#ff0000", "opis_dlugi": "+Opis", "data": "2025-01-01", "kolejne_wizyty": '[{"id":"22222222-2222-4222-8222-222222222222","data":"2026-01-01"}]'},
            {"kategoria": "wycieczka", "id": "33333333-3333-4333-8333-333333333333", "nazwa": "Wyjazd", "data": "2025-01-01", "data_konca": "2026-01-02", "miejsca": '["panstwo:pl","pinezka:11111111-1111-4111-8111-111111111111:visit:22222222-2222-4222-8222-222222222222"]'},
            {"kategoria": "osiagniecie", "id": "developer_all", "tryb": "unlock"},
        ]
        for category in atlas.CHALLENGE_CATEGORIES:
            id, (name, lon, lat) = next(iter(atlas.challenge_places(category).items()))
            self.rows.append({"kategoria": category, "id": id, "nazwa": name, "lon": lon, "lat": lat})

    def normalized(self, rows):
        return [{field: str(row.get(field, "")) for field in atlas.FIELDS} for row in rows]

    def test_csv_and_json_preserve_all_progress(self):
        for format in ("csv", "json"):
            with self.subTest(format=format):
                data, _, _ = atlas.export_progress(self.rows, format, self.server)
                restored = atlas.import_progress(data.decode("utf-8-sig"), format, self.server)
                self.assertEqual(restored, self.normalized(self.rows))
                with tempfile.TemporaryDirectory() as folder, patch.object(atlas, "CSV", Path(folder) / "progress.csv"):
                    atlas.write_visits(restored)
                    self.assertEqual(atlas.read_visits(), restored)

    def test_invalid_backup_rejected(self):
        valid = json.loads(atlas.export_progress(self.rows, "json", self.server)[0])
        variants = []
        for update in ({"data": "2026-02-30"}, {"ocena": "11"}, {"lon": "nan", "lat": "0"}, {"kategoria": "bad"}, {"kolejne_wizyty": "{}"}):
            variant = json.loads(json.dumps(valid))
            variant["progress"][0].update(update)
            variants.append(variant)
        duplicate = json.loads(json.dumps(valid))
        duplicate["progress"].append(duplicate["progress"][0])
        variants.extend((duplicate, {**valid, "version": 999}, {**valid, "progress": None}))
        invalid_trip = json.loads(json.dumps(valid))
        invalid_trip["progress"][3]["miejsca"] = '["panstwo:missing"]'
        variants.append(invalid_trip)
        for variant in variants:
            with self.assertRaises((ValueError, TypeError)):
                atlas.import_progress(json.dumps(variant), "json", self.server)
        for text in ("", "nazwa,id\na,b", "kategoria,kategoria\na,b"):
            with self.assertRaises(ValueError):
                atlas.import_progress(text, "csv", self.server)

    def test_kml_is_geographic_and_preserves_names_and_plans(self):
        data, _, extension = atlas.export_progress(self.rows, "kml", self.server)
        self.assertEqual(extension, "kml")
        ns = {"k": "http://www.opengis.net/kml/2.2"}
        root = ET.fromstring(data)
        places = root.findall(".//k:Placemark", ns)
        planned = next(place for place in places if place.findtext("k:name", namespaces=ns) == "Test")
        self.assertEqual(planned.findtext("k:styleUrl", namespaces=ns), "#planned")
        self.assertEqual(planned.findtext("k:Point/k:coordinates", namespaces=ns), "19.000000,52.000000,0")
        self.assertTrue(any(place.findtext("k:name", namespaces=ns) == "'Pinezka" for place in places))

    def test_large_kml_is_split_without_losing_places(self):
        rows = [{"kategoria": "pinezka", "id": str(index), "nazwa": f"Place {index}", "lon": "0", "lat": "0"} for index in range(2001)]
        data, _, extension = atlas.export_progress(rows, "kml", self.server)
        self.assertEqual(extension, "zip")
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            counts = [len(ET.fromstring(archive.read(name)).findall(".//{http://www.opengis.net/kml/2.2}Placemark")) for name in archive.namelist()]
        self.assertEqual(counts, [2000, 1])

    def test_http_preview_replacement_and_invalid_import_are_atomic(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(atlas, "CSV", Path(folder) / "progress.csv"):
            atlas.write_visits([self.rows[0]])
            original = atlas.CSV.read_bytes()
            with atlas.AtlasServer(("127.0.0.1", 0), atlas.App) as server:
                server.places, server.countries = self.server.places, self.server.countries
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                address = f"http://127.0.0.1:{server.server_port}"
                def post(content, confirm):
                    data = json.dumps({"format": "json", "content": content, "potwierdzam": confirm}).encode()
                    request = Request(address + "/api/import-postepu", data=data, headers={"Origin": address, "Content-Type": "application/json"})
                    with urlopen(request) as response:
                        return json.load(response)
                try:
                    content = atlas.export_progress(self.rows, "json", server)[0].decode()
                    self.assertFalse(post(content, False)["imported"])
                    self.assertEqual(atlas.CSV.read_bytes(), original)
                    with self.assertRaises(HTTPError) as error:
                        post('{"bad":true}', True)
                    self.assertEqual(error.exception.code, 400)
                    self.assertEqual(atlas.CSV.read_bytes(), original)
                    self.assertTrue(post(content, True)["imported"])
                    self.assertEqual(atlas.read_visits(), self.normalized(self.rows))
                    empty = json.dumps({"application": "travel-tracker", "version": 1, "progress": []})
                    post(empty, True)
                    self.assertEqual(atlas.read_visits(), [])
                finally:
                    server.shutdown()
                    thread.join()


if __name__ == "__main__":
    unittest.main()
