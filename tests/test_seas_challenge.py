import json
import gzip
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
from shapely.geometry import shape,Point
from src import atlas


class SeasChallengeTests(unittest.TestCase):
    def test_display_levels_preserve_every_sea_and_keep_coastlines_without_political_borders(self):
        original = json.loads(atlas.static_bytes('morza-wyzwanie.json'))['features']
        def point_count(g):
            if g['type'] == 'Point': return 1
            polygons = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
            return sum(len(ring) for polygon in polygons for ring in polygon)
        for filename in ('morza-proste.json.gz', 'morza-mapa.json.gz'):
            display = json.loads(gzip.decompress(atlas.static_bytes(filename)))['features']
            self.assertEqual([f['properties'] for f in display], [f['properties'] for f in original])
            self.assertTrue(all(shape(f['geometry']).is_valid and not shape(f['geometry']).is_empty for f in display))
            self.assertTrue(all(shape(f['geometry']).covers(Point(f['properties']['lon'],f['properties']['lat'])) for f in display))
            self.assertLess(sum(point_count(f['geometry']) for f in display), sum(point_count(f['geometry']) for f in original)/5)
        land = json.loads(gzip.decompress(atlas.static_bytes('morza-lady.json.gz')))['features']
        self.assertEqual(len(land), 1)
        self.assertNotIn('country_id', land[0]['properties'])
        geometry = shape(land[0]['geometry'])
        self.assertTrue(geometry.is_valid)
        self.assertTrue(geometry.covers(Point(21,52)))
        self.assertFalse(geometry.covers(Point(-30,0)))
        self.assertEqual(atlas.DEFAULT_LAYOUT['seas_simple'], 'on')

    def test_every_sea_has_an_outline_and_cartographic_approximations_are_identified(self):
        data=json.loads(atlas.static_bytes('morza-wyzwanie.json'))
        expected=json.loads((atlas.ROOT/'data/challenges/morza-lista.json').read_bytes())
        self.assertEqual(len(data['features']),len(expected))
        self.assertEqual({f['properties']['name'] for f in data['features']},{r['name'] for r in expected})
        self.assertEqual({f['properties']['id'] for f in data['features'] if f['properties']['boundary_kind']=='approximate'},
                         {'argentynskie','chilijskie','fidzi','irmingera','koro','salish','sargassowe'})
        for f in data['features']:
            p=f['properties'];g=shape(f['geometry'])
            self.assertTrue(g.is_valid and not g.is_empty)
            self.assertTrue(-180<=p['lon']<=180 and -85<=p['lat']<=85)
            self.assertIn(g.geom_type, ('Polygon','MultiPolygon'))
            self.assertTrue(g.covers(Point(p['lon'],p['lat'])))
        self.assertNotIn('karpackie',{f['properties']['id'] for f in data['features']})
        self.assertEqual(data['completionRatio'],.9)

    def test_baltic_is_the_complete_sea_not_just_the_gulf_of_bothnia(self):
        data=json.loads(atlas.static_bytes('morza-wyzwanie.json'))
        features={f['properties']['id']:f for f in data['features']}
        baltic=shape(features['baltyckie']['geometry'])
        for lon,lat in [(19,55),(19.5,62),(26,60)]:self.assertTrue(baltic.covers(Point(lon,lat)))
        for child in ('alandzkie','archipelagowe','botnickie','vainameri'):self.assertNotIn(child,features)
        self.assertTrue({'beringa','grenlandzkie','sargassowe'} <= features.keys())
        self.assertEqual({id for id,f in features.items() if f['properties'].get('optional')},{'martwe','kaspijskie','fidzi','sargassowe'})
        sargasso = shape(features['sargassowe']['geometry'])
        w,s,e,n = sargasso.bounds
        self.assertLess(sargasso.area / ((e-w)*(n-s)), .9)
        self.assertEqual(features['baltyckie']['properties']['lon'],19)

    def test_legacy_visits_merge_once_and_can_then_be_removed_without_reappearing(self):
        rows=[{'kategoria':'morze','id':id,'nazwa':id} for id in ('adriatyckie','egejskie','srodziemne','botnickie')]
        merged=atlas.migrate_sea_visits(rows)
        self.assertEqual({r['id'] for r in merged},{'srodziemne','baltyckie'})
        self.assertEqual(len(merged),2)
        self.assertEqual(atlas.migrate_sea_visits(merged),merged)
        remaining=[r for r in merged if r['id']!='srodziemne']
        self.assertEqual([r['id'] for r in atlas.migrate_sea_visits(remaining)],['baltyckie'])
        self.assertEqual(rows[0]['id'],'adriatyckie')

    def test_old_progress_backups_remain_importable_after_seas_merge(self):
        from types import SimpleNamespace
        original=[{'kategoria':'morze','id':id,'nazwa':id,'lon':'15','lat':'43'} for id in ('adriatyckie','egejskie')]
        server=SimpleNamespace(places={},countries={})
        data,_,_=atlas.export_progress(original,'csv',server)
        restored=atlas.import_progress(data.decode('utf-8-sig'),'csv',server)
        self.assertEqual([r['id'] for r in restored],['srodziemne'])

    def test_developer_completion_reset_and_csv_preserve_unrelated_progress(self):
        existing=[{'kategoria':'panstwo','id':'keep','nazwa':'Keep'}]
        rows,added=atlas.update_developer_challenges(existing,'seas','complete')
        total=len(atlas.challenge_places('morze'))
        self.assertEqual(added,total)
        repeated,count=atlas.update_developer_challenges(rows,'seas','complete')
        self.assertEqual(count,0)
        with tempfile.TemporaryDirectory() as folder,patch.object(atlas,'CSV',Path(folder)/'visits.csv'):
            atlas.write_visits(repeated)
            saved=atlas.read_visits()
            self.assertEqual(len([r for r in saved if r['kategoria']=='morze']),total)
        reset,removed=atlas.update_developer_challenges(rows,'seas','reset')
        self.assertEqual(removed,total);self.assertEqual(reset,existing)


if __name__=='__main__':unittest.main()
