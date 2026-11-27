"""Verified municipal outlines replacing over-connected urban footprints."""
import json
import zipfile

from shapely.geometry import shape, mapping, Point
from shapely.ops import unary_union

# Explicitly reviewed administrative relations. Never choose the first search
# result: a matching name may identify a province, office building or city node.
AUDITED_RELATIONS = {
    '6004094':'Yangon', '7202037':'Dar es Salaam', '7407678':'Santo Domingo',
    '2415335':'Baku', '316552':'Beirut', '113714':'Quito', '4499870':'La Paz',
    '17809340':'San Salvador', '4069041':'San José', '5675756':'Ouagadougou',
    '4136816':'Ottawa', '364087':'Yerevan', '1996871':'Tbilisi',
    '1381350':'Jerusalem', '67992':'Guatemala City', '2851879':'Cotonou',
    '8748136':'Bandar Seri Begawan', '2628521':'Nicosia', '3488099':'Port Louis',
    '19425413':'Pristina', '1682378':'Bern', '20137070':'Moroni',
    '407489':'Luxembourg', '1124039':'Monaco', '3825987':'Majuro',
    '2192363':'København',
}


def apply_audited_corrections(data, districts, report, cache):
    from src.focus_map import normalized
    import math
    relations = {}
    for path in sorted(cache.glob('capital-audit-*.json')):
        for result in json.loads(path.read_bytes()):
            identifier = str(result.get('osm_id'))
            if result.get('osm_type') == 'relation' and result.get('category') == 'boundary' and identifier in AUDITED_RELATIONS:
                relations[identifier] = result
    missing = set(AUDITED_RELATIONS)-relations.keys()
    if missing: raise ValueError('Missing verified capital relations: '+str(sorted(missing)))
    countries = {f['properties']['iso_a2']:f['properties']['adm0_a3'] for f in
                 json.loads((cache/'natural-earth-adm1.geojson').read_bytes())['features']}
    countries['MC'] = 'MCO'
    catalogues = {level:json.loads((cache/f'gbOpen-{level}-catalogue.json').read_bytes())
                  for level in ('ADM2','ADM3','ADM4')}
    sources = []
    for identifier, english in AUDITED_RELATIONS.items():
        capital = next(f for f in data['features'] if f['properties']['original'] == english)
        props = capital['properties'];code = props['country'];outline = shape(relations[identifier]['geojson'])
        url = 'https://www.openstreetmap.org/relation/'+identifier
        source_name = 'OpenStreetMap · '+english
        if code == 'MC':
            # The sovereign OSM relation includes territorial sea. Its nine
            # land-based quartiers define the city footprint instead.
            quartiers = json.loads((cache/'global-MCO-ADM2.geojson').read_bytes())['features']
            assert len(quartiers) == 9
            outline = unary_union([shape(f['geometry']) for f in quartiers])
            url = 'https://github.com/wmgeolab/geoBoundaries/tree/main/releaseData/gbOpen/MCO/ADM2'
            source_name = 'geoBoundaries / OpenStreetMap · Monaco land quartiers (2017)'
        if not outline.is_valid or outline.is_empty: raise ValueError(english+': invalid outline')
        # Reject enclosing provinces accidentally substituted for a city.
        minx,miny,maxx,maxy = outline.bounds
        if max((maxx-minx)*111*math.cos(math.radians(outline.centroid.y)),(maxy-miny)*111) > 180:
            raise ValueError(english+': administrative outline unexpectedly broad')
        capital['geometry'] = mapping(outline)
        props.update(boundary_kind='municipality',source_id=url)
        if not outline.covers(Point(props['lon'],props['lat'])):
            result = relations[identifier]
            anchor = Point(float(result['lon']),float(result['lat']))
            if not outline.covers(anchor): anchor = outline.representative_point()
            props.update(lon=anchor.x,lat=anchor.y)
        key = code+':'+normalized(props['name'])
        districts.pop(key,None)  # Old urban-footprint clips are no longer valid.
        for level,catalogue in catalogues.items():
            path = cache/f'global-{countries.get(code)}-{level}.geojson'
            if not path.exists(): continue
            selected = []
            for feature in json.loads(path.read_bytes())['features']:
                geometry = shape(feature['geometry'])
                if not geometry.intersects(outline) or geometry.area >= outline.area*.75: continue
                intersection = geometry.intersection(outline)
                if intersection.area < geometry.area*.6: continue
                selected.append({'type':'Feature','properties':{'name':feature['properties']['shapeName'],
                    'id':feature['properties']['shapeID']},'geometry':mapping(intersection)})
            if len(selected) >= 2:
                meta = next(m for m in catalogue if m['boundaryISO'] == countries[code])
                districts[key] = {'type':'FeatureCollection','features':selected,
                    'source':meta['simplifiedGeometryGeoJSON'],'licence':meta['boundaryLicense'],
                    'year':meta.get('boundaryYearRepresented','')}
                break
        for row in report:
            if row['name'] == props['name'] and row['country'] == code:
                row.update(kind='municipality',districts=len(districts.get(key,{}).get('features',[])))
        sources.append({'name':source_name,'source':url,'licence':'ODbL','retrieved':'2026-11-26'})
    return sources


