"""Capital district outlines, bundled or cached locally after an OSM download."""
import gzip
import hashlib
import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .focus_map import bounds, contains, focus_area, normalized


def relation_geometry(relation):
    """Join outer member ways in either direction; never invent missing segments."""
    parts = [[(round(p['lon'], 7), round(p['lat'], 7)) for p in member['geometry']]
             for member in relation.get('members', [])
             if member.get('type') == 'way' and member.get('role', '') in ('', 'outer')
             and len(member.get('geometry', [])) > 1]
    rings = []
    while parts:
        chain = parts.pop()
        while chain[0] != chain[-1]:
            for index, part in enumerate(parts):
                if chain[-1] == part[0]:
                    chain.extend(part[1:])
                elif chain[-1] == part[-1]:
                    chain.extend(reversed(part[:-1]))
                elif chain[0] == part[-1]:
                    chain = part[:-1] + chain
                elif chain[0] == part[0]:
                    chain = list(reversed(part[1:])) + chain
                else:
                    continue
                parts.pop(index)
                break
            else:
                break
        if len(chain) >= 4 and chain[0] == chain[-1]:
            rings.append([chain])
    return {'type': 'MultiPolygon', 'coordinates': rings}


def district_features(elements, area):
    west, south, east, north = area['bounds']
    size = (east-west)*(north-south)
    candidates = []
    for relation in elements:
        tags = relation.get('tags', {})
        if relation.get('type') != 'relation' or not tags.get('name'):
            continue
        geometry = relation_geometry(relation)
        if not geometry['coordinates']:
            continue
        a, b, c, d = bounds(geometry)
        # Exclude enclosing cities, neighbouring municipalities and tiny nested quarters.
        if (c-a)*(d-b) >= size*.9 or not contains(area['feature']['geometry'], (a+c)/2, (b+d)/2):
            continue
        try:
            level = int(tags.get('admin_level', ''))
        except ValueError:
            continue
        candidates.append((level, {'type':'Feature', 'properties':{'id':f"osm:r{relation['id']}",
            'name':tags['name'], 'name_en':tags.get('name:en', '')}, 'geometry':geometry}))
    level = min((level for level, _ in candidates), default=None)
    return {'type':'FeatureCollection', 'features':[feature for rank, feature in candidates if rank == level],
            'source':'https://www.openstreetmap.org/copyright', 'licence':'© OpenStreetMap contributors · ODbL'}


def capital_districts(identifier, allow_online):
    from . import atlas
    area = focus_area('miasto', identifier)
    if not area.get('is_capital'):
        raise ValueError('Not a capital')
    bundled = json.loads(gzip.decompress(atlas.static_bytes('stolice-dzielnice.json.gz')))
    key = area['country'] + ':' + normalized(area['name'])
    if key in bundled:
        return bundled[key]
    cache = atlas.USER_DATA / 'cache' / 'capital-districts' / (hashlib.sha256(identifier.encode()).hexdigest()+'.json')
    if cache.exists():
        try:
            return json.loads(cache.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            pass
    if not allow_online:
        return {'type':'FeatureCollection','features':[], 'unavailable':'offline'}
    west, south, east, north = area['bounds']
    query = ('[out:json][timeout:20];rel["boundary"="administrative"]'
             '["admin_level"~"^(3|4|5|6|7|8|9|10|11)$"]'
             f'({south},{west},{north},{east});out tags geom;')
    for host in ('overpass.private.coffee', 'overpass-api.de'):
        try:
            request = Request(f'https://{host}/api/interpreter?' + urlencode({'data':query}),
                              headers={'User-Agent':'IKE-Travel-Tracker/1.1 (district boundaries)'})
            with urlopen(request, timeout=25) as response:
                raw = response.read(24*1024*1024+1)
            if len(raw) > 24*1024*1024:
                raise ValueError('District response too large')
            payload = json.loads(raw)
            if 'remark' in payload:
                continue
            data = district_features(payload['elements'], area)
            if data['features']:
                try:
                    cache.parent.mkdir(parents=True, exist_ok=True)
                    temporary = cache.with_suffix('.tmp')
                    temporary.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
                    temporary.replace(cache)
                except OSError:
                    pass
                return data
        except (OSError, ValueError, KeyError):
            continue
    return {'type':'FeatureCollection','features':[], 'unavailable':'source'}
