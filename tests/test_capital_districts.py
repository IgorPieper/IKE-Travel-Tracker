import unittest
from unittest.mock import patch

from src.capital_districts import capital_districts, district_features, relation_geometry
from src.focus_map import focus_area


class CapitalDistrictTests(unittest.TestCase):
    def test_small_capitals_do_not_absorb_the_surrounding_urban_agglomeration(self):
        import gzip
        import json
        import math
        from shapely.geometry import shape, Point
        from src import atlas
        features = json.loads(gzip.decompress(atlas.static_bytes('stolice.json.gz')))['features']
        for country, maximum_km2 in [('MC',5),('LU',60),('CH',60),('LB',30),('DK',120)]:
            with self.subTest(country=country):
                capital = next(f for f in features if f['properties']['country'] == country)
                props = capital['properties'];outline = shape(capital['geometry'])
                self.assertTrue(outline.is_valid)
                self.assertTrue(outline.covers(Point(props['lon'],props['lat'])))
                self.assertLess(outline.area*12320*math.cos(math.radians(outline.centroid.y)),maximum_km2)
                self.assertEqual(props['boundary_kind'],'municipality')

    def test_lisbon_and_algiers_use_administrative_outlines_and_matching_districts(self):
        import gzip
        import json
        from shapely.geometry import shape, Point
        from src import atlas
        features = json.loads(gzip.decompress(atlas.static_bytes('stolice.json.gz')))['features']
        for country, count, outside in [('PT',24,(-9.38,38.80)),('DZ',57,(3.48,36.75))]:
            with self.subTest(country=country):
                capital = next(f for f in features if f['properties']['country'] == country)
                self.assertNotEqual(capital['properties']['boundary_kind'],'urban-area')
                outline = shape(capital['geometry'])
                self.assertTrue(outline.is_valid)
                self.assertFalse(outline.covers(Point(*outside)))
                districts = capital_districts(capital['properties']['legacy_id'],False)['features']
                self.assertEqual(len(districts),count)
                for district in districts:
                    self.assertLess(shape(district['geometry']).difference(outline).area,1e-9)
                if country == 'PT':
                    self.assertIn('Parque das Nações',{f['properties']['name'] for f in districts})
                    self.assertLess(outline.area,.015)

    def test_dhaka_and_hanoi_never_expand_to_regional_urban_clusters(self):
        from src.focus_map import bounds
        for identifier, count, excluded in [('1159151467',41,{'Sylhet','Pabna','Chandpur'}),
                                             ('1159151251',30,{'Thanh Hoa','Sam Son','Ninh Bình'})]:
            with self.subTest(id=identifier):
                area = focus_area('miasto',identifier)
                west,south,east,north = area['bounds']
                self.assertLess(east-west,1)
                self.assertLess(north-south,1)
                districts = capital_districts(identifier,False)['features']
                self.assertEqual(len(districts),count)
                self.assertFalse(excluded & {f['properties']['name'] for f in districts})
                for feature in districts:
                    a,b,c,d = bounds(feature['geometry'])
                    self.assertGreaterEqual(a,west-1e-7)
                    self.assertGreaterEqual(b,south-1e-7)
                    self.assertLessEqual(c,east+1e-7)
                    self.assertLessEqual(d,north+1e-7)

    def test_every_capital_marker_resolves_to_an_offline_outline(self):
        import gzip
        import json
        from src import atlas
        markers = [r for r in json.loads(atlas.static_bytes('mapa.json'))['miasto'] if r[8]]
        features = json.loads(gzip.decompress(atlas.static_bytes('stolice.json.gz')))['features']
        by_legacy = {f['properties']['legacy_id']:f for f in features}
        self.assertEqual(len(markers), 202)
        self.assertEqual(len(features), 202)
        self.assertEqual({r[0] for r in markers}, set(by_legacy))
        for row in markers:
            with self.subTest(capital=row[1]):
                area = focus_area('miasto',row[0])
                self.assertTrue(area['is_capital'])
                self.assertTrue(area['feature']['geometry']['coordinates'])
                self.assertEqual(area['country'],row[5])

    def test_african_capitals_have_bundled_subdivisions(self):
        expected = {'1159150799':12, '1159151549':10, '1159151513':4,
                    '1159150593':5, '1159150571':38, '1159150907':58}
        with patch('src.capital_districts.urlopen', side_effect=AssertionError('Network used')):
            for identifier, count in expected.items():
                with self.subTest(id=identifier):
                    features = capital_districts(identifier,False)['features']
                    self.assertEqual(len(features),count)
                    self.assertTrue(all(f['properties']['name'] for f in features))

    def test_warsaw_has_all_18_districts_without_network(self):
        self.assertTrue(focus_area('miasto', 'prg:146501_1')['is_capital'])
        with patch('src.capital_districts.urlopen', side_effect=AssertionError('Network used')):
            data = capital_districts('prg:146501_1', False)
        names = {f['properties']['name'] for f in data['features']}
        self.assertEqual(len(names), 18)
        self.assertTrue({'Mokotów', 'Wola', 'Żoliborz', 'Śródmieście'} <= names)
        self.assertNotIn('Warszawa', names)

    def test_reversed_member_ways_form_a_closed_district(self):
        def member(points):
            return {'type':'way','role':'outer','geometry':[{'lon':x,'lat':y} for x,y in points]}
        relation={'members':[member([(0,0),(1,0),(1,1)]),member([(0,0),(0,1),(1,1)])]}
        geometry=relation_geometry(relation)
        self.assertEqual(len(geometry['coordinates']), 1)
        ring=geometry['coordinates'][0][0]
        self.assertEqual(ring[0], ring[-1])
        self.assertEqual(len(ring), 5)
        self.assertFalse(relation_geometry({'members':[relation['members'][0]]})['coordinates'])

    def test_selects_district_tier_and_excludes_enclosing_and_foreign_units(self):
        def relation(id, level, a,b,c,d):
            return {'type':'relation','id':id,'tags':{'name':str(id),'admin_level':str(level)},
                    'members':[{'type':'way','role':'outer','geometry':[{'lon':x,'lat':y} for x,y in
                        [(a,b),(c,b),(c,d),(a,d),(a,b)]]}]}
        area={'bounds':[0,0,10,10], 'feature':{'geometry':{'type':'Polygon','coordinates':[[[0,0],[10,0],[10,10],[0,10],[0,0]]]}}}
        data=district_features([relation(1,6,0,0,10,10),relation(2,9,1,1,4,4),
                                relation(3,10,1,1,2,2),relation(4,8,12,12,14,14)], area)
        self.assertEqual([f['properties']['id'] for f in data['features']], ['osm:r2'])


if __name__ == '__main__':
    unittest.main()
