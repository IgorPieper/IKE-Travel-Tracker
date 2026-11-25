"""Build offline map tiers from Natural Earth and geoBoundaries Polish ADM2.

Preparation only: requires shapely; the shipped app needs no new dependency.
Existing Natural Earth IDs are retained so moving a unit never loses its visits.
"""
import gzip
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.local' / 'boundaries'
NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'
POL_URL = 'https://www.geoboundaries.org/api/current/gbOpen/POL/ADM2/'
# These catalogues describe local municipalities, counties or small districts,
# rather than the larger regional tier. Federal cantons and provinces stay regions.
LOCAL_COUNTRIES = set('SI LV ME MK MD AZ LU IE EE HR AL CY IL BN BT JM LS LK TL UG XK'.split())
GROUPED_COUNTRIES = {'IT': 'region', 'FR': 'region', 'GB': 'geonunit', 'ES': 'region', 'BE': 'region', 'PH': 'region'}


def cached(name, url):
    path = CACHE / name
    if not path.exists():
        with urlopen(Request(url, headers={'User-Agent': 'IKE-Travel-Tracker boundary preparation'}), timeout=120) as response:
            path.write_bytes(response.read())
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    target = ROOT / 'data/maps/rejony.json.gz'
    original = CACHE / 'rejony-original.json.gz'
    if not original.exists():
        original.write_bytes(target.read_bytes())
    data = json.loads(gzip.decompress(original.read_bytes()))
    # A fresh checkout already contains the generated file. Keep its original
    # Natural Earth units and regenerate additions rather than duplicating them.
    data['features'] = [f for f in data['features'] if not f['properties']['id'].startswith(
        ('region:', 'gb:PL:ADM2:', 'gb-world:', 'nuts:', 'statcan:', 'ocha:'))]
    raw = cached('natural-earth-adm1.geojson', NE_URL)
    metadata = {f['properties']['adm1_code']: f['properties'] for f in raw['features']}
    pol_meta = cached('pol-adm2-metadata.json', POL_URL)
    pol = cached('pol-adm2.geojson', pol_meta['simplifiedGeometryGeoJSON'])
    grouped = {}
    for feature in data['features']:
        props = feature['properties']
        props.pop('parent_id', None)
        country = props['country']
        props['level'] = 'subregion' if country in LOCAL_COUNTRIES or country in GROUPED_COUNTRIES else 'region'
        if country in GROUPED_COUNTRIES:
            info = metadata[props['id'].removeprefix('ne:')]
            label = info[GROUPED_COUNTRIES[country]]
            grouped.setdefault((country, label), []).append(feature)
    for (country, label), members in sorted(grouped.items()):
        identifier = 'region:' + country + ':' + hashlib.sha256(label.encode()).hexdigest()[:12]
        geometry = unary_union([shape(f['geometry']) for f in members]).simplify(.0001, preserve_topology=True)
        point = geometry.representative_point()
        for feature in members:
            feature['properties']['parent_id'] = identifier
        data['features'].append({'type':'Feature', 'properties':{
            'id':identifier,'name':label,'alias':label,'country':country,
            'lon':round(point.x,6),'lat':round(point.y,6),'level':'region'}, 'geometry':mapping(geometry)})
    provinces = [(f['properties']['id'], shape(f['geometry'])) for f in data['features'] if f['properties']['country']=='PL']
    for feature in pol['features']:
        props = feature['properties']
        geometry = shape(feature['geometry']).simplify(.0001, preserve_topology=True)
        point = geometry.representative_point()
        parent = next((id for id,g in provinces if g.covers(point)), None)
        if parent is None:
            parent = min(provinces,key=lambda item:item[1].distance(point))[0]
        data['features'].append({'type':'Feature','properties':{
            'id':'gb:PL:ADM2:'+props['shapeID'], 'name':props['shapeName'], 'alias':props['shapeName'],
            'country':'PL','lon':round(point.x,6),'lat':round(point.y,6),'level':'subregion','parent_id':parent},
            'geometry':mapping(geometry)})
    target.write_bytes(gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
    sources = {'classification': {'localCountries':sorted(LOCAL_COUNTRIES),'groupedCountries':GROUPED_COUNTRIES},
               'sources':[{'name':'Natural Earth','url':'https://www.naturalearthdata.com/','license':'Public domain'},
                          {'name':'geoBoundaries POL ADM2','url':POL_URL,'license':pol_meta['boundaryLicense'],
                           'boundaryYearRepresented':pol_meta['boundaryYearRepresented'],'boundaryID':pol_meta['boundaryID']}]}
    (ROOT/'data/maps/podregiony-zrodla.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    from collections import Counter
    print(Counter(f['properties']['level'] for f in data['features']))
    print('Polish counties:',sum(f['properties']['country']=='PL' and f['properties']['level']=='subregion' for f in data['features']))


if __name__ == '__main__':
    main()
