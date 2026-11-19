"""Generate offline Latin-script readings for the bundled settlement catalogues.

Build-time dependencies: uroman, pykakasi, pypinyin, hanja.
The application reads only the generated JSON and needs no extra Python packages.
"""

import gzip
import json
import re
import sqlite3
import unicodedata
from pathlib import Path

import pykakasi
import uroman
import hanja
from pypinyin import Style, lazy_pinyin

ROOT = Path(__file__).resolve().parents[1]
MAPS = ROOT / "data" / "maps"
LANGUAGES = {"RU": "rus", "UA": "ukr", "BY": "bel", "BG": "bul", "MK": "mkd", "RS": "srp",
             "KZ": "kaz", "KG": "kir", "TJ": "tgk", "IR": "fas", "AF": "fas", "PK": "urd",
             "IL": "heb", "GR": "ell", "CY": "ell", "KR": "kor", "KP": "kor", "GE": "kat",
             "AM": "hye", "TH": "tha", "MM": "mya", "KH": "khm", "LA": "lao", "MN": "mon"}
LANGUAGES.update(dict.fromkeys("SA AE EG IQ MA JO SY LB YE OM QA KW PS TN DZ LY SD".split(), "ara"))


def non_latin(text):
    return any(character.isalpha() and "LATIN" not in unicodedata.name(character, "") for character in text)


def main():
    names = set()

    def add(country, name):
        if isinstance(name, str) and non_latin(name):
            names.add((country or "", name.strip()))

    for filename in ("miasta-polska.json.gz", "duze-miasta.json.gz", "stolice.json.gz", "obrysy-miast.json.gz", "obrysy-wsi.json.gz"):
        for feature in json.loads(gzip.decompress((MAPS / filename).read_bytes()))["features"]:
            props = feature["properties"]
            add(props.get("country"), props.get("@name") or props.get("name"))
    for filename, country_column in (("miasta-swiat.sqlite3", "label"), ("miejscowosci.sqlite3", "'PL'")):
        with sqlite3.connect(MAPS / filename) as database:
            for name, country in database.execute(f"SELECT name, {country_column} FROM settlements"):
                add(country, name)
    for row in json.loads((MAPS / "mapa.json").read_text(encoding="utf-8"))["miasto"]:
        add(row[5], row[1])
        add(row[5], row[7])

    romanizer = uroman.Uroman()
    japanese = pykakasi.kakasi()
    countries, variants = {}, {}
    for index, (country, name) in enumerate(sorted(names)):
        if country == "JP" or re.search(r"[\u3040-\u30ff]", name):
            reading = " ".join(chunk["hepburn"] for chunk in japanese.convert(name))
        elif country in ("KR", "KP"):
            reading = romanizer.romanize_string(hanja.translate(name, "substitution"), lcode="kor")
        elif re.search(r"[\u3400-\u9fff]", name) and country not in ("KR", "KP"):
            reading = " ".join(lazy_pinyin(name, style=Style.TONE))
            reading = romanizer.romanize_string(reading) if non_latin(reading) else reading
            # A few bilingual Chinese/New Tai Lue labels repeat the same name.
            # Keep the complete Pinyin name when no New Tai Lue reading is available.
            if non_latin(reading):
                reading = "".join(character for character in reading
                                  if not character.isalpha() or "LATIN" in unicodedata.name(character, ""))
        else:
            reading = romanizer.romanize_string(name, lcode=LANGUAGES.get(country))
        reading = " ".join(reading.split()).strip()
        if reading and not non_latin(reading):
            reading = reading[0].upper() + reading[1:]
            countries.setdefault(country, {})[name] = reading
            variants.setdefault(name, set()).add(reading)
        if index and index % 5000 == 0:
            print(f"Prepared {index} / {len(names)} readings", flush=True)
    data = {"byCountry": countries, "byName": {name: next(iter(values)) for name, values in variants.items() if len(values) == 1}}
    target = MAPS / "odczyt-nazw.json.gz"
    encoded = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    target.write_bytes(gzip.compress(encoded, compresslevel=9, mtime=0))
    print(f"Prepared {sum(len(values) for values in countries.values())} readings; {target.stat().st_size} compressed bytes", flush=True)


if __name__ == "__main__":
    main()
