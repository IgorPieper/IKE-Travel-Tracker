"""Prepare offline capital outlines and subdivisions from documented map sources.

Build-time dependency: shapely. Cached inputs come from the existing boundary
preparation scripts and geoBoundaries ADM3. Urban footprints are a labelled
fallback, never fabricated circles or enclosing national provinces.
"""
import gzip
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

from shapely import make_valid
from shapely.geometry import Point, shape, mapping
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.focus_map import administrative_features, normalized
from src.admin_boundaries import boundary_geometry

CACHE = ROOT / '.local/boundaries'
# These units are city municipalities or explicitly designated capital cities.
# Provinces sharing a city's name are deliberately not selected automatically.
CITY_UNITS = {
    'CN':'gb-world:CN:ADM2:17275852B40522342172572',
    'CO':'gb-world:CO:ADM2:7082276B37057214617227',
    'GR':'gb-world:GR:ADM3:53547021B2738722376900',
    'ET':'ne:ETH-3133', 'SN':'gb-world:SN:ADM2:50182788B18539004609148',
    'SE':'gb-world:SE:ADM2:70781695B5805413017960', 'TH':'ne:THA-416',
    'SD':'gb-world:SD:ADM2:16777658B94119143973525',
    'BR':'gb-world:BR:ADM2:56859067B90477915212525',
    'SY':'gb-world:SY:ADM2:27442178B22471987034404', 'CU':'ne:CUB-1428',
    'LR':'gb-world:LR:ADM2:62588387B62702599090886',
    'ZW':'gb-world:ZW:ADM2:62879985B33947363062254',
    'ML':'gb-world:ML:ADM2:8926073B70420899930674',
    'MZ':'gb-world:MZ:ADM2:85939544B59479814848654', 'UG':'ne:UGA-3088',
    'RW':'ne:RWA-3495', 'GW':'gb-world:GW:ADM2:13655514B38974563194217',
    'BF':'gb-world:BF:ADM3:42667915B39422983009651',
    'BW':'ne:BWA-5501', 'BI':'ne:BDI-3364',
    'SZ':'gb-world:SZ:ADM2:25544865B94244502272687',
    'GA':'gb-world:GA:ADM2:22940354B47630022104782',
    'CV':'ne:CPV-5053', 'GQ':'gb-world:GQ:ADM2:11065452B197102371645',
    'QA':'ne:QAT-1099', 'SI':'ne:SVN-962', 'LI':'ne:LIE-4895',
    'SM':'ne:SMR-4884', 'PW':'ne:PLW-5250', 'AD':'ne:AND-4876', 'IS':'gb-world:IS:ADM2:244011B48219786980381',
    'SR':'ne:SUR-72', 'SB':'ne:SLB-5130', 'VU':'gb-world:VU:ADM2:54233975B58140905255194',
    'NI':'gb-world:NI:ADM2:1004716B26688105291153',
    'PK':'gb-world:PK:ADM2:23200576B38683933016378',
    'NP':'gb-world:NP:ADM2:51301551B75108943206003',
}
# Countries with multiple capital markers need a city-specific choice.
NAMED_UNITS = {
    ('ZA','Cape Town'):'gb-world:ZA:ADM2:47623444B95865124382580',
    ('ZA','Johannesburg'):'gb-world:ZA:ADM2:47623444B15418766532839',
    ('CI','Abidjan'):'gb-world:CI:ADM2:98640826B76853064397847',
    ('CI','Yamoussoukro'):'gb-world:CI:ADM2:98640826B30232425959699',
    ('KZ','Nur-Sultan'):'ne:KAZ-4830',
}


def position(row):
    low, high = -85, 85
    for _ in range(32):
        middle = (low+high)/2
        p = math.radians(middle); p2 = p*p; p4 = p2*p2
        y = 260-182.75*p*(1.007226+p2*(.015085+p4*(-.044475+.028874*p2-.005916*p4)))
        if y > row[3]: low = middle
        else: high = middle
    lat = (low+high)/2; p2 = math.radians(lat)**2; p4 = p2*p2
    width = 182.75*(.8707-.131979*p2+p4*(-.013791+p4*(.003971*p2-.001529*p4)))
    return math.degrees((row[2]-500)/width), lat


def polygon(geometry):
    value = make_valid(shape(geometry))
    if value.geom_type == 'GeometryCollection':
        value = unary_union([g for g in value.geoms if g.geom_type in ('Polygon','MultiPolygon')])
    return value if value.geom_type in ('Polygon','MultiPolygon') and not value.is_empty else None


def write_gzip(path, data):
    path.write_bytes(gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))