def city_outlines(cache):
    with zipfile.ZipFile(cache/'hdx-bgd-boundaries.zip') as archive:
        features = json.loads(archive.read('bgd_admin3.geojson'))['features']
    corporations = [f for f in features if f['properties']['adm3_pcode'] in ('BD30262500','BD30262000')]
    assert len(corporations) == 2
    dhaka = unary_union([shape(f['geometry']) for f in corporations])
    results = json.loads((cache/'capital-hanoi-osm.json').read_bytes())
    hanoi = next(r for r in results if r.get('osm_type') == 'relation' and r.get('osm_id') == 1903516
                 and r.get('category',r.get('class')) == 'boundary')
    algiers = next(r for r in json.loads((cache/'capital-algiers-osm.json').read_bytes())
                   if r.get('osm_type') == 'relation' and r.get('osm_id') == 157062
                   and r.get('category',r.get('class')) == 'boundary')
    lisbon = json.loads((cache/'capital-lisbon-parishes.geojson').read_bytes())['features']
    assert len(lisbon) == 24
    return {'BD':dhaka, 'VN':shape(hanoi['geojson']), 'DZ':shape(algiers['geojson']),
            'PT':unary_union([shape(f['geometry']) for f in lisbon])}


def apply_corrections(data, districts, report, cache):
    from src.focus_map import normalized
    outlines = city_outlines(cache)
    bd_source = json.loads((cache/'hdx-bgd-metadata.json').read_bytes())
    sources = [
        {'name':'BBS / OCHA HDX · Dhaka North and South City Corporations',
         'source':'https://data.humdata.org/dataset/'+bd_source['name'],
         'licence':bd_source['license_title'], 'year':'2023'},
        {'name':'OpenStreetMap · Hanoi municipality',
         'source':'https://www.openstreetmap.org/relation/1903516','licence':'ODbL','retrieved':'2026-11-26'},
        {'name':'OpenStreetMap · Algiers capital territory (wilaya)',
         'source':'https://www.openstreetmap.org/relation/157062','licence':'ODbL','retrieved':'2026-11-26',
         'note':'The capital territory comprises 57 communes; it is not the tiny Alger-Centre commune.'},
        {'name':'Câmara Municipal de Lisboa · 24 freguesias',
         'source':'https://gisapps.cm-lisboa.pt/arcgis/rest/services/SGPI_Open/LXSGPI_Temas/MapServer/4',
         'retrieved':'2026-11-26'},
    ]
    for code, iso, level, source in [('BD','BGD','ADM3',sources[0]),('VN','VNM','ADM2',sources[1]),
                                      ('DZ','DZA','ADM3',sources[2]),('PT','PRT',None,sources[3])]:
        outline = outlines[code]
        capital = next(f for f in data['features'] if f['properties']['country'] == code)
        capital['geometry'] = mapping(outline)
        kind = 'capital-territory' if code == 'DZ' else 'municipality'
        capital['properties'].update(boundary_kind=kind, source_id=source['source'])
        if code == 'PT':
            features = json.loads((cache/'capital-lisbon-parishes.geojson').read_bytes())['features']
            selected = [{'type':'Feature','properties':{'name':f['properties']['NOME'],
                'id':'lisboa:'+str(f['properties']['COD_SIG'])},'geometry':f['geometry']} for f in features]
            districts[code+':'+normalized(capital['properties']['name'])] = {
                'type':'FeatureCollection','features':selected,**source}
            for row in report:
                if row['country'] == code: row.update(kind=kind,districts=len(selected))
            continue
        raw = json.loads((cache/f'global-{iso}-{level}.geojson').read_bytes())['features']
        selected = []
        for feature in raw:
            geometry = shape(feature['geometry'])
            if not geometry.intersects(outline): continue
            intersection = geometry.intersection(outline)
            if geometry.area >= outline.area*.75 or intersection.area < geometry.area*.6: continue
            selected.append({'type':'Feature','properties':{'name':feature['properties']['shapeName'],
                'id':feature['properties']['shapeID']},'geometry':mapping(intersection)})
        catalogue = json.loads((cache/f'gbOpen-{level}-catalogue.json').read_bytes())
        meta = next(m for m in catalogue if m['boundaryISO'] == iso)
        districts[code+':'+normalized(capital['properties']['name'])] = {
            'type':'FeatureCollection','features':selected,'source':meta['simplifiedGeometryGeoJSON'],
            'licence':meta['boundaryLicense'],'year':meta.get('boundaryYearRepresented','')}
        for row in report:
            if row['country'] == code:
                row.update(kind=kind,districts=len(selected))
    return sources + apply_audited_corrections(data,districts,report,cache)
