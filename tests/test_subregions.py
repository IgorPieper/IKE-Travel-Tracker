import gzip
import json
import unittest
from collections import Counter
from types import SimpleNamespace
from src import atlas


class SubregionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from src.focus_map import administrative_features
        cls.features = administrative_features()

    def test_poland_has_all_counties_beneath_sixteen_voivodeships(self):
        poland=[f for f in self.features if f['properties']['country']=='PL']
        counts=Counter(f['properties']['level'] for f in poland)
        self.assertEqual(counts,{'region':16,'subregion':380})
        ids={f['properties']['id'] for f in poland if f['properties']['level']=='region'}
        self.assertTrue(all(f['properties']['parent_id'] in ids for f in poland if f['properties']['level']=='subregion'))

    def test_small_local_units_are_subregions_and_large_existing_regions_remain(self):
        for code in ('SI','LV','ME','MK','IE','MD'):
            units=[f for f in self.features if f['properties']['country']==code]
            self.assertTrue(units)
            self.assertEqual({f['properties']['level'] for f in units},{'subregion'})
        for code in ('US','DE','CH','PL','FI'):
            units=[f for f in self.features if f['properties']['country']==code and f['properties']['level']=='region']
            self.assertTrue(units)
        for code,count in (('IT',20),('FR',18),('GB',4)):
            self.assertEqual(sum(f['properties']['country']==code and f['properties']['level']=='region' for f in self.features),count)

    def test_city_links_county_voivodeship_country_and_continent_without_duplicates(self):
        units=[f for f in self.features if f['properties']['country']=='PL']
        places={('kontynent','eu'):{'kategoria':'kontynent','id':'eu','nazwa':'Europa'}}
        for feature in units:
            p=feature['properties'];places['rejon',p['id']]={'kategoria':'rejon','id':p['id'],'nazwa':p['name'],'panstwo_id':'pl'}
        country={'kategoria':'panstwo','id':'pl','nazwa':'Polska'}
        regions,subregions=[],[]
        for feature in units:
            (subregions if feature['properties']['level']=='subregion' else regions).extend(atlas.polygon_bounds(feature['properties']['id'],feature['geometry']))
        server=SimpleNamespace(places=places,countries={'pl':country},country_codes={'PL':'pl'},continents_by_country={'pl':'eu'},
            continent_territories={},region_shapes={'pl':regions},subregion_shapes={'pl':subregions},
            region_parents={f['properties']['id']:f['properties']['parent_id'] for f in units if 'parent_id' in f['properties']})
        row={'kategoria':'miasto','id':'test','nazwa':'Warszawa','panstwo_id':'pl','lon':21.0122,'lat':52.2297}
        result=atlas.add_linked_visits([row],server)
        regional=[r for r in result if r['kategoria']=='rejon']
        self.assertEqual(len(regional),2)
        self.assertTrue(any('Warszawa' in r['nazwa'] for r in regional))
        self.assertEqual(len(result),len({(r['kategoria'],r['id']) for r in result}))
        self.assertEqual(atlas.add_linked_visits(result,server),result)
        # Reclassifying an already saved unit retains its original ID and note.
        existing={**regional[0],'tryb':'','notatka':'Keep me'}
        result=atlas.add_linked_visits([row,existing],server)
        self.assertEqual(next(r for r in result if r['id']==existing['id'])['notatka'],'Keep me')

    def test_developer_fill_separates_the_two_admin_tiers(self):
        server=SimpleNamespace(places={('rejon','r'):{'id':'r'},('rejon','s'):{'id':'s'}},subregion_ids={'s'})
        self.assertEqual([r['id'] for r in atlas.developer_candidates(server,'regions')],['r'])
        self.assertEqual([r['id'] for r in atlas.developer_candidates(server,'subregions')],['s'])

    def test_global_subregions_include_the_requested_countries(self):
        counts=Counter(f['properties']['country'] for f in self.features if f['properties']['level']=='subregion')
        for code, minimum in {'DE':400,'ES':52,'RU':2000,'UA':136,'US':3100,'CA':293,
                              'BR':5500,'AR':500,'MX':2400,'ZA':52,'NG':774,'EG':300,
                              'KE':250,'CD':150,'AU':500,'IN':700}.items():
            with self.subTest(country=code):
                self.assertGreaterEqual(counts[code],minimum)
        self.assertGreaterEqual(len(counts),150)
        self.assertEqual(sum(f['properties']['country']=='ES' and f['properties']['level']=='region' for f in self.features),19)

    def test_new_subregions_have_unique_ids_and_parents_in_the_same_country(self):
        ids={f['properties']['id']:f['properties'] for f in self.features}
        self.assertEqual(len(ids),len(self.features))
        for p in ids.values():
            if p['id'].startswith(('gb-world:', 'nuts:', 'statcan:', 'ocha:')):
                parent=ids[p['parent_id']]
                self.assertEqual(parent['country'],p['country'])
                self.assertEqual(parent['level'],'region')
        # The post-reform OCHA dataset includes the Ukrainian Crimean districts.
        crimean=[p for p in ids.values() if p['id'].startswith('ocha:UA01')]
        self.assertTrue(crimean)
        self.assertTrue(all(p['country']=='UA' for p in crimean))

    def test_world_cities_resolve_to_subregions_and_crimea_stays_ukrainian(self):
        from src.admin_boundaries import subregion_at
        country_ids={row[5]:row[0] for row in json.loads(atlas.static_bytes('mapa.json'))['panstwo']}
        for code, lon, lat in [('DE',13.405,52.52),('ES',-3.704,40.417),('US',-122.419,37.775),
                               ('CA',-79.383,43.653),('RU',49.106,55.796),('UA',34.1,44.95),
                               ('KE',36.815,-1.273),('BR',-46.63,-23.55)]:
            with self.subTest(country=code):
                shapes=[]
                for feature in self.features:
                    if feature['properties']['country']==code and feature['properties']['level']=='subregion' and feature['geometry']:
                        shapes.extend(atlas.polygon_bounds(feature['properties']['id'],feature['geometry']))
                self.assertIsNotNone(atlas.region_at(lon,lat,shapes) or subregion_at(lon,lat,country_ids[code]))

    def test_subregions_are_enabled_with_independent_render_distance(self):
        self.assertFalse(atlas.DEFAULT_VISIBILITY['subregions'])
        self.assertEqual(atlas.DEFAULT_LAYOUT['render_subregions'],'6')
        self.assertIn('6.5',atlas.LAYOUT_VALUES['render_subregions'])

if __name__=='__main__': unittest.main()
