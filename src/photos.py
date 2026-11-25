"""Compressed local photos and portable photo archives; CSV stores references only."""
import base64
import csv
import hashlib
import io
import json
import re
import unicodedata
import zipfile
from pathlib import Path
from .photo_properties import read_properties, properties_exif, update_jpeg_properties, write_photo_atomic

MAX_UPLOAD = 25 * 1024 * 1024
MAX_TRIP_PHOTOS = 100
PHOTO_ID = re.compile(r'[a-f0-9]{64}')
METADATA_FIELDS = ('id', 'title', 'taken', 'description', 'tags')


def custom_tags(value):
    if isinstance(value, str):
        value = json.loads(value or '[]')
    if not isinstance(value, list) or len(value) > 50:
        raise ValueError('Invalid tags')
    result, seen = [], set()
    for tag in value:
        if not isinstance(tag, str) or any(unicodedata.category(char).startswith('C') for char in tag):
            raise ValueError('Invalid tag')
        name = ' '.join(unicodedata.normalize('NFKC', tag).split())
        if not 1 <= len(name) <= 60:
            raise ValueError('Invalid tag')
        identifier = name.casefold()
        if identifier not in seen:
            seen.add(identifier)
            result.append(name)
    return result


def photo_dir():
    from .atlas import USER_DATA
    return USER_DATA / 'photos'


def photo_path(identifier):
    if not isinstance(identifier, str) or not PHOTO_ID.fullmatch(identifier):
        raise ValueError('Invalid photo reference')
    return photo_dir() / (identifier + '.jpg')


def read_metadata():
    path = photo_dir() / 'opisy.csv'
    if not path.exists():
        return {}
    from .atlas import csv_note_needs_escape
    with path.open(encoding='utf-8-sig', newline='') as source:
        result = {}
        for row in csv.DictReader(source):
            if not PHOTO_ID.fullmatch(row.get('id', '')):
                continue
            item = {field: row.get(field, '') for field in METADATA_FIELDS}
            try:
                item['tags'] = json.dumps(custom_tags(item['tags']), ensure_ascii=False)
            except ValueError:
                item['tags'] = '[]'
            for field in ('title', 'description'):
                if item[field].startswith("'") and csv_note_needs_escape(item[field][1:]):
                    item[field] = item[field][1:]
            result[row['id']] = item
        return result


def write_metadata(metadata):
    from .atlas import write_csv, csv_note_needs_escape
    photo_dir().mkdir(parents=True, exist_ok=True)
    write_csv(photo_dir() / 'opisy.csv', METADATA_FIELDS,
              ({key: "'" + value if key in ('title', 'description') and csv_note_needs_escape(value) else value
                for key, value in item.items()} for item in metadata.values()))


def migrate_legacy_properties():
    from PIL import Image
    metadata = read_metadata()
    changed = False
    for identifier, item in metadata.items():
        if not item.get('title') and not item.get('taken'):
            continue
        path = photo_path(identifier)
        if not path.is_file():
            continue
        with Image.open(path) as image:
            native = read_properties(image)
        data = update_jpeg_properties(path.read_bytes(), native['title'] or item.get('title', ''), native['taken'] or item.get('taken', ''))
        write_photo_atomic(path, data)
        item['title'] = item['taken'] = ''
        changed = True
    if changed:
        write_metadata(metadata)


def photo_uses(rows):
    uses = {}
    for row in rows:
        for position, photo in enumerate(photo_refs(row.get('zdjecia'))):
            uses.setdefault(photo['id'], []).append({
                'category': row['kategoria'], 'id': row['id'], 'name': row.get('nazwa', ''),
                'caption': photo['caption'], 'position': position,
            })
    return uses


def trip_photo_tags(rows):
    from .atlas import diary_visits, trip_members
    visits, tags = diary_visits(rows), {}
    for row in rows:
        if row['kategoria'] != 'wycieczka':
            continue
        identifiers = {photo['id'] for photo in photo_refs(row.get('zdjecia'))}
        for key in trip_members(row):
            identifiers.update(photo['id'] for photo in photo_refs(visits.get(key, {}).get('zdjecia')))
        tag = {'id': 'trip:' + row['id'], 'name': row.get('nazwa', ''), 'kind': 'trip'}
        for identifier in identifiers:
            tags.setdefault(identifier, []).append(tag)
    return tags


