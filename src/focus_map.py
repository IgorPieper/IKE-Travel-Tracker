"""Local boundary lookup and search for the map's area focus tool."""
import gzip
import json
import unicodedata
import zlib
from functools import lru_cache


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFD', value.casefold().replace('ł', 'l')) if not unicodedata.combining(c))


@lru_cache(maxsize=6)
def local_features(filename):
    from .atlas import static_bytes
    data = static_bytes(filename)
    return json.loads(gzip.decompress(data) if filename.endswith('.gz') else data)['features']


def bounds(geometry):
    polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    points = [point for rings in polygons for point in rings[0]]
    return [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]


def contains(geometry, lon, lat):
    from .atlas import point_in_ring
    polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    return any(point_in_ring(lon, lat, rings[0]) and not any(point_in_ring(lon, lat, hole) for hole in rings[1:]) for rings in polygons)


def simplify_outline(geometry, tolerance):
    """Reduce context lines without changing the selected area's precise boundary."""
    def ring(points):
        keep = {0, len(points)-1}
        pending = [(0, len(points)-1)]
        while pending:
            start, end = pending.pop()
            ax, ay = points[start][:2]
            bx, by = points[end][:2]
            dx, dy = bx-ax, by-ay
            length = dx*dx+dy*dy
            farthest, distance = None, tolerance*tolerance
            for index in range(start+1, end):
                x, y = points[index][:2]
                fraction = max(0, min(1, ((x-ax)*dx+(y-ay)*dy)/length)) if length else 0
                squared = (x-ax-fraction*dx)**2+(y-ay-fraction*dy)**2
                if squared > distance:
                    farthest, distance = index, squared
            if farthest is not None:
                keep.add(farthest)
                pending.extend(((start, farthest), (farthest, end)))
        result = [points[index] for index in sorted(keep)]
        return result if len(result) >= 4 else points
    polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    simplified = [[ring(rings[0])] for rings in polygons]  # Context needs no internal holes.
    return {'type':'MultiPolygon','coordinates':simplified}


def camera_bounds(geometry, category):
    if category != 'kontynent':
        return bounds(geometry)
    polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    def size(rings):
        points = rings[0]
        return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points, points[1:])))
    mainland = max(polygons, key=size)
    return bounds({'type':'Polygon','coordinates':mainland})


@lru_cache(maxsize=16)
def focus_area(category, id):
    from . import atlas
    regions = local_features('rejony.json.gz')
    code = ''
    if category == 'panstwo':
        countries = json.loads(atlas.static_bytes('mapa.json'))['panstwo']
        country = next(item for item in countries if item[0] == id)
        name, code = country[1], country[5]
        features = [feature for feature in local_features('podklad.json.gz')
                    if feature['properties'].get('country_id') == id and feature['geometry']['type'] in ('Polygon', 'MultiPolygon')]
        polygons = [polygon for feature in features for polygon in
                    (feature['geometry']['coordinates'] if feature['geometry']['type'] == 'MultiPolygon' else [feature['geometry']['coordinates']])]
        geometry = {'type': 'MultiPolygon', 'coordinates': polygons}
    elif category == 'kontynent':
        feature = next(feature for feature in local_features('kontynenty-obrysy.json.gz') if feature['properties']['id'] == id)
        name = next(item['name'] for item in json.loads(atlas.static_bytes('kontynenty.json')) if item['id'] == id)
        geometry = feature['geometry']
    elif category == 'rejon':
        feature = next(feature for feature in regions if feature['properties']['id'] == id)
        name, code, geometry = feature['properties']['name'], feature['properties']['country'], feature['geometry']
    elif category == 'miasto':
        feature = None
        for filename in ('miasta-polska.json.gz', 'duze-miasta.json.gz', 'stolice.json.gz'):
            feature = next((item for item in local_features(filename) if item['properties']['division_id'] in (id, id.removeprefix('overture:'))), None)
            if feature:
                break
        if feature:
            name = feature['properties'].get('@name') or feature['properties']['name']
            code, geometry = feature['properties'].get('country', ''), feature['geometry']
        else:
            source = atlas.SETTLEMENTS if id.startswith('simc:') else atlas.WORLD_CITIES
            with atlas.open_database(source) as database:
                row = database.execute('SELECT name, label, geometry FROM settlements WHERE id = ?', (id,)).fetchone()
            if row is None:
                raise ValueError('Unknown locality boundary')
            name, code, geometry = row[0], 'PL' if source == atlas.SETTLEMENTS else row[1], json.loads(zlib.decompress(row[2]))
    else:
        raise ValueError('Unknown area type')
    if geometry['type'] not in ('Polygon', 'MultiPolygon') or not geometry['coordinates']:
        raise ValueError('Missing boundary')
    extent = bounds(geometry)
    camera = camera_bounds(geometry, category)
    west, south, east, north = camera
    dx, dy = max(.02, east-west)*.2, max(.02, north-south)*.2
    nearby = [max(-180,west-dx), max(-85,south-dy), min(180,east+dx), min(85,north+dy)]
    context = []
    tolerance = max(.005, max(east-west, north-south)*.002)
    # Only coarse country silhouettes surround the focus, never foreign provinces or towns.
    for feature in local_features('podklad.json.gz'):
        if feature['geometry']['type'] not in ('Polygon','MultiPolygon'):
            continue
        if category == 'panstwo' and feature['properties'].get('country_id') == id:
            continue
        neighbor_extent = bounds(feature['geometry'])
        if (neighbor_extent[0] <= nearby[2] and neighbor_extent[2] >= nearby[0]
                and neighbor_extent[1] <= nearby[3] and neighbor_extent[3] >= nearby[1]):
            context.append({'type':'Feature','properties':{'country_id':feature['properties'].get('country_id')},
                            'geometry':simplify_outline(feature['geometry'], tolerance)})
    if category == 'miasto':
        # Locality neighbours remain as outlines outside the focus mask.
        seen = {id}
        def add_locality(key, label, shape):
            if key in seen:
                return
            seen.add(key)
            context.append({'type':'Feature','properties':{'id':key,'name':label,'kind':'locality'},
                            'geometry':simplify_outline(shape, max(.00002, max(east-west,north-south)*.0003))})
        if code == 'PL':
            for neighbor in local_features('miasta-polska.json.gz'):
                neighbor_extent = bounds(neighbor['geometry'])
                if (neighbor_extent[0] <= nearby[2] and neighbor_extent[2] >= nearby[0]
                        and neighbor_extent[1] <= nearby[3] and neighbor_extent[3] >= nearby[1]):
                    props = neighbor['properties']
                    add_locality(props['division_id'], props.get('@name') or props['name'], neighbor['geometry'])
        for source in (atlas.WORLD_CITIES, atlas.SETTLEMENTS) if code == 'PL' else (atlas.WORLD_CITIES,):
            with atlas.open_database(source) as database:
                rows = database.execute('''SELECT id,name,geometry FROM settlement_bounds JOIN settlements ON settlements.rowid=settlement_bounds.place
                    WHERE min_lon <= ? AND max_lon >= ? AND min_lat <= ? AND max_lat >= ? LIMIT 500''',
                    (nearby[2],nearby[0],nearby[3],nearby[1])).fetchall()
            for key,label,data in rows:
                add_locality(key,label,json.loads(zlib.decompress(data)))
    return {'category':category, 'id':id, 'name':name, 'country':code, 'bounds':extent, 'camera_bounds':camera, 'nearby':nearby,
            'feature':{'type':'Feature','properties':{'id':id,'name':name},'geometry':geometry},
            'context':{'type':'FeatureCollection','features':context}}


