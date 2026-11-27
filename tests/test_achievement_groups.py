import unittest
from src.atlas import read_achievements
from src.focus_map import administrative_features


class AchievementGroupTests(unittest.TestCase):
    def test_new_achievement_lists_resolve_to_real_distinct_map_places(self):
        import json
        from src import atlas
        definitions = {d['id']:d for d in read_achievements()}
        countries = {row[5] for row in json.loads(atlas.static_bytes('mapa.json'))['panstwo']}
        regions = {f['properties']['id'] for f in administrative_features()}
        for identifier, target, catalogue in [('nato',32,countries),('biblical-countries',25,countries),('kashubia',11,regions)]:
            with self.subTest(id=identifier):
                definition = definitions[identifier]
                members = definition['rule'].split(':',1)[1].split('|')
                self.assertEqual(len(members),target)
                self.assertEqual(len(set(members)),target)
                self.assertTrue(set(members) <= catalogue)
                self.assertEqual(definition['levels'][0]['target'],target)
                self.assertFalse(definition['secret'])
        self.assertTrue({'FI','SE','MK'} <= set(definitions['nato']['rule'].split(':',1)[1].split('|')))


if __name__ == '__main__':unittest.main()
