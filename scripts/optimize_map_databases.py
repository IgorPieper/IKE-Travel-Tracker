"""Repack static geometry without changing any coordinate, ID or search index.

Creates and verifies separate copies first. Stop the app before replacing the
originals with the resulting files. The application also reads older databases.
"""
import argparse
import json
from pathlib import Path
import sqlite3
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.geometry_codec import pack_geometry, decode_geometry


def optimize(source, destination):
    started = time.perf_counter()
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as original, sqlite3.connect(destination) as target:
        original.backup(target)
        table = 'water' if source.stem == 'hydrografia' else 'settlements'
        changed = 0
        for rowid, blob in original.execute(f'SELECT rowid, geometry FROM {table}'):
            encoded = pack_geometry(blob)
            if encoded == blob:
                continue
            if decode_geometry(encoded) != decode_geometry(blob):
                raise ValueError(f'Geometry changed: {source.name}, row {rowid}')
            target.execute(f'UPDATE {table} SET geometry=? WHERE rowid=?', (encoded, rowid))
            changed += 1
        target.commit()
        target.execute('VACUUM')
        if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError(f'Integrity check failed: {destination}')
        # Verify persisted values and every RTree/metadata/search column as well.
        names = [column[1] for column in target.execute(f'PRAGMA table_info({table})')]
        index = names.index('geometry') + 1
        for before, after in zip(original.execute(f'SELECT rowid, * FROM {table} ORDER BY rowid'), target.execute(f'SELECT rowid, * FROM {table} ORDER BY rowid'), strict=True):
            if before[:index] != after[:index] or before[index+1:] != after[index+1:] or decode_geometry(before[index]) != decode_geometry(after[index]):
                raise ValueError(f'Persisted data changed: {destination}')
    return {'file': source.name, 'before': source.stat().st_size, 'after': destination.stat().st_size,
            'repacked': changed, 'seconds': round(time.perf_counter() - started, 2)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    for name in ('miasta-swiat', 'miejscowosci', 'hydrografia'):
        result = optimize(ROOT / f'data/maps/{name}.sqlite3', args.output / f'{name}.sqlite3')
        results.append(result)
        print(json.dumps(result), flush=True)
    (args.output / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
