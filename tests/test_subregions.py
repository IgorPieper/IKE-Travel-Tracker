import gzip
import json
import unittest
from collections import Counter
from types import SimpleNamespace
from src import atlas


class SubregionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.features = json.loads(gzip.decompress(atlas.static_bytes('rejony.json.gz')))['features']

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

    def test_subregions_are_enabled_with_independent_render_distance(self):
        self.assertTrue(atlas.DEFAULT_VISIBILITY['subregions'])
        self.assertEqual(atlas.DEFAULT_LAYOUT['render_subregions'],'6')
        self.assertIn('6.5',atlas.LAYOUT_VALUES['render_subregions'])

if __name__=='__main__': unittest.main()