def search_area(category, id, query, include_villages=True):
    from . import atlas
    query = normalized(query.strip())
    if not 2 <= len(query) <= 100:
        return []
    area = focus_area(category, id)
    west,south,east,north = area['bounds']
    found = {}
    def add(key,name,code,lon,lat,label=''):
        if (query in normalized(name) and contains(area['feature']['geometry'],lon,lat)):
            found.setdefault(key, {'id':key,'name':name,'country':code,'region':label,'position':[lon,lat]})
    for filename in ('miasta-polska.json.gz','duze-miasta.json.gz','stolice.json.gz'):
        for feature in local_features(filename):
            props=feature['properties']
            if query not in normalized(props.get('@name') or props['name']):
                continue
            extent=bounds(feature['geometry'])
            key=props['division_id']
            if ':' not in key: key='overture:'+key
            lon,lat=props.get('lon',(extent[0]+extent[2])/2),props.get('lat',(extent[1]+extent[3])/2)
            if not contains(area['feature']['geometry'],lon,lat):
                polygons=feature['geometry']['coordinates'] if feature['geometry']['type']=='MultiPolygon' else [feature['geometry']['coordinates']]
                inside=next((point for rings in polygons for point in rings[0] if contains(area['feature']['geometry'],*point)),None)
                if inside: lon,lat=inside
            add(key,props.get('@name') or props['name'],props.get('country',''),lon,lat)
    for source in (atlas.WORLD_CITIES, atlas.SETTLEMENTS) if include_villages and area['country'] in ('','PL') else (atlas.WORLD_CITIES,):
        with atlas.open_database(source) as database:
            rows=database.execute('''SELECT id,name,label,lon,lat FROM settlement_bounds JOIN settlements ON settlements.rowid=settlement_bounds.place
                WHERE min_lon <= ? AND max_lon >= ? AND min_lat <= ? AND max_lat >= ? AND instr(normalized, ?) > 0
                ORDER BY length(name), name LIMIT 2000''',(east,west,north,south,query)).fetchall()
        for key,name,label,lon,lat in rows:
            add(key,name,'PL' if source==atlas.SETTLEMENTS else label,lon,lat,label if source==atlas.SETTLEMENTS else '')
    return sorted(found.values(),key=lambda place:(normalized(place['name'])!=query,len(place['name']),normalized(place['name'])))[:50]
