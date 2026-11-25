import unittest
from src.admin_boundaries import viewport_features, encode_geometry, decode_geometry


class AdministrativeViewportTests(unittest.TestCase):
    def test_compressed_geometry_roundtrip_retains_holes_islands_and_coordinates(self):
        geometry={'type':'MultiPolygon','coordinates':[
            [[[18.12345,54.12345],[19,54],[19,55],[18.12345,54.12345]],
             [[18.4,54.2],[18.5,54.2],[18.5,54.3],[18.4,54.2]]],
            [[[-179.12345,-12.54321],[-179,-12],[-178,-12],[-179.12345,-12.54321]]]]}
        self.assertEqual(decode_geometry(encode_geometry(geometry)),geometry)

    def setUp(self):
        def item(id, level, country, bounds):
            return ({'type':'Feature','properties':{'id':id,'level':level,'country':country},'geometry':None},[bounds])
        self.index=[item('state','region','US',[-125,30,-110,45]),
                    item('county','subregion','US',[-120,35,-119,36]),
                    item('county2','subregion','CA',[-120,55,-119,56]),
                    item('island','subregion','RU',[175,65,179,66])]

    def ids(self, **params):
        return [f['properties']['id'] for f in viewport_features(self.index,{k:[v] for k,v in params.items()})['features']]

    def test_only_visible_requested_tier_is_returned(self):
        self.assertEqual(self.ids(bbox='-121,34,-118,37',levels='subregion'),['county'])
        self.assertEqual(self.ids(bbox='-121,34,-118,37',levels='region'),['state'])
        self.assertEqual(self.ids(bbox='-180,-90,180,90'),[])

    def test_saved_outlines_survive_zooming_out_and_focus_limits_foreign_details(self):
        self.assertEqual(self.ids(bbox='10,40,30,60',ids='county'),['county'])
        self.assertEqual(self.ids(bbox='-180,-90,180,90',levels='subregion',country='CA'),['county2'])

    def test_date_line_and_invalid_bounds(self):
        self.assertEqual(self.ids(bbox='-190,60,-170,70',levels='subregion'),['island'])
        for value in ('nan,0,1,1','1,2,0,3','1,2,3','0,-91,1,1'):
            with self.subTest(value=value),self.assertRaises(ValueError):self.ids(bbox=value)

    def test_region_focus_excludes_children_of_neighboring_regions(self):
        self.index[1][0]['properties']['parent_id']='state'
        self.index[2][0]['properties']['parent_id']='other'
        self.assertEqual(self.ids(bbox='-180,-90,180,90',levels='subregion',parent='state'),['county'])