def gallery(rows):
    from PIL import Image
    migrate_legacy_properties()
    metadata, uses = read_metadata(), photo_uses(rows)
    automatic_tags = trip_photo_tags(rows)
    result = []
    for path in photo_dir().glob('*.jpg'):
        if not PHOTO_ID.fullmatch(path.stem):
            continue
        try:
            with Image.open(path) as image:
                width, height = image.size
                properties = read_properties(image)
            stat = path.stat()
        except OSError:
            continue
        info = metadata.get(path.stem, {})
        occurrences = uses.get(path.stem, [])
        manual_tags = custom_tags(info.get('tags', ''))
        tags = automatic_tags.get(path.stem, []) + [
            {'id': 'manual:' + name.casefold(), 'name': name, 'kind': 'manual'} for name in manual_tags]
        result.append({'id': path.stem, 'title': properties['title'], 'taken': properties['taken'],
                       'description': info.get('description', next((use['caption'] for use in occurrences if use['caption']), '')),
                       'bytes': stat.st_size, 'width': width, 'height': height,
                       'uses': occurrences, 'modified': stat.st_mtime_ns,
                       'tags': tags, 'manualTags': manual_tags})
    result.sort(key=lambda item: (item['modified'], item['id']), reverse=True)
    deleted = sorted((photo_dir() / '.trash').glob('*.json'), key=lambda p: p.stat().st_mtime_ns, reverse=True)
    restorable = next((path.stem for path in deleted if (path.with_suffix('.jpg')).is_file()), None)
    return {'photos': result, 'deleted': restorable}


def update_gallery(change, rows):
    from .atlas import write_visits, validate_date
    if not isinstance(change, dict):
        raise ValueError
    identifier, action = change['id'], change['action']
    path = photo_path(identifier)
    if action == 'tags':
        if set(change) != {'id', 'action', 'tags'} or not path.is_file():
            raise ValueError
        tags = custom_tags(change['tags'])
        metadata = read_metadata()
        existing = metadata.get(identifier)
        if existing is None:
            uses = photo_uses(rows).get(identifier, [])
            existing = {'id': identifier, 'title': '', 'taken': '',
                        'description': next((use['caption'] for use in uses if use['caption']), '')}
        metadata[identifier] = {**existing, 'tags': json.dumps(tags, ensure_ascii=False)}
        write_metadata(metadata)
    elif action == 'update':
        fields = {'id', 'action', 'title', 'taken', 'description'}
        if set(change) not in (fields, fields | {'tags'}) or not path.is_file():
            raise ValueError
        for key, limit in (('title', 150), ('description', 500)):
            if not isinstance(change[key], str) or len(change[key]) > limit or '\x00' in change[key]:
                raise ValueError
        validate_date(change['taken'])
        original = path.read_bytes()
        native = update_jpeg_properties(original, change['title'], change['taken'])
        metadata = read_metadata()
        tags = custom_tags(change['tags'] if 'tags' in change else metadata.get(identifier, {}).get('tags', ''))
        previous_metadata = {key: value.copy() for key, value in metadata.items()}
        metadata[identifier] = {'id': identifier, 'title': '', 'taken': '', 'description': change['description'],
                                'tags': json.dumps(tags, ensure_ascii=False)}
        updated = []
        for row in rows:
            refs = photo_refs(row.get('zdjecia'))
            for photo in refs:
                if photo['id'] == identifier:
                    photo['caption'] = change['description']
            updated.append({**row, 'zdjecia': encoded_refs(refs, True)} if refs else row)
        write_visits(updated)
        try:
            write_metadata(metadata)
            if native != original:
                write_photo_atomic(path, native)
        except OSError:
            write_visits(rows)
            write_metadata(previous_metadata)
            raise
    elif action == 'delete':
        if set(change) != {'id', 'action'} or not path.is_file():
            raise ValueError
        trash = photo_dir() / '.trash'
        trash.mkdir(exist_ok=True)
        tombstone = trash / (identifier + '.json')
        tombstone.write_text(json.dumps(photo_uses(rows).get(identifier, []), ensure_ascii=False), encoding='utf-8')
        updated = []
        for row in rows:
            refs = photo_refs(row.get('zdjecia'))
            remaining = [photo for photo in refs if photo['id'] != identifier]
            updated.append({**row, 'zdjecia': encoded_refs(remaining, True)} if len(remaining) != len(refs) else row)
        write_visits(updated)
        try:
            path.replace(trash / path.name)
        except OSError:
            write_visits(rows)
            raise
    elif action == 'restore':
        if set(change) != {'id', 'action'}:
            raise ValueError
        archived = photo_dir() / '.trash' / path.name
        tombstone = archived.with_suffix('.json')
        if not archived.is_file() or not tombstone.is_file():
            raise ValueError
        record = json.loads(tombstone.read_text(encoding='utf-8'))
        replacement = record.get('replacement') if isinstance(record, dict) else None
        uses = record['uses'] if isinstance(record, dict) else record
        lookup = {(row['kategoria'], row['id']): row for row in rows}
        for use in uses:
            row = lookup.get((use['category'], use['id']))
            if row is None:
                continue
            refs = [ref for ref in photo_refs(row.get('zdjecia')) if ref['id'] != replacement]
            if any(ref['id'] == identifier for ref in refs) or len(refs) >= (100 if row['kategoria'] == 'wycieczka' else 1):
                continue
            refs.insert(min(use['position'], len(refs)), {'id': identifier, 'caption': use['caption']})
            row['zdjecia'] = encoded_refs(refs, True)
        archived.replace(path)
        write_visits(rows)
        if replacement and replacement not in photo_uses(rows) and photo_path(replacement).exists():
            photo_path(replacement).replace(photo_dir() / '.trash' / (replacement + '.jpg'))
        tombstone.unlink(missing_ok=True)
    else:
        raise ValueError


