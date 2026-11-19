import json
import random
import tempfile
import threading
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen

from src import atlas


class DeveloperFillTests(unittest.TestCase):
    def setUp(self):
        self.candidates = [{"kategoria": "panstwo", "id": str(index), "nazwa": f"Country {index}"} for index in range(10)]
        self.today = date(2026, 11, 19)

    def fill(self, rows, percentage, status):
        return atlas.fill_map_progress(rows, self.candidates, percentage, status,
                                       today=self.today, rng=random.Random(3))

    def test_visited_countries_do_not_satisfy_planned_target(self):
        existing = [{**place, "data": "2000-01-01", "ocena": "9.5", "notatka": "Keep this"} for place in self.candidates[:5]]
        updated, result = self.fill(existing, 50, "planned")
        self.assertEqual((result["added"], result["filled"], result["remaining"]), (5, 5, 0))
        self.assertEqual(updated[:5], existing)
        self.assertEqual(len({row["id"] for row in updated}), 10)
        for row in updated[5:]:
            self.assertEqual(row["tryb"], "plan")
            self.assertLessEqual(self.today, date.fromisoformat(row["data"]))
            self.assertLessEqual(date.fromisoformat(row["data"]), self.today.replace(year=2106))
        self.assertEqual(self.fill(updated, 50, "planned")[1]["added"], 0)

    def test_planned_countries_do_not_satisfy_visited_target(self):
        existing = [{**place, "tryb": "plan", "data": "2030-01-01"} for place in self.candidates[:5]]
        updated, result = self.fill(existing, 50, "visited")
        self.assertEqual((result["added"], result["filled"]), (5, 5))
        self.assertEqual(updated[:5], existing)
        for row in updated[5:]:
            self.assertEqual(row["tryb"], "")
            self.assertLessEqual(date.fromisoformat(row["data"]), self.today)
            self.assertGreaterEqual(date.fromisoformat(row["data"]), self.today.replace(year=1946))

    def test_existing_plans_count_and_other_status_is_never_replaced(self):
        rows = [self.candidates[0], {**self.candidates[1], "tryb": "auto"},
                {**self.candidates[2], "tryb": "plan"}, {**self.candidates[3], "tryb": "plan"}]
        updated, result = self.fill(rows, 50, "planned")
        self.assertEqual((result["added"], result["filled"], result["remaining"]), (3, 5, 3))
        self.assertEqual(updated[:4], rows)
        capped, result = self.fill(rows, 100, "planned")
        self.assertEqual((result["added"], result["filled"], result["remaining"]), (6, 8, 0))
        self.assertEqual(capped[:4], rows)

    def test_suppressed_places_are_empty_and_unrelated_presets_do_not_count(self):
        rows = [{**self.candidates[0], "tryb": atlas.SKIP_LINKED},
                {"kategoria": "miasto", "id": "0", "nazwa": "Unrelated", "tryb": "plan"}]
        updated, result = self.fill(rows, 100, "planned")
        self.assertEqual((result["filled"], result["added"]), (10, 10))
        self.assertEqual(len(updated), 11)
        self.assertFalse(any(row.get("tryb") == atlas.SKIP_LINKED for row in updated))

    def test_endpoint_writes_plans_without_overwriting_visits(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(atlas, "CSV", Path(folder)/"progress.csv"), patch.object(atlas, "SETTINGS", Path(folder)/"settings.csv"):
            existing = [{**place, "data": "2020-01-01"} for place in self.candidates[:5]]
            atlas.write_visits(existing)
            ranges, visibility, layout = atlas.read_settings()
            layout["developer_panel"] = "on"
            atlas.write_settings(ranges, visibility, layout)
            with atlas.AtlasServer(("127.0.0.1", 0), atlas.App) as server:
                server.places = {(place["kategoria"], place["id"]): place for place in self.candidates}
                server.continents_by_country, server.continent_territories = {}, {}
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                address = f"http://127.0.0.1:{server.server_port}"
                try:
                    data = json.dumps({"preset": "countries", "percentage": 50, "status": "planned"}).encode()
                    request = Request(address+"/api/developer/fill-map", data=data,
                                      headers={"Origin": address, "Content-Type": "application/json"})
                    with urlopen(request) as response:
                        self.assertEqual(json.load(response)["added"], 5)
                    saved = atlas.read_visits()
                    self.assertEqual(sum(row["tryb"] == "plan" for row in saved), 5)
                    self.assertEqual(sum(row["tryb"] != "plan" for row in saved), 5)
                    self.assertEqual([row["data"] for row in saved[:5]], ["2020-01-01"] * 5)
                finally:
                    server.shutdown()
                    thread.join()


if __name__ == "__main__":
    unittest.main()
