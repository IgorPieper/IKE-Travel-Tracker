import unittest

from src.focus_map import focus_area, search_area, contains, bounds


class FocusMapTests(unittest.TestCase):
    def test_country_region_locality_and_continent_boundaries(self):
        cases = [('panstwo', '1159321179', (21.01,52.23)),
                 ('rejon','ne:POL-3140',(18.65,54.35)),
                 ('miasto','prg:226101_1',(18.65,54.35)),
                 ('kontynent','europe',(18.65,54.35))]
        for category,id,position in cases:
            with self.subTest(category=category):
                area=focus_area(category,id)
                self.assertTrue(contains(area['feature']['geometry'],*position))
                self.assertLess(area['bounds'][0],area['bounds'][2])
                self.assertEqual(area['bounds'], bounds(area['feature']['geometry']))
                self.assertTrue(area['context']['features'])
        region=focus_area('rejon','ne:POL-3140')
        self.assertFalse(contains(region['feature']['geometry'],21.01,52.23))

    def test_country_context_has_only_simple_country_outlines(self):
        area = focus_area('panstwo', '1159321179')
        for feature in area['context']['features']:
            self.assertEqual(set(feature['properties']), {'country_id'})
            self.assertNotEqual(feature['properties']['country_id'], area['id'])
            self.assertTrue(all(len(rings) == 1 for rings in feature['geometry']['coordinates']))

    def test_locality_focus_keeps_nearby_towns_and_villages(self):
        area = focus_area('miasto','prg:226101_1')
        neighbours = [feature for feature in area['context']['features'] if feature['properties'].get('kind') == 'locality']
        self.assertTrue(neighbours)
        self.assertIn('Sopot',[feature['properties']['name'] for feature in neighbours])
        self.assertTrue(any(feature['properties']['id'].startswith('simc:') for feature in neighbours))
        self.assertFalse(any(feature['properties']['id'] == area['id'] for feature in neighbours))
        self.assertEqual(area['bounds'],bounds(area['feature']['geometry']))

    def test_africa_camera_frames_mainland_without_remote_islands(self):
        area = focus_area('kontynent', 'africa')
        west, south, east, north = area['camera_bounds']
        self.assertGreater(west, -20)
        self.assertGreater(south, -36)
        self.assertLess(east, 55)
        self.assertLess(north, 39)
        self.assertEqual(area['bounds'], bounds(area['feature']['geometry']))

    def test_local_search_respects_boundary_including_coastal_cities(self):
        results=search_area('rejon','ne:POL-3140','gdansk')
        self.assertIn('prg:226101_1',[place['id'] for place in results])
        self.assertEqual(search_area('rejon','ne:POL-3140','Warszawa'),[])
        geometry=focus_area('rejon','ne:POL-3140')['feature']['geometry']
        self.assertTrue(all(contains(geometry,*place['position']) for place in results))

    def test_unknown_area_has_no_invented_boundary(self):
        with self.assertRaises((ValueError,StopIteration)):
            focus_area('miasto','missing')

    def test_villages_are_excluded_from_search_until_enabled(self):
        cities=search_area('rejon','ne:POL-3140','gdansk',False)
        all_places=search_area('rejon','ne:POL-3140','gdansk',True)
        self.assertFalse(any(place['id'].startswith('simc:') for place in cities))
        self.assertTrue(any(place['id'].startswith('simc:') for place in all_places))


if __name__=='__main__':
    unittest.main()