def photo_refs(value, multiple=True):
    if not value:
        return []
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, list) or len(value) > (MAX_TRIP_PHOTOS if multiple else 1):
        raise ValueError('Too many photos')
    result, seen = [], set()
    for item in value:
        if not isinstance(item, dict) or set(item) - {'id', 'caption'}:
            raise ValueError('Invalid photo')
        identifier, caption = item.get('id'), item.get('caption', '')
        photo_path(identifier)
        if identifier in seen or not isinstance(caption, str) or len(caption) > 500 or '\x00' in caption:
            raise ValueError('Invalid photo caption')
        seen.add(identifier)
        result.append({'id': identifier, 'caption': caption})
    return result


def encoded_refs(value, multiple=False):
    refs = photo_refs(value, multiple)
    return json.dumps(refs, ensure_ascii=False, separators=(',', ':')) if refs else ''


def store_photo(encoded, filename=""):
    from PIL import Image, ImageOps, UnidentifiedImageError
    if not isinstance(encoded, str) or len(encoded) > (MAX_UPLOAD * 4 // 3 + 8):
        raise ValueError('Photo too large')
    try:
        raw = base64.b64decode(encoded, validate=True)
        if not raw or len(raw) > MAX_UPLOAD:
            raise ValueError('Photo too large')
        with Image.open(io.BytesIO(raw)) as original:
            if original.width * original.height > 40_000_000:
                raise ValueError('Photo dimensions too large')
            properties = read_properties(original)
            if not properties["title"] and filename:
                properties["title"] = Path(filename.replace("\\", "/")).stem[:150]
            native_exif = properties_exif(properties["title"], properties["taken"], properties["time"]).tobytes()
            image = ImageOps.exif_transpose(original)
            image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            if image.mode in ('RGBA', 'LA') or 'transparency' in image.info:
                rgba = image.convert('RGBA')
                image = Image.new('RGB', rgba.size, 'white')
                image.paste(rgba, mask=rgba.getchannel('A'))
            else:
                image = image.convert('RGB')
        quality = 82
        while True:
            output = io.BytesIO()
            image.save(output, 'JPEG', quality=quality, optimize=True, progressive=True, exif=native_exif)
            data = output.getvalue()
            if len(data) <= 300 * 1024:
                break
            if quality > 50:
                quality -= 8
            else:
                image.thumbnail((max(1, int(image.width * .8)), max(1, int(image.height * .8))), Image.Resampling.LANCZOS)
                quality = 74
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError('Unsupported photo') from error
    identifier = hashlib.sha256(data).hexdigest()
    path = photo_path(identifier)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        write_photo_atomic(path, data)
    return {'id': identifier, 'caption': '', 'bytes': len(data), 'width': image.width, 'height': image.height}


def archive_photos(rows, destination):
    migrate_legacy_properties()
    references = {}
    manifest = io.StringIO(newline='')
    writer = csv.writer(manifest)
    writer.writerow(('photo', 'category', 'place_id', 'name', 'caption'))
    for row in rows:
        for photo in photo_refs(row.get('zdjecia')):
            references.setdefault(photo['id'], []).append((row, photo))
    with zipfile.ZipFile(destination, 'w', allowZip64=True) as archive:
        if (photo_dir() / 'opisy.csv').exists():
            archive.write(photo_dir() / 'opisy.csv', 'photos/opisy.csv', compress_type=zipfile.ZIP_DEFLATED)
        for path in sorted(photo_dir().glob('*.jpg')):
            if not PHOTO_ID.fullmatch(path.stem):
                continue
            name = 'photos/' + path.name
            archive.write(path, name, compress_type=zipfile.ZIP_STORED)
            for row, photo in references.get(path.stem, [({}, {})]):
                values = (name, row.get('kategoria', ''), row.get('id', ''), row.get('nazwa', ''), photo.get('caption', ''))
                writer.writerow(["'" + v if v.lstrip().startswith(('=', '+', '-', '@')) else v for v in values])
        archive.writestr('photos.csv', manifest.getvalue().encode('utf-8-sig'), compress_type=zipfile.ZIP_DEFLATED)
