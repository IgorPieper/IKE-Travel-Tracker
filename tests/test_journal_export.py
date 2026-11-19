import io
import json
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import urlopen

from src import atlas
from src.journal_export import build_journal


def fixture():
    codes = {item[5]: item[0] for item in json.loads(atlas.static_bytes("mapa.json"))["panstwo"] if item[5]}
    countries = {id: {"id": id, "nazwa": code} for code, id in codes.items()}
    server = SimpleNamespace(country_codes=codes, countries=countries, places={}, city_codes={})
    repeat = "22222222-2222-4222-8222-222222222222"
    pin = "11111111-1111-4111-8111-111111111111"
    trip = "33333333-3333-4333-8333-333333333333"
    rows = [
        {"kategoria": "panstwo", "id": codes["PL"], "nazwa": "Polska", "tryb": "auto"},
        {"kategoria": "panstwo", "id": codes["JP"], "nazwa": "Japonia", "tryb": "auto"},
        {"kategoria": "miasto", "id": "osm:1", "nazwa": "Warszawa", "panstwo_id": codes["PL"], "data": "2026-08-04", "ocena": "9.5",
         "notatka": "Poranny spacer nad Wisłą, potem kawa na Starym Mieście.\nNajlepsze wspomnienie: wspólny obiad i długi wieczór bez pośpiechu.", "kolejne_wizyty": json.dumps([{"id": repeat, "data": "2024-05-11"}])},
        {"kategoria": "miasto", "id": "osm:2", "nazwa": "いなべ市", "panstwo_id": codes["JP"], "data": "2026-08-07", "ocena": "10",
         "notatka": "Ogrody o poranku i ciche uliczki po zachodzie słońca. W notesie zostały bilety z przejazdów i adres małej herbaciarni."},
        {"kategoria": "pinezka", "id": pin, "nazwa": "Nasza ulubiona plaża", "lon": "18.6", "lat": "54.5", "kolor": "#ff0000", "opis_dlugi": "Piasek w butach, wiatr i ostatnia kanapka z plecaka. Tu na pewno wrócimy."},
        {"kategoria": "miasto", "id": "osm:3", "nazwa": "Planned place must not appear", "tryb": "plan", "panstwo_id": codes["FR"], "data": "2027-07-07"},
        {"kategoria": "latarnia", "id": "Q1", "nazwa": "Challenge must not appear"},
        {"kategoria": "wycieczka", "id": trip, "nazwa": "Lato pełne wspomnień", "data": "2026-08-01", "data_konca": "2026-08-12",
         "notatka": "Dwanaście dni, dwa zupełnie różne miejsca i mnóstwo rozmów w drodze.\nTen wyjazd zapamiętamy przede wszystkim dzięki chwilom spędzonym razem.",
         "miejsca": json.dumps(["miasto:osm:1", "miasto:osm:2"])},
    ]
    return server, rows


class JournalExportTests(unittest.TestCase):
    def test_diary_order_trips_and_repeat_visits(self):
        server, rows = fixture()
        before = json.dumps(rows)
        model = atlas.journal_model(rows, server, "pl", "Rodzinne podróże")
        self.assertEqual([year for year, _ in model["years"]], ["2026", "2024", ""])
        trip = model["years"][0][1][0]
        self.assertEqual(trip["kind"], "trip")
        self.assertEqual([member["title"] for member in trip["members"]], ["いなべ市", "Warszawa"])
        self.assertTrue(trip["members"][0]["reading"])
        self.assertEqual(model["years"][1][1][0]["date"], "2024-05-11")
        self.assertEqual(model["years"][1][1][0]["note"], "")
        self.assertEqual((model["visits"], model["trips"], model["countries"]), (4, 1, 2))
        self.assertEqual(json.dumps(rows), before)

    def test_pdf_and_word_contain_full_journal(self):
        from pypdf import PdfReader
        from docx import Document
        server, rows = fixture()
        model = atlas.journal_model(rows, server, "pl", "Rodzinne podróże")
        for format in ("pdf", "docx"):
            data = build_journal(model, atlas.country_shapes(), format)
            if format == "pdf":
                reader = PdfReader(io.BytesIO(data))
                self.assertGreaterEqual(len(reader.pages), 2)
                text = "\n".join(page.extract_text() for page in reader.pages)
                self.assertIn("いなべ市", text)
            else:
                document = Document(io.BytesIO(data))
                text = "\n".join(paragraph.text for paragraph in document.paragraphs)
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    self.assertTrue(any(name.startswith("word/media/") for name in archive.namelist()))
            self.assertIn("Rodzinne podróże", text)
            self.assertIn("Lato pełne wspomnień", text)
            self.assertIn("Najlepsze wspomnienie", text)
            self.assertIn("Piasek w butach", text)
            self.assertNotIn("Planned place must not appear", text)
            self.assertNotIn("Challenge must not appear", text)
            self.assertLess(text.index("Lato pełne wspomnień"), text.index("Nasza ulubiona plaża"))

    def test_empty_journal_and_long_notes_can_be_exported(self):
        server, rows = fixture()
        for format in ("pdf", "docx"):
            model = atlas.journal_model([], server, "en")
            self.assertTrue(build_journal(model, atlas.country_shapes(), format))
            rows[2]["notatka"] = "A < B & C\n" + "wspomnienie " * 166 + "\n" + "A" * 180
            model = atlas.journal_model(rows, server, "en", "A long family journal title " * 3)
            self.assertTrue(build_journal(model, atlas.country_shapes(), format))

    def test_download_endpoint_does_not_mutate_progress_or_settings(self):
        server_data, rows = fixture()
        with tempfile.TemporaryDirectory() as folder, patch.object(atlas, "CSV", Path(folder)/"visits.csv"), patch.object(atlas, "SETTINGS", Path(folder)/"settings.csv"):
            atlas.write_visits(rows)
            atlas.write_settings(*atlas.read_settings())
            original, settings = atlas.CSV.read_bytes(), atlas.SETTINGS.read_bytes()
            with atlas.AtlasServer(("127.0.0.1", 0), atlas.App) as server:
                for key, value in vars(server_data).items():
                    setattr(server, key, value)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    base = f"http://127.0.0.1:{server.server_port}/api/eksport-dziennika"
                    for format in ("pdf", "docx"):
                        with urlopen(base+"?format="+format+"&language=pl") as response:
                            self.assertEqual(response.status, 200)
                            self.assertIn("attachment", response.headers["Content-Disposition"])
                            self.assertTrue(response.read().startswith(b"%PDF" if format == "pdf" else b"PK"))
                    with self.assertRaises(HTTPError) as error:
                        urlopen(base+"?format=exe")
                    self.assertEqual(error.exception.code, 400)
                    self.assertEqual(atlas.CSV.read_bytes(), original)
                    self.assertEqual(atlas.SETTINGS.read_bytes(), settings)
                finally:
                    server.shutdown()
                    thread.join()


if __name__ == "__main__":
    unittest.main()
