"""Bounded, version-aware HTTP caching for local, read-only application assets."""
import gzip
import json
from functools import lru_cache


def accepts_gzip(header):
    for item in header.lower().split(','):
        name, *parameters = item.strip().split(';')
        if name != 'gzip':
            continue
        try:
            return not any(parameter.strip().startswith('q=') and float(parameter.strip()[2:]) <= 0
                           for parameter in parameters)
        except ValueError:
            return False
    return False


@lru_cache(maxsize=24)
def asset_body(path, modified, size, inode, encoded, compress):
    body = path.read_bytes()
    if path.suffix == '.gz':
        return body if encoded else gzip.decompress(body)
    return gzip.compress(body, compresslevel=4, mtime=0) if compress else body


def send_asset(handler, path, media_type, *, cache='no-cache'):
    stat = path.stat()
    encoded = accepts_gzip(handler.headers.get('Accept-Encoding', ''))
    compress = encoded and stat.st_size >= 1024 and (media_type.startswith('text/') or 'json' in media_type)
    # Explicit .gz downloads are archives; only JSON routes have content encoding.
    precompressed = path.suffix == '.gz' and media_type != 'application/gzip'
    if path.suffix == '.gz' and not precompressed:
        encoded = True
    etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}-{stat.st_ino:x}-{"gz" if encoded and (compress or precompressed) else "raw"}"'
    if handler.headers.get('If-None-Match') == etag:
        handler.send_response(304)
        handler.send_header('ETag', etag)
        handler.send_header('Cache-Control', cache)
        handler.send_header('Vary', 'Accept-Encoding')
        handler.end_headers()
        return
    body = asset_body(path, stat.st_mtime_ns, stat.st_size, stat.st_ino, encoded, compress)
    handler.send_data(body, media_type, encoding='gzip' if compress or (precompressed and encoded) else None,
                      cache=cache, etag=etag)


@lru_cache(maxsize=2)
def basemap_layer(path, modified, size, kind):
    data = json.loads(gzip.decompress(path.read_bytes()))
    features = [f for f in data['features'] if (f['properties'].get('kind') == 'country') == (kind == 'country')]
    body = json.dumps({'type': 'FeatureCollection', 'features': features}, ensure_ascii=False, separators=(',', ':')).encode()
    return body, gzip.compress(body, compresslevel=4, mtime=0)
