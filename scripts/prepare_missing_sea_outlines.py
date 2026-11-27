"""Complete sea outlines; distinguish cartographic approximations from source polygons."""
import gzip
import json
from pathlib import Path
import ijson
from shapely.geometry import shape, mapping, Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.local/boundaries'


def main():
    base = json.loads(gzip.decompress((ROOT / 'data/maps/podklad.json.gz').read_bytes()))
    land = unary_union([shape(f['geometry']).buffer(0) for f in base['features'] if f['properties'].get('kind') == 'country'])
    # These are display extents, not official hydrographic or maritime limits.
    extents = {
        'argentynskie': ([[-56,-35],[-51,-38],[-54,-44],[-56,-49],[-64,-55],[-70,-55],[-68,-45],[-65,-37],[-56,-35]],
            'https://exactas.uba.ar/crean-un-atlas-de-sensibilidad-de-la-costa-y-mar-argentino/'),
        'chilijskie': ([[-71.5,-18.3],[-75.3,-18.3],[-76.9,-25],[-77.2,-33],[-79.5,-42],[-80,-49],[-74,-56],[-66,-56],[-67,-53],[-72,-44],[-73,-36],[-70,-27],[-70,-20],[-71.5,-18.3]],
            'https://www.bcn.cl/leychile/navegar?idNorma=249151'),
        'fidzi': ([[170,-19.5],[179.8,-19.5],[179.8,-32.5],[174.5,-35],[169,-29],[170,-19.5]],
            'https://www.openstreetmap.org/node/4788145058'),
        'irmingera': ([[-44,59.5],[-42.5,66],[-23,66.5],[-20,63.2],[-30,59],[-44,59.5]],
            'https://marineregions.org/gazetteer.php?id=2355&p=details'),
        # A generalized ecosystem outline following the North Atlantic gyre,
        # not the rectangular administrative area of collaboration. Currents
        # shift; this remains explicitly marked as cartographic approximation.
        'sargassowe': ([[-76,28],[-75.5,30.5],[-73.5,33.5],[-70,36],[-66,38],
            [-61,38.5],[-56,38],[-51,36.5],[-47,34],[-44.5,31],[-43.5,28],
            [-44.5,25.5],[-48,23.5],[-53,22.3],[-59,22],[-64,22.5],
            [-69,23.5],[-73,25],[-76,28]],
            'https://www.sargassoseacommission.org/sargasso-sea'),
    }
    features = []
    for identifier, (ring, reference) in extents.items():
        geometry = Polygon(ring).difference(land).simplify(.005, preserve_topology=False)
        features.append({'type':'Feature','properties':{'id':identifier,'boundary_kind':'approximate','source':reference},'geometry':mapping(geometry)})

    # Koro crosses the date line. Two polygons avoid a spurious world-spanning edge.
    koro = unary_union([box(178.2,-19.3,180,-16.3),box(-180,-19.3,-178.5,-16.3)]).difference(land)
    features.append({'type':'Feature','properties':{'id':'koro','boundary_kind':'approximate',
        'source':'https://www.openstreetmap.org/node/4788181612','camera_bounds':[178.2,-19.3,181.5,-16.3]},'geometry':mapping(koro)})

    # Published coastal-water polygons supply the channels and islands. The
    # Salish-specific clipping extent remains an explicitly approximate overlay.
    with (CACHE / 'marine-iho.geojson').open('rb') as stream:
        coastal = next(f for f in ijson.items(stream,'features.item',use_float=True)
                       if 'southeast alaska' in f['properties']['name'].lower())
    salish_extent = Polygon([[-124.77,48.2],[-124.77,48.7],[-125.1,49.6],[-125.5,50.15],[-124.6,50.4],[-122.0,49.3],[-122.0,47.0],[-123.2,47.0],[-123.2,48.0],[-124.77,48.2]])
    salish = shape(coastal['geometry']).intersection(salish_extent).simplify(.005, preserve_topology=False)
    features.append({'type':'Feature','properties':{'id':'salish','boundary_kind':'approximate',
        'source':'https://salishsea.wwu.edu/salish-sea-surrounding-basin'},'geometry':mapping(salish)})

    cantabrian = json.loads((CACHE / 'marine-osm-kantabryjskie-polygon.json').read_bytes())[0]
    geometry = shape(cantabrian['geojson']).simplify(.005, preserve_topology=False)
    features.append({'type':'Feature','properties':{'id':'kantabryjskie','boundary_kind':'catalogue',
        'source':'https://www.openstreetmap.org/relation/4674330'},'geometry':mapping(geometry)})
    assert len(features) == 8 and all(shape(f['geometry']).is_valid and not shape(f['geometry']).is_empty for f in features)
    path = ROOT / 'data/challenges/morza-uzupelnienia.json'
    path.write_text(json.dumps({'type':'FeatureCollection','features':features},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print('Prepared', len(features), 'missing outlines;', path.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
