"""Prepare worldwide offline subregions; never downloads data at app runtime.

Run after prepare_subregions.py. Requires shapely, pyshp and pyproj only here.
Original region/subregion IDs and geometry are retained. Source versions,
licenses and coverage are shipped with the map, rather than inferred at runtime.
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import gzip
import io
import json
import sqlite3
import sys
from pathlib import Path
import time
from urllib.request import Request, urlopen
import zipfile

from shapely.geometry import shape, mapping
from shapely import make_valid, transform

from prepare_subregions import ROOT, CACHE, LOCAL_COUNTRIES, GROUPED_COUNTRIES

COMPACT = set('VA MC SM LI AD MT SG BH MV NR TV MH PW KN GD VC BB AG DM SC ST FM LC'.split())
SPECIAL = {'DE', 'CA', 'UA'}


def persist_boundaries(data):
    sys.path.insert(0,str(ROOT))
    from src.admin_boundaries import encode_geometry
    countries={row[5]:row[0] for row in json.loads((ROOT/'data/maps/mapa.json').read_bytes())['panstwo']}
    target=ROOT/'data/maps/podregiony.sqlite3'
    temporary=target.with_suffix('.sqlite3.tmp')
    if temporary.exists():temporary.unlink()
    index=[]
    with sqlite3.connect(temporary) as db:
        db.executescript('''CREATE TABLE boundaries(id TEXT UNIQUE NOT NULL,country_id TEXT NOT NULL,geometry BLOB NOT NULL);
            CREATE VIRTUAL TABLE boundary_bounds USING rtree(place,min_lon,max_lon,min_lat,max_lat);''')
        for f in data['features']:
            p=f['properties']
            if not p.get('name'):
                print('UNNAMED',p['country'],p['id'],p.get('alias'),flush=True)
                p['name']=p.get('alias') or 'Unnamed subregion'
            p['alias']=p.get('alias') or p['name']
            if not p['id'].startswith(('gb-world:', 'nuts:', 'statcan:', 'ocha:')):
                index.append(f);continue
            geometry=f['geometry']
            polygons=geometry['coordinates'] if geometry['type']=='MultiPolygon' else [geometry['coordinates']]
            extents=[]
            for rings in polygons:
                xs,ys=zip(*rings[0]);extents.append([min(xs),min(ys),max(xs),max(ys)])
            bbox=[min(b[0] for b in extents),min(b[1] for b in extents),max(b[2] for b in extents),max(b[3] for b in extents)]
            rowid=db.execute('INSERT INTO boundaries VALUES(?,?,?)',(p['id'],countries[p['country']],encode_geometry(geometry))).lastrowid
            db.execute('INSERT INTO boundary_bounds VALUES(?,?,?,?,?)',(rowid,bbox[0],bbox[2],bbox[1],bbox[3]))
            index.append({**f,'geometry':None,'bbox':bbox,'bboxes':extents})
        db.execute('CREATE INDEX boundary_country ON boundaries(country_id)')
    db.close()
    temporary.replace(target)
    data={**data,'features':index}
    destination=ROOT/'data/maps/rejony.json.gz'
    partial=destination.with_suffix('.gz.tmp')
    partial.write_bytes(gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
    partial.replace(destination)
    print('Indexed',len(index),'database MB',round(target.stat().st_size/1e6,1),'catalogue MB',round(destination.stat().st_size/1e6,1),flush=True)


def download(name, url):
    path = CACHE / name
    if path.exists():
        return path
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers={'User-Agent': 'IKE-Travel-Tracker boundary preparation'}), timeout=120) as response:
                content = response.read()
            partial = path.with_suffix(path.suffix + '.tmp')
            partial.write_bytes(content)
            partial.replace(path)
            return path
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1 + attempt)


def inputs():
    raw = json.loads((CACHE / 'natural-earth-adm1.geojson').read_bytes())['features']
    codes = {f['properties']['adm0_a3']: f['properties']['iso_a2'] for f in raw}
    codes.update(PSE='PS', SSD='SS', XKX='XK')
    catalogue = json.loads((CACHE / 'gbOpen-ADM2-catalogue.json').read_bytes())
    third = {m['boundaryISO']: m for m in json.loads((CACHE / 'gbOpen-ADM3-catalogue.json').read_bytes())}
    base = json.loads(gzip.decompress((ROOT / 'data/maps/rejony.json.gz').read_bytes()))
    counts = Counter(f['properties']['country'] for f in base['features'] if f['properties']['level'] == 'region')
    already = {f['properties']['country'] for f in base['features'] if f['properties']['level'] == 'subregion' and not f['properties']['id'].startswith(('gb-world:', 'nuts:', 'statcan:', 'ocha:'))}
    selected = []
    for meta in catalogue:
        code = codes.get(meta['boundaryISO'])
        if not code or code in already | COMPACT | SPECIAL or code not in counts:
            continue
        # Some sources put the same provinces in ADM1 and ADM2. Use their next
        # genuine subdivision instead of duplicating the regional outlines.
        if int(meta['admUnitCount']) <= counts[code]:
            meta = third.get(meta['boundaryISO'])
            if not meta or int(meta['admUnitCount']) <= counts[code]:
                continue
        selected.append((code, meta))
    return base, selected


def catalogue_path(meta):
    return f"global-{meta['boundaryISO']}-{meta['boundaryType']}.geojson"


def reduced(geometry):
    geometry = shape(geometry)
    if not geometry.is_valid:
        geometry = make_valid(geometry)
    if geometry.geom_type == 'GeometryCollection':
        from shapely.ops import unary_union
        geometry = unary_union([g for g in geometry.geoms if g.geom_type in ('Polygon', 'MultiPolygon')])
    if geometry.is_empty or geometry.geom_type not in ('Polygon', 'MultiPolygon'):
        return None
    return geometry.simplify(.001, preserve_topology=True)


def rounded(value):
    if isinstance(value, (list, tuple)):
        return [rounded(x) for x in value]
    return round(value, 5) if isinstance(value, float) else value


def specials():
    german = json.loads((CACHE / 'germany-nuts3.geojson').read_bytes())['features']
    for f in german:
        p = f['properties']
        if p['CNTR_CODE'] == 'DE':
            yield 'DE', 'nuts:DE:2024:' + p['NUTS_ID'], p['NUTS_NAME'], f['geometry']
    ukraine = zipfile.ZipFile(CACHE / 'ukraine-boundaries.zip')
    for f in json.loads(ukraine.read('ukr_admin2.geojson'))['features']:
        p = f['properties']
        yield 'UA', 'ocha:' + p['adm2_pcode'], p['adm2_name1'] or p['adm2_name'], f['geometry'], p['adm2_name']
    import shapefile
    from pyproj import CRS, Transformer
    archive = zipfile.ZipFile(CACHE / 'canada-divisions.zip')
    stem = 'lcd_000b21a_e'
    reader = shapefile.Reader(shp=io.BytesIO(archive.read(stem+'.shp')), dbf=io.BytesIO(archive.read(stem+'.dbf')), encoding='latin-1')
    projection = Transformer.from_crs(CRS.from_wkt(archive.read(stem+'.prj').decode()), 4326, always_xy=True)
    for record in reader.iterShapeRecords():
        p = record.record.as_dict()
        # Simplify in metres before projection to avoid retaining millions of
        # coastal vertices that cannot be seen at the subregion map scale.
        geometry = transform(shape(record.shape.__geo_interface__).simplify(100, preserve_topology=False),
                             projection.transform, interleaved=False)
        print('Canada', p['CDUID'], flush=True)
        yield 'CA', 'statcan:CA:CD:' + p['CDUID'], p['CDNAME'], mapping(geometry)


def generate(base, selected):
    features = [f for f in base['features'] if not f['properties']['id'].startswith(('gb-world:', 'nuts:', 'statcan:', 'ocha:'))]
    regions = defaultdict(list)
    for f in features:
        p = f['properties']
        if p['level'] == 'region':
            regions[p['country']].append((p['id'], shape(f['geometry'])))
    def append(code, identifier, name, raw, alias=None):
        geometry = reduced(raw)
        if geometry is None:
            raise ValueError('Empty boundary: ' + identifier)
        point = geometry.representative_point()
        parents = regions[code]
        # Russia datasets must never import units located in Ukrainian Crimea.
        if code == 'RU' and 32 < point.x < 37 and 44 < point.y < 47 and any(g.covers(point) for _, g in regions['UA']):
            return
        containing = [(id, g) for id, g in parents if g.covers(point)]
        if containing:
            parent = containing[0][0]
        else:
            parent, nearest = min(parents, key=lambda item: item[1].distance(point))
            # Exclude overseas territories bundled in USA county data; each
            # territory belongs to its own country entry in the atlas.
            if code == 'US' and nearest.distance(point) > .1:
                return
        features.append({'type': 'Feature', 'properties': {
            'id': identifier, 'name': name, 'alias': alias or name, 'country': code,
            'lon': round(point.x, 6), 'lat': round(point.y, 6), 'level': 'subregion', 'parent_id': parent,
        }, 'geometry': rounded(mapping(geometry))})
    for code, meta in selected:
        data = json.loads((CACHE / catalogue_path(meta)).read_bytes())
        for f in data['features']:
            p = f['properties']
            append(code, f"gb-world:{code}:{meta['boundaryType']}:{p['shapeID']}", p['shapeName'], f['geometry'])
        print(code, len(data['features']), flush=True)
    for item in specials():
        append(*item)
    base['features'] = features
    persist_boundaries(base)
    source_path = ROOT / 'data/maps/podregiony-zrodla.json'
    sources = json.loads(source_path.read_bytes())
    sources['sources'] = [s for s in sources['sources'] if not s.get('globalSubregions')]
    for code, meta in selected:
        sources['sources'].append({'name': f"geoBoundaries {meta['boundaryISO']} {meta['boundaryType']}",
            'globalSubregions': True, 'country': code, 'url': meta['simplifiedGeometryGeoJSON'],
            'license': meta['boundaryLicense'], 'licenseSource': meta['licenseSource'],
            'boundaryID': meta['boundaryID'], 'boundaryYearRepresented': meta['boundaryYearRepresented']})
    sources['sources'].extend([
        {'name': 'Eurostat GISCO NUTS 2024 level 3', 'country':'DE', 'globalSubregions':True,
         'url':'https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2024_4326_LEVL_3.geojson',
         'license':'© EuroGeographics for the administrative boundaries; Eurostat GISCO reuse policy'},
        {'name':'Statistics Canada census divisions 2021', 'country':'CA', 'globalSubregions':True,
         'url':'https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm',
         'license':'Statistics Canada Open Licence', 'boundaryYearRepresented':'2021'},
        {'name':'OCHA Ukraine COD-AB v05', 'country':'UA', 'globalSubregions':True,
         'url':'https://data.humdata.org/dataset/cod-ab-ukr', 'license':'Creative Commons Attribution for Intergovernmental Organisations',
         'boundaryYearRepresented':'2025-09-01'},
    ])
    coverage = defaultdict(Counter)
    for f in features:
        coverage[f['properties']['country']][f['properties']['level']] += 1
    sources['coverage'] = {code: dict(counts) for code, counts in sorted(coverage.items())}
    sources['geometryStorage']='podregiony.sqlite3'
    sources['unnamedSubregions']=sum(f['properties']['name']=='Unnamed subregion' for f in features)
    source_path.write_text(json.dumps(sources, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print('TOTAL', len(features), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--download-only', action='store_true')
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    for level in (2, 3):
        download(f'gbOpen-ADM{level}-catalogue.json', f'https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM{level}/')
    download('germany-nuts3.geojson', 'https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2024_4326_LEVL_3.geojson')
    hdx = json.loads(download('ukraine-hdx.json', 'https://data.humdata.org/api/3/action/package_show?id=cod-ab-ukr').read_bytes())['result']
    download('ukraine-boundaries.zip', next(r['url'] for r in hdx['resources'] if 'geojson' in r['name']))
    # This mirror distributes the unmodified Statistics Canada boundary ZIP;
    # the original source and licence remain recorded in the shipped manifest.
    download('canada-divisions.zip', 'https://data.source.coop/dataforcanada/d4c-datapkg-statistical/archive/statcan/boundaries/2021/lcd_000b21a_e.zip')
    base, selected = inputs()
    errors = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs = {pool.submit(download, catalogue_path(meta), meta['simplifiedGeometryGeoJSON']): code for code, meta in selected}
        for job in as_completed(jobs):
            try:
                result = job.result()
                print(jobs[job], result.stat().st_size, flush=True)
            except Exception as error:
                errors.append((jobs[job], str(error)))
    if errors:
        raise RuntimeError(errors)
    if not args.download_only:
        generate(base, selected)


if __name__ == '__main__':
    main()
