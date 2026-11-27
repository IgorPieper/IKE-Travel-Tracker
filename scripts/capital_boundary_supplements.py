"""Curated municipal subdivisions; excludes HDX health-zone boundaries."""
import json
import zipfile

from shapely.geometry import shape, mapping
from shapely.ops import unary_union


def supplements(cache):
    results = []
    for iso, code, parent, level in [('zmb','ZM','Lusaka',4),('mwi','MW','Lilongwe City',3),('ago','AO','Luanda',3)]:
        metadata = json.loads((cache/f'hdx-{iso}-metadata.json').read_bytes())['result']
        with zipfile.ZipFile(cache/f'hdx-{iso}-boundaries.zip') as archive:
            rows = json.loads(archive.read(f'{iso}_admin{level}.geojson'))['features']
        features = [{'type':'Feature','properties':{'name':f['properties'][f'adm{level}_name']},'geometry':f['geometry']}
                    for f in rows if f['properties']['adm2_name'] == parent]
        results.append((code, features, {'name':f'OCHA / HDX · {iso.upper()}',
            'source':'https://data.humdata.org/dataset/'+metadata['name'], 'licence':metadata['license_title'],
            'licence_url':metadata.get('license_url','')}))
    return results


def apply_supplements(data, districts, report, cache):
    from src.focus_map import normalized
    sources = []
    for code, features, source in supplements(cache):
        capital = next(f for f in data['features'] if f['properties']['country'] == code)
        # These are explicitly named city subdivisions, so preserve the full
        # municipal area rather than clipping them to an old urban footprint.
        clean = [{**f,'geometry':mapping(shape(f['geometry']).simplify(.00002,preserve_topology=True))} for f in features]
        capital['geometry'] = mapping(unary_union([shape(f['geometry']) for f in clean]))
        capital['properties']['boundary_kind'] = 'municipality'
        capital['properties']['source_id'] = source['source']
        key = code+':'+normalized(capital['properties']['name'])
        districts[key] = {'type':'FeatureCollection','features':clean,**source}
        for row in report:
            if row['country'] == code:
                row.update(kind='municipality',districts=len(clean))
        sources.append(source)
    return sources