def main():
    target = ROOT/'data/maps/stolice.json.gz'
    original = CACHE/'stolice-original.json.gz'
    if not original.exists(): original.write_bytes(target.read_bytes())
    data = json.loads(gzip.decompress(original.read_bytes()))
    capitals = [r for r in json.loads((ROOT/'data/maps/mapa.json').read_bytes())['miasto'] if r[8]]
    admin = {f['properties']['id']:f for f in administrative_features()}
    def admin_shape(identifier):
        f = admin[identifier]
        return polygon(f['geometry'] or boundary_geometry(identifier))
    urban_raw = json.loads((CACHE/'natural-earth-urban.geojson').read_bytes())['features']
    urban = [polygon(f['geometry']) for f in urban_raw]
    urban = [g for g in urban if g is not None]
    tree = STRtree(urban)
    del urban_raw
    districts_path = ROOT/'data/maps/stolice-dzielnice.json.gz'
    districts = json.loads(gzip.decompress(districts_path.read_bytes()))
    # Keep the independently sourced Warsaw districts; regenerate derived rows.
    districts = {key:value for key,value in districts.items() if key == 'PL:warszawa'}
    deeper = defaultdict(list)
    iso_codes = {f['properties']['adm0_a3']:f['properties']['iso_a2']
                 for f in json.loads((CACHE/'natural-earth-adm1.geojson').read_bytes())['features']}
    sources = {}
    for level in ('ADM2','ADM3','ADM4'):
        for meta in json.loads((CACHE/f'gbOpen-{level}-catalogue.json').read_bytes()):
            path = CACHE/f"global-{meta['boundaryISO']}-{level}.geojson"
            if not path.exists(): continue
            code = iso_codes.get(meta['boundaryISO'])
            for f in json.loads(path.read_bytes())['features']:
                deeper[(code,level)].append(f)
            sources[(code,level)] = {'url':meta['simplifiedGeometryGeoJSON'],
                'licence':meta['boundaryLicense'], 'year':meta.get('boundaryYearRepresented','')}
    grid3 = json.loads((CACHE/'abuja-wards-grid3.geojson').read_bytes())
    abuja_wards = [f for f in grid3['features'] if f['properties']['lga'] == 'Municipal Area Council']
    # Store geometries once and query only candidates near each capital.
    indexes = {}
    for group, features in deeper.items():
        geometries = [shape(f['geometry']) for f in features]
        indexes[group] = (features, geometries, STRtree(geometries))
    from capital_city_corrections import city_outlines
    corrected = city_outlines(CACHE)
    report = []
    for row in capitals:
        identifier, name, _, _, _, code, _, english, _ = row
        point = Point(*position(row)); aliases = {normalized(name),normalized(english or '')}
        unit = NAMED_UNITS.get((code,english), CITY_UNITS.get(code))
        existing = next((f for f in data['features'] if f['properties'].get('country')==code and
            (f['properties']['division_id'] in (identifier,unit) or normalized(f['properties'].get('name','')) in aliases)),None)
        outline = polygon(existing['geometry']) if existing else None
        kind = 'existing'
        if code in corrected:
            outline = corrected[code];kind = 'municipality'
        kampala = []
        if code == 'UG':
            for f in deeper.get(('UG','ADM4'), []):
                if f['properties']['shapeName'] in {'Central Division','Nakawa Division','Makindye Division','Kawempe Division','Rubaga Division'} and shape(f['geometry']).distance(point) < .12:
                    kampala.append(f)
            assert len(kampala) == 5
            outline = unary_union([shape(f['geometry']) for f in kampala]);kind = 'municipality'
        if outline is None and unit in admin:
            candidate = admin_shape(unit)
            # A country's alternate capitals must never reuse the primary city's unit.
            if candidate.distance(point) < .12:
                outline = candidate; kind = 'municipality'
        if outline is None and code == 'NG':
            outline = unary_union([shape(f['geometry']) for f in abuja_wards]);kind = 'municipality'
        if outline is None and code == 'TV':
            islands = admin_shape('ne:TUV+00?')
            parts = list(islands.geoms) if islands.geom_type == 'MultiPolygon' else [islands]
            nearby = [g for g in parts if g.distance(point) < .35]
            if nearby: outline = unary_union(nearby);kind = 'capital-atoll'
        if outline is None:
            candidate = urban[int(tree.nearest(point))]
            if candidate.distance(point) < .08:
                a,b,c,d = candidate.bounds
                if max((c-a)*111*math.cos(math.radians(point.y)),(d-b)*111) > 150:
                    raise ValueError(f'{name}: urban footprint spans several cities; add a verified municipal outline')
                outline = candidate; kind = 'urban-area'
        if outline is None:
            report.append({'name':name,'country':code,'missing':True}); continue
        if existing:
            existing['properties']['legacy_id'] = identifier
        else:
            existing = {'type':'Feature','properties':{'division_id':identifier,'legacy_id':identifier,
                'name':name,'country':code,'lon':point.x,'lat':point.y,'boundary_kind':kind,
                'source_id':unit if kind=='municipality' else 'Natural Earth urban areas'},
                'geometry':mapping(outline)}
            if not outline.covers(point):
                parts = list(outline.geoms) if outline.geom_type == 'MultiPolygon' else [outline]
                anchor = min(parts,key=lambda g:g.distance(point)).representative_point()
                existing['properties'].update(lon=anchor.x,lat=anchor.y)
            data['features'].append(existing)
        existing['properties']['original'] = english or name
        key = code+':'+normalized(existing['properties']['name'])
        if key not in districts:
            # Prefer the first genuine tier of subdivisions; do not promote an
            # enclosing county or province to a city district.
            for level in ('ADM2','ADM3','ADM4'):
                features = []
                if (code,level) not in indexes: continue
                raw_features, geometries, index = indexes[(code,level)]
                for i in index.query(outline):
                    f = raw_features[int(i)]
                    candidate = geometries[int(i)]
                    if not candidate.intersects(outline): continue
                    candidate = polygon(f['geometry'])
                    if candidate is None or candidate.area >= outline.area*.8: continue
                    overlap = candidate.intersection(outline)
                    if overlap.area < candidate.area*.55: continue
                    clipped = polygon(mapping(overlap))
                    if clipped is None: continue
                    features.append({'type':'Feature','properties':{'name':f['properties']['shapeName'],
                        'id':f['properties']['shapeID']}, 'geometry':mapping(clipped.simplify(.00002,preserve_topology=True))})
                if len(features) >= 2:
                    source = sources[(code,level)]
                    districts[key] = {'type':'FeatureCollection','features':features,
                        'source':source['url'],'licence':source['licence'],'year':source['year']}
                    break
        if code == 'UG':
            source = sources[('UG','ADM4')]
            districts[key] = {'type':'FeatureCollection','features':[
                {'type':'Feature','properties':{'name':f['properties']['shapeName']},'geometry':f['geometry']} for f in kampala],
                'source':source['url'],'licence':source['licence'],'year':source['year']}
        if code == 'NG':
            districts[key] = {'type':'FeatureCollection','features':[
                {'type':'Feature','properties':{'name':f['properties']['ward']},'geometry':f['geometry']} for f in abuja_wards],
                'source':'https://www.arcgis.com/home/item.html?id=45cd2ef592094d12aca43113a90a6054',
                'licence':'GRID3 / CIESIN Columbia University · CC BY-SA 4.0', 'year':'2026',
                'note':'Operational ward boundaries; not fully validated by government authorities.'}
        report.append({'name':name,'country':code,'kind':kind,'districts':len(districts.get(key,{}).get('features',[]))})
        print(name, kind, report[-1]['districts'], flush=True)
    from capital_boundary_supplements import apply_supplements
    extra_sources = apply_supplements(data,districts,report,CACHE)
    from capital_city_corrections import apply_corrections
    extra_sources += apply_corrections(data,districts,report,CACHE)
    write_gzip(target,data);write_gzip(districts_path,districts)
    (ROOT/'.local/capital-boundary-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    manifest = {'prepared':'2026-11-26', 'capital_markers':len(capitals),
        'outlines':len(data['features']), 'district_collections':len(districts),
        'coverage':report, 'sources':extra_sources + [
          {'name':'Natural Earth urban areas and administrative boundaries', 'url':'https://www.naturalearthdata.com/', 'licence':'Public domain',
           'note':'Urban footprints are used only where municipal outlines are unavailable; they are not administrative city limits.'},
          {'name':'geoBoundaries', 'url':'https://www.geoboundaries.org/',
           'datasets':[{**source,'country':code,'level':level} for (code,level),source in sources.items()]},
          {'name':'GRID3 / CIESIN, Columbia University', 'url':'https://www.arcgis.com/home/item.html?id=45cd2ef592094d12aca43113a90a6054',
           'licence':'CC BY-SA 4.0', 'note':'Operational ward boundaries for Abuja; not fully validated by government authorities.'},
          {'name':'OpenStreetMap', 'url':'https://www.openstreetmap.org/copyright','licence':'ODbL'},
          {'name':'Warsaw districts · andilabs', 'url':'https://github.com/andilabs/warszawa-dzielnice-geojson'}]}
    from capital_city_corrections import AUDITED_RELATIONS
    remaining = [f['properties']['original'] for f in data['features']
                 if f['properties'].get('boundary_kind') == 'urban-area']
    replaced = len(AUDITED_RELATIONS)+2  # Lisbon and Algiers plus the broader audit.
    manifest['boundary_audit'] = {'date':'2026-11-26',
        'urban_fallbacks_reviewed':len(remaining)+replaced,'administrative_replacements':replaced,
        'remaining_urban_fallbacks':remaining}
    (ROOT/'data/maps/stolice-zrodla.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Outlines:' ,len(data['features']),'district collections:',len(districts),flush=True)
    print('Still missing:',[(r['name'],r['country']) for r in report if r.get('missing')],flush=True)


if __name__ == '__main__': main()
