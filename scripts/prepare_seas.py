"""Prepare sea outlines, identifying supplemental cartographic approximations.

Inputs are cached Marine Regions IHO v3 / SeaVoX v19 polygons and gazetteer /
OpenStreetMap records and explicitly labelled supplemental outlines. The lite
polygon caches are simplified at 0.005 degrees.
"""
import json
import unicodedata
from pathlib import Path

from shapely.geometry import shape, mapping, Point
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT/'.local/boundaries'
ALIASES = {
    'Balearic Sea':['Balearic (Iberian Sea)'], 'Barents Sea':['Barentsz Sea'],
    'Andaman Sea':['Andaman or Burma Sea'], 'Bohai Sea':['BO HAI'],
    'Java Sea':['JAWA SEA'], 'Laccadive Sea':['LAKSHADWEEP SEA'],
    'Molucca Sea':['Molukka Sea'], 'Savu Sea':['SAWU SEA'],
    'Seto Inland Sea':['Seto Naikai or Inland Sea','SETO NAIKAI'],
    'East China Sea':['Eastern China Sea'],
}
# Cartographic reference points, not invented sea boundaries. These regional
# names have no matching polygon/location in the cached public catalogues.
REFERENCE_POINTS = {'argentynskie':[-61,-42], 'chilijskie':[-76,-38],
    'chiloe':[-73.1,-42.5], 'iroise':[-5.15,48.25],
    'karpackie':[27,35.55], 'sardynskie':[7,39.5]}
LABEL_POINTS = {'baltyckie':[19,56], 'srodziemne':[18,35.5],
    'argentynskie':[-61,-42], 'chilijskie':[-76,-38], 'fidzi':[177.5,-25.1166667],
    'irmingera':[-35,62], 'kantabryjskie':[-3.4075072,43.6403589],
    'koro':[179.8333333,-17.6666667], 'salish':[-123.173288,48.3568477], 'sargassowe':[-60,30]}


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFKD',text.casefold()) if not unicodedata.combining(c))


def refresh_sources(rows):
    import ijson  # Build-time streaming dependency; not used by the app.
    wanted={normalized(name) for row in rows for name in [row['english'],*ALIASES.get(row['english'],[])]}
    for source in ('iho','seavox_v19'):
        features=[]
        with (CACHE/f'marine-{source}.geojson').open('rb') as stream:
            for feature in ijson.items(stream,'features.item',use_float=True):
                props=feature['properties']
                keys=('name',) if source == 'iho' else ('region','level_1','level_2','level_3','level_4','sub_region')
                # Parent seas can be stored in `region`, not just level_N.
                if not any(normalized(props.get(key) or '') in wanted for key in keys):continue
                geometry=shape(feature['geometry']).simplify(.005,preserve_topology=False)
                if not geometry.is_empty:
                    feature['geometry']=mapping(geometry);features.append(feature)
        (CACHE/f'marine-{source}-lite.geojson').write_text(json.dumps(
            {'type':'FeatureCollection','features':features},separators=(',',':')),encoding='utf-8')


