"""Viewport queries for offline administrative boundaries."""
import math
from array import array
from contextlib import closing
import sqlite3
import sys
import zlib


def encode_geometry(geometry):
    polygons = geometry['coordinates'] if geometry['type']=='MultiPolygon' else [geometry['coordinates']]
    values = array('i', [len(polygons)])
    for rings in polygons:
        values.append(len(rings))
        for ring in rings:
            values.append(len(ring))
            x0=y0=0
            for x,y in ring:
                x,y=round(x*100000),round(y*100000)
                values.extend((x-x0,y-y0));x0,y0=x,y
    if sys.byteorder!='little':values.byteswap()
    return zlib.compress(values.tobytes(),6)


def decode_geometry(blob):
    values=array('i');values.frombytes(zlib.decompress(blob))
    if sys.byteorder!='little':values.byteswap()
    offset=1;polygons=[]
    for _ in range(values[0]):
        rings=[];count=values[offset];offset+=1
        for _ in range(count):
            ring=[];length=values[offset];offset+=1;x=y=0
            for _ in range(length):
                x+=values[offset];y+=values[offset+1];offset+=2
                ring.append([x/100000,y/100000])
            rings.append(ring)
        polygons.append(rings)
    return {'type':'MultiPolygon','coordinates':polygons}


def database_path():
    from .atlas import ROOT
    return ROOT/'data/maps/podregiony.sqlite3'


def boundary_geometry(identifier):
    with closing(sqlite3.connect(database_path().as_uri()+'?mode=ro',uri=True)) as db:
        row=db.execute('SELECT geometry FROM boundaries WHERE id=?',(identifier,)).fetchone()
    if row is None:raise ValueError('Unknown subregion')
    return decode_geometry(row[0])


def hydrate_features(data):
    features=[]
    with closing(sqlite3.connect(database_path().as_uri()+'?mode=ro',uri=True)) as db:
        for feature in data['features']:
            if feature['geometry'] is None:
                row=db.execute('SELECT geometry FROM boundaries WHERE id=?',(feature['properties']['id'],)).fetchone()
                if row is None:continue
                feature={**feature,'geometry':decode_geometry(row[0])}
            features.append(feature)
    return {**data,'features':features}


def subregion_at(lon,lat,country_id):
    from .atlas import region_at,polygon_bounds
    path=database_path()
    if not path.exists():return None
    with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)) as db:
        rows=db.execute('''SELECT id,geometry FROM boundary_bounds JOIN boundaries ON boundaries.rowid=boundary_bounds.place
            WHERE min_lon<=? AND max_lon>=? AND min_lat<=? AND max_lat>=? AND country_id=?''',
            (lon,lon,lat,lat,country_id))
        for id,blob in rows:
            if region_at(lon,lat,polygon_bounds(id,decode_geometry(blob))):return id
    return None


def viewport_features(index, params):
    bounds = [float(x) for x in params.get('bbox', ['-180,-90,180,90'])[0].split(',')]
    if len(bounds) != 4 or not all(math.isfinite(x) for x in bounds):
        raise ValueError('Invalid bounds')
    west, south, east, north = bounds
    if not (-90 <= south <= north <= 90) or east < west:
        raise ValueError('Invalid bounds')
    levels = set(params.get('levels', [''])[0].split(',')) & {'region', 'subregion'}
    ids = set(params.get('ids', [''])[0].split(','))
    country = params.get('country', [''])[0]
    parent = params.get('parent', [''])[0]
    features = []
    for feature, extents in index:
        props = feature['properties']
        selected = props['id'] in ids
        if not selected and (props.get('level', 'region') not in levels or (country and props['country'] != country)
                             or (parent and props.get('parent_id') != parent)):
            continue
        # Longitude copies matter when panning across the date line.
        if selected or any(b[1] <= north and b[3] >= south and any(
                b[0]+shift <= east and b[2]+shift >= west for shift in (-360, 0, 360)) for b in extents):
            features.append(feature)
    return {'type': 'FeatureCollection', 'features': features}
