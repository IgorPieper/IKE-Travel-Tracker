"""Read image properties and update JPEG EXIF without recompressing pixels."""
import io
import os
import re
import tempfile
from datetime import date

from PIL import Image


def _text(value, *, wide=False):
    if isinstance(value, (bytes, tuple, list)):
        raw = bytes(value)
        value = raw.decode('utf-16le' if wide else 'utf-8', errors='replace')
    return value.strip('\x00 \r\n') if isinstance(value, str) else ''


def read_properties(image):
    exif = image.getexif()
    title = _text(exif.get(40091), wide=True) or _text(exif.get(270)) or _text(image.info.get('Title'))
    details = exif.get_ifd(34665) if 34665 in exif else {}
    timestamp = _text(details.get(36867) or exif.get(36867) or exif.get(306) or image.info.get('Creation Time'))
    taken = ''
    match = re.match(r'^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?', timestamp)
    if match:
        try:
            taken = date(*map(int, match.group(1, 2, 3))).isoformat()
        except ValueError:
            pass
    return {'title': title[:150], 'taken': taken, 'time': match.group(4) if match and match.group(4) else '00:00:00'}


def properties_exif(title, taken, time='00:00:00', exif=None):
    exif = Image.Exif() if exif is None else exif
    if title:
        exif[40091] = (title + '\x00').encode('utf-16le')  # Windows: Properties → Details → Title.
        exif[270] = title.encode('ascii', errors='replace').decode('ascii')
    else:
        for tag in (40091, 270):
            if tag in exif:
                del exif[tag]
    details = dict(exif.get_ifd(34665)) if 34665 in exif else {}
    if taken:
        timestamp = taken.replace('-', ':') + ' ' + time
        exif[306] = timestamp
        details[36867] = timestamp  # EXIF DateTimeOriginal: date taken.
        details[36868] = timestamp
    else:
        if 306 in exif:
            del exif[306]
        for tag in (36867, 36868):
            details.pop(tag, None)
    for tag in (36867, 36868):
        if tag in exif:
            del exif[tag]
    if details:
        exif[34665] = details
    elif 34665 in exif:
        del exif[34665]
    return exif


def update_jpeg_properties(raw, title, taken):
    with Image.open(io.BytesIO(raw)) as image:
        current = read_properties(image)
        if (current['title'], current['taken']) == (title, taken):
            return raw
        exif = properties_exif(title, taken, current['time'], image.getexif()).tobytes()
    if not raw.startswith(b'\xff\xd8') or len(exif) + 2 > 65535:
        raise ValueError('Invalid JPEG metadata')
    result = bytearray(raw[:2] + b'\xff\xe1' + (len(exif) + 2).to_bytes(2, 'big') + exif)
    offset = 2
    while offset < len(raw):
        start = offset
        if raw[offset] != 255:
            raise ValueError('Invalid JPEG marker')
        while offset < len(raw) and raw[offset] == 255:
            offset += 1
        if offset >= len(raw):
            raise ValueError('Invalid JPEG marker')
        marker = raw[offset]
        offset += 1
        if marker in (0xDA, 0xD9):  # Preserve scan data byte for byte.
            result.extend(raw[start:])
            return bytes(result)
        if marker in (0x01, *range(0xD0, 0xD9)):
            result.extend(raw[start:offset])
            continue
        length = int.from_bytes(raw[offset:offset + 2], 'big')
        end = offset + length
        if length < 2 or end > len(raw):
            raise ValueError('Invalid JPEG segment')
        if marker != 0xE1 or raw[offset + 2:offset + 8] != b'Exif\x00\x00':
            result.extend(raw[start:end])
        offset = end
    raise ValueError('Missing JPEG scan')


def write_photo_atomic(path, data):
    handle, temporary = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    try:
        with os.fdopen(handle, 'wb') as output:
            output.write(data)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