def main():
    rows = json.loads((ROOT/'data/challenges/morza-lista.json').read_bytes())
    import sys
    if '--refresh-sources' in sys.argv:refresh_sources(rows)
    datasets = {source:json.loads((CACHE/f'marine-{source}-lite.geojson').read_bytes())['features']
                for source in ('seavox_v19','iho')}
    features = []
    supplements_path = ROOT / 'data/challenges/morza-uzupelnienia.json'
    supplements = {f['properties']['id']:f for f in json.loads(supplements_path.read_bytes())['features']} if supplements_path.exists() else {}
    for row in rows:
        aliases = {normalized(n) for n in [row['english'],*ALIASES.get(row['english'],[])]}
        geometry = None;source_url = '';kind = 'catalogue'
        for source, catalogue in datasets.items():
            matches = [f for f in catalogue if any(normalized(str(value or '')) in aliases
                for key,value in f['properties'].items() if key in ('name','region','sub_region') or key.startswith('level_'))]
            if not matches:continue
            geometry = unary_union([shape(f['geometry']) for f in matches])
            if not geometry.is_valid:geometry = geometry.buffer(0)
            source_url = 'https://geo.vliz.be/geoserver/MarineRegions/ows#'+source
            break
        supplement = supplements.get(row['id']) if geometry is None else None
        if supplement:
            geometry = shape(supplement['geometry'])
            kind = supplement['properties']['boundary_kind']
            source_url = supplement['properties']['source']
        if geometry is None:
            kind = 'location';position = None
            for suffix in (() if row['id'] == 'chilijskie' else ('','-local')):
                file = CACHE/f'marine-osm-{row["id"]}{suffix}.json'
                if not file.exists():continue
                result = next((r for r in json.loads(file.read_bytes()) if
                    (row['id'] == 'martwe' and r.get('type') == 'lake') or
                    (r.get('category') == 'place' and r.get('type') == 'sea') or
                    (r.get('category') == 'natural' and r.get('type') in ('sea','strait','bay')) or
                    (r.get('category') == 'boundary' and r.get('type') == 'maritime')),None)
                if result:
                    if row['id'] == 'martwe' and result.get('geojson',{}).get('type') in ('Polygon','MultiPolygon'):
                        geometry = shape(result['geojson']).simplify(.001,preserve_topology=True)
                        kind = 'catalogue'
                    position = [float(result['lon']),float(result['lat'])]
                    source_url = f'https://www.openstreetmap.org/{result["osm_type"]}/{result["osm_id"]}'
                    break
            gaz = CACHE/f'marine-gaz-{row["id"]}.json'
            if position is None and gaz.exists():
                result = next((r for r in json.loads(gaz.read_bytes()) if r.get('placeType') in ('Sea','Bay') and
                               r.get('latitude') is not None and r.get('longitude') is not None),None)
                if result:
                    position = [result['longitude'],result['latitude']]
                    source_url = 'https://www.marineregions.org/mrgid/'+str(result['MRGID'])
            if position is None:
                position = REFERENCE_POINTS[row['id']]
                source_url = 'cartographic-reference-point'
            if geometry is None:geometry = Point(position)
        if geometry.geom_type == 'Point':
            position = [geometry.x,geometry.y]
            bounds = [max(-180,geometry.x-1),max(-85,geometry.y-.65),min(180,geometry.x+1),min(85,geometry.y+.65)]
        else:
            anchor = geometry.representative_point();position = [anchor.x,anchor.y];bounds = list(geometry.bounds)
            preferred = LABEL_POINTS.get(row['id'])
            if preferred and geometry.covers(Point(preferred)):position = preferred
        properties = {**row,'lon':position[0],'lat':position[1],'bounds':bounds,
                      'boundary_kind':kind,'source':source_url}
        if supplement and supplement['properties'].get('camera_bounds'):
            properties['bounds'] = supplement['properties']['camera_bounds']
        features.append({'type':'Feature','properties':properties,'geometry':mapping(geometry)})
    assert len(features) == len(rows) and len({f['properties']['id'] for f in features}) == len(rows)
    aliases = json.loads((ROOT/'data/challenges/morza-laczenia.json').read_bytes())
    assert set(aliases.values()) <= {r['id'] for r in rows}
    doc = {'type':'FeatureCollection','features':features,'prepared':'2026-11-26',
           'aliases':aliases,'completionRatio':.9,
           'sources':[{'name':'Marine Regions · IHO Sea Areas v3 (2018)',
                       'url':'https://www.marineregions.org/sources.php','licence':'CC BY 4.0'},
                      {'name':'BODC / SeaVoX Sea Areas v19 (2023)',
                       'url':'https://doi.org/10.14284/590',
                       'licence':'CC BY 4.0'},
                      {'name':'OpenStreetMap','url':'https://www.openstreetmap.org/copyright','licence':'ODbL'}],
           'note':'Derived challenge subset. Location-only records have no asserted polygon. The supplied list defines completion, not a travel-safety assessment.'}
    target = ROOT/'data/challenges/morza-wyzwanie.json'
    target.write_text(json.dumps(doc,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print('Prepared',len(features),'seas;',sum(f['geometry']['type']=='Point' for f in features),'location markers;',target.stat().st_size,'bytes')
    print('Reference points:',[f['properties']['english'] for f in features if f['properties']['source']=='cartographic-reference-point'])


if __name__ == '__main__':main()
