import csv
import gzip
import hashlib
import io
import json
import math
import random
import os
import re
import socket
import sys
import sqlite3
import tempfile
import threading
import time
import traceback
import unicodedata
import webbrowser
import zlib
import zipfile
import xml.etree.ElementTree as ET
from contextlib import closing
from datetime import date, timedelta
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from urllib.request import build_opener
from .branding import APP_NAME
from .http_assets import accepts_gzip, send_asset, basemap_layer
from .geometry_codec import decode_geometry
from .photos import photo_refs, encoded_refs, photo_path, photo_thumbnail, store_photo, archive_photos, gallery, update_gallery

ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]
INSTANCE_KEY = hashlib.sha256(os.fsencode(str(ROOT).casefold())).hexdigest()
USER_DATA = ROOT / "data" / "user"
MAP_DATA = ROOT / "data" / "maps"
CSV = USER_DATA / "odwiedzone.csv"
SETTINGS = USER_DATA / "ustawienia.csv"
ACHIEVEMENTS = ROOT / "config" / "osiagniecia.csv"
SETTLEMENTS = MAP_DATA / "miejscowosci.sqlite3"
WORLD_CITIES = MAP_DATA / "miasta-swiat.sqlite3"
HYDROGRAPHY = MAP_DATA / "hydrografia.sqlite3"
VISIT_DETAILS = ("data", "ocena", "notatka", "data_niepewna")
PIN_DETAILS = ("opis_krotki", "opis_dlugi", "kolor")
FIELDS = ("kategoria", "id", "nazwa", "lon", "lat", "panstwo_id", "tryb", *VISIT_DETAILS, *PIN_DETAILS,
          "data_konca", "data_konca_niepewna", "miejsca", "kolejne_wizyty", "zdjecia")
MAP_CATEGORIES = ("kontynent", "panstwo", "rejon", "miasto")
SKIP_LINKED = "pomin_auto"
SETTINGS_FIELDS = ("widok", "min_zoom", "maks_zoom", "widoczny", "wartosc")
DEFAULT_ZOOMS = {
    "continents": {"min": 0, "max": 4},
    "countries": {"min": 0, "max": 4},
    "regions": {"min": 1, "max": 12},
    "subregions": {"min": 0, "max": 19},
    "major": {"min": 4, "max": 12},
    "capital-cities": {"min": 0, "max": 16},
    "cities": {"min": 6, "max": 15},
    "settlements": {"min": 9, "max": 16},
    "visited": {"min": 0, "max": 16},
    "visited-only": {"min": 0, "max": 16},
    "planned-only": {"min": 0, "max": 16},
}
DEFAULT_VISIBILITY = dict.fromkeys((*DEFAULT_ZOOMS, "forests", "lakes", "rivers", "capitals", "warnings"), True)
DEFAULT_VISIBILITY["major"] = False
DEFAULT_VISIBILITY["subregions"] = False
DEFAULT_VISIBILITY["settlements"] = False
DEFAULT_VISIBILITY["regions"] = False
DEFAULT_VISIBILITY["cities"] = False
DEFAULT_VISIBILITY["seas"] = False
DEFAULT_VISIBILITY["visited-only"] = False
DEFAULT_VISIBILITY["planned-only"] = False
DEFAULT_LAYOUT = {"language": "en", "sidebar": "auto", "cyprus": "show"}
LAYOUT_VALUES = {"language": ("pl", "en"), "sidebar": ("auto", "open", "closed"), "cyprus": ("show", "hide")}
DEFAULT_LAYOUT["user_name"] = ""
LAYOUT_VALUES["user_name"] = ()
DEFAULT_LAYOUT["editor_auto_close"] = "on"
LAYOUT_VALUES["editor_auto_close"] = ("off", "on")
for section in ("map-view", "challenges-view", "diary-view", "achievements-view", "gallery-view"):
    DEFAULT_LAYOUT["nav_" + section] = "more" if section == "gallery-view" else "top"
    LAYOUT_VALUES["nav_" + section] = ("top",) if section == "map-view" else ("top", "more", "hidden")
for kind, value in (("regions", "3"), ("subregions", "6"), ("cities", "7"), ("villages", "9")):
    DEFAULT_LAYOUT["render_" + kind] = value
    LAYOUT_VALUES["render_" + kind] = tuple(f"{step / 2:g}" for step in range(33))
DEFAULT_LAYOUT["achievement_notifications"] = "on"
DEFAULT_LAYOUT['seas_simple'] = 'on'
LAYOUT_VALUES['seas_simple'] = ('off', 'on')
DEFAULT_LAYOUT['map_simple'] = 'off'
LAYOUT_VALUES['map_simple'] = ('off', 'on')
LAYOUT_VALUES["achievement_notifications"] = ("off", "on")
DEFAULT_LAYOUT["developer_panel"] = "off"
LAYOUT_VALUES["developer_panel"] = ("off", "on")
for feature in ("online_water", "online_details"):
    DEFAULT_LAYOUT[feature] = "on"
    LAYOUT_VALUES[feature] = ("off", "on")
for kind in ("continents", "countries", "regions", "subregions", "major", "cities", "villages", "pins", "trips", "visited", "planned"):
    DEFAULT_LAYOUT[f"diary_filter_{kind}"] = "on"
    LAYOUT_VALUES[f"diary_filter_{kind}"] = ("off", "on")
for challenge in ("parks", "bliza", "islands", "hewelion", "castles", "seas"):
    DEFAULT_LAYOUT[f"pin_{challenge}"] = "off"
    LAYOUT_VALUES[f"pin_{challenge}"] = ("off", "on")
CASTLE_TIERS = ("outstanding", "open", "irregular", "ruins")
for tier in CASTLE_TIERS:
    DEFAULT_LAYOUT[f"castle_{tier}"] = "show"
    LAYOUT_VALUES[f"castle_{tier}"] = ("show", "hide")
ASSETS = {
    "/LICENSE.md": ("LICENSE.md", "text/plain; charset=utf-8"),
    "/": ("web/index.html", "text/html; charset=utf-8"),
    "/mapa.css": ("web/css/mapa.css", "text/css; charset=utf-8"),
    "/mapa.js": ("web/js/mapa.js", "text/javascript; charset=utf-8"),
    "/stolice-dzielnice.json.gz": ("data/maps/stolice-dzielnice.json.gz", "application/gzip"),
    "/obszar.js": ("web/js/obszar.js", "text/javascript; charset=utf-8"),
    "/jezyk.js": ("web/js/jezyk.js", "text/javascript; charset=utf-8"),
    "/zdjecia.js": ("web/js/zdjecia.js", "text/javascript; charset=utf-8"),
    "/nawigacja.js": ("web/js/nawigacja.js", "text/javascript; charset=utf-8"),
    "/galeria.js": ("web/js/galeria.js", "text/javascript; charset=utf-8"),
    "/wyzwania.js": ("web/js/wyzwania.js", "text/javascript; charset=utf-8"),
    "/dziennik.js": ("web/js/dziennik.js", "text/javascript; charset=utf-8"),
    "/parki-wyzwanie.json": ("data/challenges/parki-wyzwanie.json.gz", "application/geo+json"),
    "/atrakcje-parkow.json": ("data/challenges/atrakcje-parkow.json", "application/json"),
    "/latarnie-wyzwanie.json": ("data/challenges/latarnie-wyzwanie.json.gz", "application/geo+json"),
    "/wyspy-greckie.json": ("data/challenges/wyspy-greckie.json", "application/geo+json"),
    "/heweliony.json": ("data/challenges/heweliony.json", "application/geo+json"),
    "/morza-wyzwanie.json": ("data/challenges/morza-wyzwanie.json", "application/geo+json"),
    '/morza-mapa.json': ('data/challenges/morza-mapa.json.gz', 'application/geo+json'),
    '/morza-proste.json': ('data/challenges/morza-proste.json.gz', 'application/geo+json'),
    '/morza-lady.json': ('data/challenges/morza-lady.json.gz', 'application/geo+json'),
    "/polskie-zamki.json": ("data/challenges/polskie-zamki.json", "application/geo+json"),
    "/mapa.json": ("data/maps/mapa.json", "application/json"),
    "/kontynenty.json": ("data/maps/kontynenty.json", "application/json"),
    "/kontynenty-obrysy.json": ("data/maps/kontynenty-obrysy.json.gz", "application/geo+json"),
    '/panstwa-lekkie.json': ('data/maps/panstwa-lekkie.json.gz', 'application/geo+json'),
    '/panstwa-proste.json': ('data/maps/panstwa-proste.json.gz', 'application/geo+json'),
    '/kontynenty-lekkie.json': ('data/maps/kontynenty-lekkie.json.gz', 'application/geo+json'),
    '/kontynenty-proste.json': ('data/maps/kontynenty-proste.json.gz', 'application/geo+json'),
    "/podklad.json": ("data/maps/podklad.json.gz", "application/geo+json"),
    "/rejony.json": ("data/maps/rejony.json.gz", "application/geo+json"),
    "/podregiony-zrodla.json": ("data/maps/podregiony-zrodla.json", "application/json"),
    "/stolice-zrodla.json": ("data/maps/stolice-zrodla.json", "application/json; charset=utf-8"),
    "/stolice.json": ("data/maps/stolice.json.gz", "application/geo+json"),
    "/miasta-polska.json": ("data/maps/miasta-polska.json.gz", "application/geo+json"),
    "/duze-miasta.json": ("data/maps/duze-miasta.json.gz", "application/geo+json"),
    "/odczyt-nazw.json": ("data/maps/odczyt-nazw.json.gz", "application/json"),
    "/journal-locales.json": ("data/maps/journal-locales.json", "application/json"),
    "/obrysy-miast.json": ("data/maps/obrysy-miast.json.gz", "application/geo+json"),
    "/obrysy-wsi.json": ("data/maps/obrysy-wsi.json.gz", "application/geo+json"),
    "/maplibre.js": ("web/vendor/maplibre.js", "text/javascript; charset=utf-8"),
    "/maplibre.css": ("web/vendor/maplibre.css", "text/css; charset=utf-8"),
    "/pmtiles.js": ("web/vendor/pmtiles.js", "text/javascript; charset=utf-8"),
    "/pliki": ("web/pliki.html", "text/html; charset=utf-8"),
    "/pliki.js": ("web/js/pliki.js", "text/javascript; charset=utf-8"),
}
ASSET_FILES = {Path(filename).name: ROOT / filename for filename, _ in ASSETS.values()}


@lru_cache(maxsize=4)
def static_bytes(filename):
    return ASSET_FILES[Path(filename).name].read_bytes()


def open_database(path):
    return closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True))


def geographic_bounds(params):
    west, south, east, north = (float(item) for item in params["bbox"][0].split(","))
    if not -180 <= west < east <= 180 or not -90 <= south < north <= 90:
        raise ValueError
    if east - west > 2.5 or north - south > 2:
        raise ValueError
    return east, west, north, south


def read_water(params):
    detail = int(params["z"][0])
    if not 9 <= detail <= 19:
        raise ValueError
    with open_database(HYDROGRAPHY) as database:
        rows = database.execute(
            """SELECT kind, geometry FROM water_bounds JOIN water ON water.rowid = water_bounds.feature
            WHERE min_lon <= ? AND max_lon >= ? AND min_lat <= ? AND max_lat >= ? AND detail <= ?""",
            (*geographic_bounds(params), detail)
        )
        return {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"kind": kind}, "geometry": decode_geometry(geometry)}
                for kind, geometry in rows
            ],
        }


def read_settlements(params, world=False):
    source = WORLD_CITIES if world else SETTLEMENTS
    if "q" in params:
        query = params["q"][0].strip().casefold().replace("ł", "l")
        query = "".join(c for c in unicodedata.normalize("NFD", query) if not unicodedata.combining(c))
        if not 2 <= len(query) <= 100:
            return []
        with open_database(source) as database:
            return [
                {"id": place_id, "name": name, "country" if world else "region": label, "position": [lon, lat]}
                for place_id, name, label, lon, lat in database.execute(
                    """SELECT id, name, label, lon, lat FROM settlements INDEXED BY settlements_search
                    WHERE instr(normalized, ?) > 0
                    ORDER BY instr('|' || normalized || '|', '|' || ? || '|') = 0,
                             instr(normalized, ?), length(normalized), normalized, label
                    LIMIT 50""", (query, query, query)
                )
            ]
    with open_database(source) as database:
        rows = database.execute(
            """SELECT id, name, label, lon, lat, geometry, min_lon, max_lon, min_lat, max_lat
            FROM settlement_bounds JOIN settlements ON settlements.rowid = settlement_bounds.place
            WHERE min_lon <= ? AND max_lon >= ? AND min_lat <= ? AND max_lat >= ?""",
            geographic_bounds(params)
        )
        features = []
        for place_id, name, label, lon, lat, geometry, west, east, south, north in rows:
            props = {"division_id": place_id, "name": name, "country": label if world else "PL",
                     "label": None if world else label, "lon": lon, "lat": lat}
            features.append({"type": "Feature", "properties": props,
                             "geometry": decode_geometry(geometry)})
            if not world:
                features.append(village_marker(props, west, east, south, north))
        return {"type": "FeatureCollection", "features": features}


def village_marker(props, west, east, south, north):
    lon, lat = props["lon"], props["lat"]
    span = max(east - west, (north - south) / math.cos(math.radians(lat)), 0.00001)
    marker_zoom = round(math.log2(3 * 360 / (512 * span)), 2)
    return {"type": "Feature", "properties": {**props, "markerZoom": marker_zoom},
            "geometry": {"type": "Point", "coordinates": [lon, lat]}}


def read_visited_outlines(static_cities):
    ids = {row["id"] for row in read_visits() if row["kategoria"] == "miasto"}
    features = [static_cities[id] for id in ids & static_cities.keys()]
    for path, prefix in ((SETTLEMENTS, "simc:"), (WORLD_CITIES, ("overture:", "osm:", "ne:", "jp:"))):
        wanted = [id for id in ids - static_cities.keys() if id.startswith(prefix)]
        if not wanted:
            continue
        with open_database(path) as database:
            for offset in range(0, len(wanted), 500):
                batch = wanted[offset:offset + 500]
                placeholders = ",".join("?" for _ in batch)
                rows = database.execute(
                    f"SELECT id, name, label, lon, lat, geometry FROM settlements WHERE id IN ({placeholders})",
                    batch,
                )
                features.extend({
                    "type": "Feature",
                    "properties": {"division_id": id, "name": name, "country": label if path == WORLD_CITIES else "PL",
                                   "lon": lon, "lat": lat},
                    "geometry": decode_geometry(geometry),
                } for id, name, label, lon, lat, geometry in rows)
    return {"type": "FeatureCollection", "features": features}


def read_visits():
    if not CSV.exists():
        return []
    stat = CSV.stat()
    return [row.copy() for row in _visit_rows(CSV, stat.st_mtime_ns, stat.st_size, stat.st_ino)]


@lru_cache(maxsize=1)
def _visit_rows(path, modified, size, inode):
    with path.open(encoding="utf-8-sig", newline="") as file:
        rows = list(csv.DictReader(file))
    for row in rows:
        for field in csv_text_fields(row):
            value = row.get(field) or ""
            if value.startswith("'") and csv_note_needs_escape(value[1:]):
                row[field] = value[1:]
    return rows


def csv_note_needs_escape(note):
    return note.startswith(("'", "\t", "\r", "\n")) or note.lstrip().startswith(("=", "+", "-", "@", "＝", "＋", "－", "＠"))


def csv_text_fields(row):
    if row["kategoria"] == "pinezka":
        return ("nazwa", "opis_krotki", "opis_dlugi")
    return ("nazwa", "notatka") if row["kategoria"] == "wycieczka" else ("notatka",)


def pin_record(change, place_id):
    lon, lat = change["pozycja"]
    if (type(lon) not in (int, float) or type(lat) not in (int, float)
            or not -180 <= lon <= 180 or not -90 <= lat <= 90):
        raise ValueError
    text = {}
    for field, max_length in (("nazwa", 100), ("opis_dlugi", 3000)):
        value = change[field]
        if not isinstance(value, str) or len(value) > max_length or "\x00" in value:
            raise ValueError
        text[field] = value.strip() if field == "nazwa" else value
    color = change["kolor"]
    if not text["nazwa"] or not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError
    return {"kategoria": "pinezka", "id": place_id, "lon": round(lon, 6), "lat": round(lat, 6),
            **text, "kolor": color.lower(),
            **visit_details({key: change[key] for key in ("data", "data_niepewna", "data_konca", "data_konca_niepewna", "kolejne_wizyty", "zdjecia") if key in change})}


def validate_date(value):
    if not isinstance(value, str) or (value and date.fromisoformat(value).isoformat() != value):
        raise ValueError
    return value


def uncertain_date(value):
    if type(value) is bool:
        return value
    if isinstance(value, str) and value in ("", "0", "1"):
        return value == "1"
    raise ValueError


def visit_details(change):
    details = {}
    if "zdjecia" in change:
        details["zdjecia"] = encoded_refs(change["zdjecia"])
    if "data" in change:
        details["data"] = validate_date(change["data"])
    if "data_niepewna" in change:
        details["data_niepewna"] = "1" if uncertain_date(change["data_niepewna"]) else ""
    if "data_konca" in change:
        details["data_konca"] = validate_date(change["data_konca"])
    if "data_konca_niepewna" in change:
        details["data_konca_niepewna"] = "1" if uncertain_date(change["data_konca_niepewna"]) else ""
    if details.get("data") and details.get("data_konca") and details["data_konca"] < details["data"]:
        raise ValueError
    if "ocena" in change:
        value = change["ocena"]
        if type(value) not in (str, int, float):
            raise ValueError
        value = str(value).strip().replace(",", ".")
        if value and (len(value) > 32 or not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", value)
                      or not 1 <= Decimal(value) <= 10):
            raise ValueError
        details["ocena"] = value
    if "notatka" in change:
        note = change["notatka"]
        if not isinstance(note, str) or len(note) > 2000 or "\x00" in note:
            raise ValueError
        details["notatka"] = note
    if "kolejne_wizyty" in change:
        visits = change["kolejne_wizyty"]
        if not isinstance(visits, list) or len(visits) > 100:
            raise ValueError
        seen = set()
        for visit in visits:
            if not isinstance(visit, dict) or not {"id", "data"}.issubset(visit) or set(visit) - {"id", "data", "data_niepewna", "data_konca", "data_konca_niepewna"}:
                raise ValueError
            visit_id = visit["id"]
            if (not isinstance(visit_id, str) or not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", visit_id)
                    or visit_id in seen or not validate_date(visit["data"])):
                raise ValueError
            if "data_niepewna" in visit:
                uncertain_date(visit["data_niepewna"])
            departure = validate_date(visit.get("data_konca", ""))
            if departure and departure < visit["data"]:
                raise ValueError
            if "data_konca_niepewna" in visit:
                uncertain_date(visit["data_konca_niepewna"])
            seen.add(visit_id)
        details["kolejne_wizyty"] = json.dumps(visits, separators=(",", ":")) if visits else ""
    return details


def additional_visits(row):
    try:
        value = json.loads(row.get("kolejne_wizyty") or "[]")
        visit_details({"kolejne_wizyty": value})
        return value
    except ValueError:
        return []


def diary_visits(rows, include_planned=False):
    visits = {}
    for row in rows:
        if row["kategoria"] not in (*MAP_CATEGORIES, "pinezka") or row.get("tryb") in ("auto", SKIP_LINKED) or (row.get("tryb") == "plan" and not include_planned):
            continue
        key = row["kategoria"] + ":" + row["id"]
        visits[key] = row
        for visit in additional_visits(row):
            visits[key + ":visit:" + visit["id"]] = {**row, "data": visit["data"], "data_niepewna": "1" if uncertain_date(visit.get("data_niepewna", "")) else "",
                "data_konca": visit.get("data_konca", ""), "data_konca_niepewna": "1" if uncertain_date(visit.get("data_konca_niepewna", "")) else "", "ocena": "", "notatka": ""}
    return visits


def trip_members(row):
    try:
        members = json.loads(row.get("miejsca") or "[]")
    except ValueError:
        return []
    return list(dict.fromkeys(members)) if isinstance(members, list) and all(isinstance(key, str) for key in members) else []


def trip_record(change, trip_id, members):
    title = change["nazwa"]
    if not isinstance(title, str) or len(title) > 100 or "\x00" in title:
        raise ValueError
    details = visit_details({"data": change["data"], "notatka": change["notatka"], "data_niepewna": change.get("data_niepewna", "")})
    end = validate_date(change["data_konca"])
    if details["data"] and end and end < details["data"]:
        raise ValueError
    return {"kategoria": "wycieczka", "id": trip_id, "nazwa": title.strip(), **details,
            "data_konca": end, "data_konca_niepewna": "1" if uncertain_date(change.get("data_konca_niepewna", "")) else "",
            "miejsca": json.dumps(members, separators=(",", ":")),
            "zdjecia": encoded_refs(change.get("zdjecia"), multiple=True)}


def journal_model(rows, server, language="en", title="", user_name="", include_planned=False):
    """Match journal ordering and trip membership, including separate repeat visits."""
    from .journal_export import day_label, WORDS
    names = json.loads(static_bytes("journal-locales.json"))[language]
    readings = json.loads(gzip.decompress(static_bytes("odczyt-nazw.json.gz")))
    country_codes = {id: code for code, id in server.country_codes.items()}
    continents = {item["id"]: item for item in json.loads(static_bytes("kontynenty.json"))}
    visited_countries = {row["id"] for row in rows if row["kategoria"] == "panstwo" and row.get("tryb") not in ("plan", SKIP_LINKED)}
    visits = {}
    all_visits = diary_visits(rows, include_planned=True)
    for key, row in diary_visits(rows, include_planned=include_planned).items():
        category = row["kategoria"]
        country_id = row.get("panstwo_id")
        if category == "miasto":
            country_id = city_country_id(row, server)
        elif category == "panstwo":
            country_id = row["id"]
        elif category == "rejon" and not country_id:
            country_id = server.places.get((category, row["id"]), {}).get("panstwo_id")
        if country_id in server.countries and row.get("tryb") != "plan":
            visited_countries.add(country_id)
        code = country_codes.get(country_id, "")
        name = row.get("nazwa") or server.places.get((category, row["id"]), {}).get("nazwa") or row["id"]
        if category == "panstwo":
            name = names.get(code, name)
        elif category == "kontynent" and row["id"] in continents:
            name = continents[row["id"]]["english" if language == "en" else "name"]
        reading = ""
        if category == "miasto":
            reading = readings.get("byCountry", {}).get(code, {}).get(name, "") or readings.get("byName", {}).get(name, "")
        visits[key] = {"kind": "visit", "title": name + ((" · Planned" if language == "en" else " · Zaplanowane") if row.get("tryb") == "plan" else ""), "date": row.get("data") or "", "uncertain": uncertain_date(row.get("data_niepewna", "")), "rating": row.get("ocena") or "",
                       "end": row.get("data_konca") or "", "end_uncertain": uncertain_date(row.get("data_konca_niepewna", "")),
                       "note": (row.get("opis_dlugi") if category == "pinezka" else row.get("notatka")) or "",
                       "reading": reading, "country": names.get(code, "") if category in ("miasto", "rejon") else "",
                       "photos": photo_refs(row.get("zdjecia"))}
    trips, claimed = [], set()
    for row in rows:
        if row["kategoria"] != "wycieczka":
            continue
        raw_keys = trip_members(row)
        keys = [key for key in raw_keys if key in visits]
        if not include_planned and not keys and any(key in all_visits and all_visits[key].get("tryb") == "plan" for key in raw_keys):
            continue
        claimed.update(keys)
        members = sorted((visits[key] for key in keys), key=lambda visit: visit["date"], reverse=True)
        trips.append({"kind": "trip", "title": row.get("nazwa") or WORDS["trip"][language == "en"],
                      "date": row.get("data") or "", "end": row.get("data_konca") or "",
                      "uncertain": uncertain_date(row.get("data_niepewna", "")),
                      "end_uncertain": uncertain_date(row.get("data_konca_niepewna", "")),
                      "note": row.get("notatka") or "", "members": members, "photos": photo_refs(row.get("zdjecia"))})
    entries = [visit for key, visit in visits.items() if key not in claimed] + trips
    entries.sort(key=lambda entry: entry.get("date") or (entry.get("end") if entry["kind"] == "trip" else "") or "", reverse=True)
    years = {}
    for entry in entries:
        year = (entry.get("date") or (entry.get("end") if entry["kind"] == "trip" else "") or "")[:4]
        years.setdefault(year, []).append(entry)
    dates = sorted({entry["date"] for entry in visits.values() if entry["date"]}
                   | {trip[field] for trip in trips for field in ("date", "end") if trip[field]})
    approximate = {entry["date"] for entry in visits.values() if entry["date"] and entry["uncertain"]}
    exact = {entry["date"] for entry in visits.values() if entry["date"] and not entry["uncertain"]}
    for trip in trips:
        for field, flag in (("date", "uncertain"), ("end", "end_uncertain")):
            if trip[field]:
                (approximate if trip[flag] else exact).add(trip[field])
    approximate -= exact
    span = day_label(dates[0], language, dates[0] in approximate) if dates else ""
    if len(dates) > 1:
        span += " - " + day_label(dates[-1], language, dates[-1] in approximate)
    return {"language": language, "title": title or WORDS["title"][language == "en"], "author": user_name.strip(), "years": list(years.items()),
            "range": span, "trips": len(trips), "visits": len(visits), "countries": len(visited_countries), "country_ids": visited_countries}


CHALLENGE_CATEGORIES = ("atrakcja_parku", "park_narodowy", "latarnia", "wyspa_grecka", "cypr", "hewelion", "zamek", "morze")
DEVELOPER_CHALLENGES = {
    "parks": ("atrakcja_parku", "park_narodowy"), "bliza": ("latarnia",),
    "islands": ("wyspa_grecka", "cypr"), "hewelion": ("hewelion",), "castles": ("zamek",),
    "seas": ("morze",),
}


def developer_achievements_unlocked(rows):
    return any(row["kategoria"] == "osiagniecie" and row["id"] == "developer_all" and row.get("tryb") == "unlock" for row in rows)


def update_developer_challenges(rows, challenge, action):
    rows = migrate_sea_visits(rows)
    categories = tuple(category for key, values in DEVELOPER_CHALLENGES.items()
                       if challenge in (key, "all") for category in values)
    if action == "reset":
        remaining = [row for row in rows if row["kategoria"] not in categories]
        return remaining, len(rows) - len(remaining)
    result = list(rows)
    existing = {(row["kategoria"], row["id"]) for row in rows}
    added = 0
    for category in categories:
        for id, (name, lon, lat) in challenge_places(category).items():
            if (category, id) in existing:
                continue
            result.append({"kategoria": category, "id": id, "nazwa": name, "lon": lon, "lat": lat})
            existing.add((category, id))
            added += 1
    if "latarnia" in categories:
        # BLIZA gold counts foreign lighthouses after the last domestic passport visit.
        domestic = {f["properties"]["id"] for f in json.loads(gzip.decompress(static_bytes("latarnie-wyzwanie.json.gz")))["features"]
                    if f["properties"].get("poland")}
        lights = [row for row in result if row["kategoria"] == "latarnia"]
        lights.sort(key=lambda row: row["id"] not in domestic)
        result = [row for row in result if row["kategoria"] != "latarnia"] + lights
    return result, added


@lru_cache(maxsize=1)
def sea_catalogue():
    data = json.loads(static_bytes('morza-wyzwanie.json'))
    return {f['properties']['id']:f['properties'] for f in data['features']},data.get('aliases',{})


def migrate_sea_visits(rows):
    if not any(row['kategoria'] == 'morze' for row in rows):return rows
    catalogue,aliases = sea_catalogue()
    existing = {r['id']:r for r in rows if r['kategoria'] == 'morze' and r['id'] not in aliases}
    result=[];seen=set()
    for row in rows:
        if row['kategoria'] != 'morze':result.append(row);continue
        identifier=aliases.get(row['id'],row['id'])
        if identifier in seen:continue
        seen.add(identifier)
        if identifier != row['id']:
            props=catalogue[identifier]
            row={**existing.get(identifier,row),'id':identifier,'nazwa':props['name'],'lon':props['lon'],'lat':props['lat']}
        result.append(row)
    return result


@lru_cache(maxsize=len(CHALLENGE_CATEGORIES))
def challenge_places(category):
    if category == "morze":
        catalogue,_ = sea_catalogue()
        return {id:(p['name'],p['lon'],p['lat']) for id,p in catalogue.items()}
    if category == "cypr":
        return {"cyprus": ("Cypr", 33.2, 35.05)}
    if category == "wyspa_grecka":
        features = json.loads(static_bytes("wyspy-greckie.json"))["features"]
        return {p["id"]: (p["name"], "", "") for p in (feature["properties"] for feature in features)}
    if category in ("hewelion", "zamek"):
        filename = "heweliony.json" if category == "hewelion" else "polskie-zamki.json"
        features = json.loads(static_bytes(filename))["features"]
        return {f["properties"]["id"]: (f["properties"]["name"], *f["geometry"]["coordinates"]) for f in features}
    if category == "latarnia":
        features = json.loads(gzip.decompress(static_bytes("latarnie-wyzwanie.json.gz")))["features"]
        return {
            feature["properties"]["id"]: (feature["properties"]["name"], *feature["geometry"]["coordinates"])
            for feature in features
        }
    parks = json.loads(gzip.decompress(static_bytes("parki-wyzwanie.json.gz")))["features"]
    if category == "park_narodowy":
        return {p["id"]: (p["name"], "", "") for p in (feature["properties"] for feature in parks)}
    attractions = json.loads(static_bytes("atrakcje-parkow.json"))
    return {
        f'{park["id"]}:{id}': (name, "", "")
        for park in (feature["properties"] for feature in parks)
        for id, name, _, _ in attractions[park["key"]]
    }


@lru_cache(maxsize=1)
def challenge_summaries():
    """Cards and achievements need properties, not millions of outline coordinates."""
    result = {}
    for key, filename in (
        ('parks', 'parki-wyzwanie.json.gz'), ('bliza', 'latarnie-wyzwanie.json.gz'),
        ('islands', 'wyspy-greckie.json'), ('hewelion', 'heweliony.json'),
        ('castles', 'polskie-zamki.json'), ('seas', 'morza-wyzwanie.json'),
    ):
        raw = static_bytes(filename)
        data = json.loads(gzip.decompress(raw) if filename.endswith('.gz') else raw)
        result[key] = {'data': {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {name: value for name, value in feature['properties'].items()
                 if name in ('id', 'key', 'tier', 'lastKnown', 'optional', 'country', 'poland', 'name', 'english')}, 'geometry': None}
            for feature in data['features']]},
            'attractions': json.loads(static_bytes('atrakcje-parkow.json')) if key == 'parks' else None}
    return json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode()


def write_csv(path, fields, rows):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8-sig", newline="", dir=path.parent, delete=False
        ) as file:
            temporary = Path(file.name)
            writer = csv.DictWriter(file, fields)
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temporary, path)
        if path == CSV:
            _visit_rows.cache_clear()
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write_visits(rows):
    rows = migrate_sea_visits(rows)
    def encoded_row(row):
        escaped = {field: "'" + row[field] for field in csv_text_fields(row)
                   if csv_note_needs_escape(row.get(field) or "")}
        return {**row, **escaped}

    write_csv(CSV, FIELDS, (encoded_row(row) for row in rows))


TRANSFER_LIMIT = 64 * 1024 * 1024


def import_progress(content, format, server):
    """Validate the complete backup before the caller replaces any saved data."""
    if not isinstance(content, str) or len(content.encode("utf-8")) > TRANSFER_LIMIT:
        raise ValueError
    if format == "csv":
        reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff"), newline=""), strict=True)
        if (not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames)
                or set(reader.fieldnames) - set(FIELDS)
                or set(FIELDS) - {"data_niepewna", "data_konca_niepewna", "zdjecia"} - set(reader.fieldnames)):
            raise ValueError
        rows = list(reader)
        for row in rows:
            if set(row) != set(reader.fieldnames) or any(not isinstance(value, str) for value in row.values()):
                raise ValueError
            for field in csv_text_fields(row):
                value = row.get(field) or ""
                if value.startswith("'") and csv_note_needs_escape(value[1:]):
                    row[field] = value[1:]
    elif format == "json":
        backup = json.loads(content.lstrip("\ufeff"))
        if (not isinstance(backup, dict) or backup.get("application") != "travel-tracker"
                or type(backup.get("version")) is not int or backup["version"] != 1):
            raise ValueError
        rows = backup.get("progress")
    else:
        raise ValueError
    if not isinstance(rows, list) or len(rows) > 250000:
        raise ValueError
    result, seen = [], set()
    uuid_pattern = r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"
    for source in rows:
        if not isinstance(source, dict) or source.keys() - set(FIELDS):
            raise ValueError
        if any(value is not None and type(value) not in (str, int, float) for value in source.values()):
            raise ValueError
        row = {field: "" if source.get(field) is None else str(source.get(field, "")) for field in FIELDS}
        if any("\x00" in value or len(value) > 65536 for value in row.values()):
            raise ValueError
        category, id = row["kategoria"], row["id"]
        row["zdjecia"] = encoded_refs(row["zdjecia"], multiple=category == "wycieczka")
        if category not in ("pinezka", "wycieczka") and csv_note_needs_escape(row["nazwa"]):
            raise ValueError
        key = category, id
        if not id or len(id) > 250 or key in seen or len(row["nazwa"]) > 250:
            raise ValueError
        seen.add(key)
        if category in MAP_CATEGORIES:
            if row["tryb"] not in ("", "plan", "auto", SKIP_LINKED):
                raise ValueError
            if key not in server.places and (category != "miasto" or not id.startswith(("simc:", "overture:", "osm:", "ne:", "jp:"))):
                raise ValueError
            if row["panstwo_id"] and row["panstwo_id"] not in server.countries:
                raise ValueError
        elif category in CHALLENGE_CATEGORIES:
            legacy_sea = category == 'morze' and id in sea_catalogue()[1]
            if (id not in challenge_places(category) and not legacy_sea) or row["tryb"]:
                raise ValueError
        elif category in ("pinezka", "wycieczka"):
            if not re.fullmatch(uuid_pattern, id) or row["tryb"]:
                raise ValueError
        elif category != "osiagniecie" or id != "developer_all" or row["tryb"] != "unlock":
            raise ValueError
        if bool(row["lon"]) != bool(row["lat"]):
            raise ValueError
        if row["lon"]:
            lon, lat = float(row["lon"]), float(row["lat"])
            if not -180 <= lon <= 180 or not -90 <= lat <= 90:
                raise ValueError
        details = {field: row[field] for field in (*VISIT_DETAILS, "data_konca", "data_konca_niepewna")}
        details["kolejne_wizyty"] = json.loads(row["kolejne_wizyty"] or "[]")
        visit_details(details)
        validate_date(row["data_konca"])
        uncertain_date(row["data_konca_niepewna"])
        if category == "pinezka":
            pin_record({**row, "kolejne_wizyty": details["kolejne_wizyty"], "pozycja": [float(row["lon"]), float(row["lat"])]}, id)
        if category == "wycieczka":
            members = json.loads(row["miejsca"] or "[]")
            if (not isinstance(members, list) or len(members) > 500 or not all(isinstance(key, str) for key in members)
                    or len(members) != len(set(members))):
                raise ValueError
            trip_record(row, id, members)
        elif row["miejsca"]:
            raise ValueError
        result.append(row)
    valid_visits = diary_visits(result, include_planned=True)
    claimed = set()
    for row in result:
        if row["kategoria"] == "wycieczka":
            members = set(trip_members(row))
            if not members.issubset(valid_visits) or claimed.intersection(members):
                raise ValueError
            claimed.update(members)
    return migrate_sea_visits(result)


def export_progress(rows, format, server):
    if format == "csv":
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, FIELDS)
        writer.writeheader()
        for row in rows:
            encoded = dict(row)
            for field in csv_text_fields(row):
                if csv_note_needs_escape(row.get(field) or ""):
                    encoded[field] = "'" + row[field]
            writer.writerow(encoded)
        return output.getvalue().encode("utf-8-sig"), "text/csv; charset=utf-8", "csv"
    if format == "json":
        backup = {"application": "travel-tracker", "version": 1, "exported": date.today().isoformat(), "progress": rows}
        return json.dumps(backup, ensure_ascii=False, indent=2).encode(), "application/json", "json"
    if format != "kml":
        raise ValueError
    # My Maps accepts at most 2,000 places and 5 MB per KML import.
    # Larger maps are exported as separate KML files in one ZIP, without truncation.
    positions = {(kind, id): (place.get("lon"), place.get("lat")) for (kind, id), place in server.places.items()}
    for continent in json.loads(static_bytes("kontynenty.json")):
        positions["kontynent", continent["id"]] = continent["center"]
    for bounds, id, rings in country_shapes():
        # Pick the largest country's polygon, avoiding distant overseas islands.
        area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
        current = positions.get(("country-area", id), (0, 0))[0]
        if area > current:
            positions["country-area", id] = (area, 0)
            positions["panstwo", id] = ((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2)
    if any(row["kategoria"] == "miasto" and not row.get("lon") for row in rows):
        for place in developer_candidates(server, "settlements"):
            positions["miasto", place["id"]] = place["lon"], place["lat"]
        for id, _, x, y, *_ in json.loads(static_bytes("mapa.json"))["miasto"]:
            south, north = -85, 85
            for _ in range(24):
                middle = (south + north) / 2
                p = math.radians(middle)
                p2, p4 = p * p, p ** 4
                projected_y = 260 - 182.75 * p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)))
                if projected_y > y:
                    south = middle
                else:
                    north = middle
            lat = (south + north) / 2
            p2, p4 = math.radians(lat) ** 2, math.radians(lat) ** 4
            width = 182.75 * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)))
            positions.setdefault(("miasto", id), (max(-180, min(180, math.degrees((x - 500) / width))), lat))
    for category in CHALLENGE_CATEGORIES:
        for id, (_, lon, lat) in challenge_places(category).items():
            if lon != "" and lat != "":
                positions[category, id] = lon, lat
    for filename, category, compressed in (("wyspy-greckie.json", "wyspa_grecka", False), ("parki-wyzwanie.json.gz", "park_narodowy", True)):
        raw = static_bytes(filename)
        for feature in json.loads(gzip.decompress(raw) if compressed else raw)["features"]:
            bounds = max(polygon_bounds("", feature["geometry"]), key=lambda item: (item[0][2]-item[0][0])*(item[0][3]-item[0][1]))[0]
            positions[category, feature["properties"]["id"]] = ((bounds[0]+bounds[2])/2, (bounds[1]+bounds[3])/2)
    namespace = "http://www.opengis.net/kml/2.2"
    ET.register_namespace("", namespace)
    def node(parent, tag, text=None, **attributes):
        element = ET.SubElement(parent, "{" + namespace + "}" + tag, attributes)
        if text is not None:
            element.text = re.sub(r"[^\x09\x0a\x0d\x20-\ud7ff\ue000-\ufffd\U00010000-\U0010ffff]", "", str(text))
        return element
    def document():
        root = ET.Element("{" + namespace + "}kml")
        doc = node(root, "Document")
        node(doc, "name", APP_NAME)
        for id, color in (("visited", "ffde8cac"), ("planned", "ff89c6f5")):
            style = node(doc, "Style", id=id)
            node(node(style, "IconStyle"), "color", color)
        return root, doc
    root, doc = document()
    parts, count, size = [], 0, 0
    for row in rows:
        if row["kategoria"] in ("wycieczka", "osiagniecie", "atrakcja_parku") or row.get("tryb") == SKIP_LINKED:
            continue
        lon, lat = (row["lon"], row["lat"]) if row.get("lon") and row.get("lat") else positions.get((row["kategoria"], row["id"]), (None, None))
        if lon in (None, "") or lat in (None, ""):
            raise ValueError("missing-position")
        placemark = ET.Element("{" + namespace + "}Placemark")
        node(placemark, "name", row.get("nazwa") or row["id"])
        node(placemark, "styleUrl", "#planned" if row.get("tryb") == "plan" else "#visited")
        if row["kategoria"] == "pinezka" and re.fullmatch(r"#[0-9a-fA-F]{6}", row.get("kolor", "")):
            color = row["kolor"]
            node(node(node(placemark, "Style"), "IconStyle"), "color", "ff" + color[5:7] + color[3:5] + color[1:3])
        node(placemark, "description", "\n".join(("~" if field == "data" and uncertain_date(row.get("data_niepewna", "")) else "") + str(row.get(field)) for field in ("data", "notatka", "opis_dlugi") if row.get(field)))
        extra = node(placemark, "ExtendedData")
        for field in FIELDS:
            if row.get(field):
                node(node(extra, "Data", name=field), "value", row[field])
        node(node(placemark, "Point"), "coordinates", f"{float(lon):.6f},{float(lat):.6f},0")
        length = len(ET.tostring(placemark, encoding="utf-8"))
        if count and (count >= 2000 or size + length > 4500000):
            parts.append(ET.tostring(root, encoding="utf-8", xml_declaration=True))
            root, doc = document()
            count, size = 0, 0
        doc.append(placemark)
        count, size = count + 1, size + length
    parts.append(ET.tostring(root, encoding="utf-8", xml_declaration=True))
    if len(parts) == 1:
        return parts[0], "application/vnd.google-earth.kml+xml", "kml"
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for index, part in enumerate(parts, 1):
            archive.writestr(f"travel-tracker-{index:03}.kml", part)
    return output.getvalue(), "application/zip", "zip"


def validate_zoom(minimum, maximum):
    if type(minimum) not in (float, int) or type(maximum) not in (float, int) or not 0 <= minimum < maximum <= 19:
        raise ValueError
    return {"min": minimum, "max": maximum}


def valid_layout_value(key, value):
    if key == "user_name":
        return isinstance(value, str) and len(value) <= 80 and not any(ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF for c in value)
    return key in LAYOUT_VALUES and value in LAYOUT_VALUES[key]


def read_settings():
    ranges = {name: dict(value) for name, value in DEFAULT_ZOOMS.items()}
    visibility = DEFAULT_VISIBILITY.copy()
    layout = DEFAULT_LAYOUT.copy()
    legacy_details = {"online_focus": "off", "online_hewelion": "on", "online_castles": "on"}
    has_legacy_details = has_details = False
    if SETTINGS.exists():
        with SETTINGS.open(encoding="utf-8-sig", newline="") as file:
            for row in csv.DictReader(file):
                name = row.get("widok")
                value = row.get("wartosc")
                if name in legacy_details and value in ("on", "off"):
                    legacy_details[name] = value
                    has_legacy_details = True
                if name == "online_details" and value in ("on", "off"):
                    has_details = True
                if name in layout and valid_layout_value(name, row.get("wartosc")):
                    layout[name] = row["wartosc"].strip() if name == "user_name" else row["wartosc"]
                if name in visibility and row.get("widoczny") in ("0", "1"):
                    visibility[name] = row["widoczny"] == "1"
                if name in ranges:
                    try:
                        ranges[name] = validate_zoom(float(row["min_zoom"]), float(row["maks_zoom"]))
                    except (KeyError, TypeError, ValueError):
                        continue
    if has_legacy_details and not has_details:
        layout["online_details"] = "on" if "on" in legacy_details.values() else "off"
    if not any(visibility[name] for name in ranges):
        visibility["countries"] = True
    return ranges, visibility, layout


def read_achievements():
    rules = {"parks", "bliza", "islands", "hewelion", "castles", "castles-all", "seas", "countries", "settlements", "us-states", "continents",
             "antarctica", "chornobyl", "krolewiec", "trip-countries"}
    rules.update(f"castles-{tier}" for tier in CASTLE_TIERS)
    required_fields = {"id", "regula", "cel", "ukryte", "ikona", "nazwa_pl", "wymog_pl", "opis_pl", "poziom_pl"}
    definitions = {}
    with ACHIEVEMENTS.open(encoding="utf-8-sig", newline="") as file:
        header = file.readline()
        file.seek(0)
        reader = csv.DictReader(file, delimiter=";" if ";" in header else ",", strict=True)
        if not required_fields.issubset(reader.fieldnames or []):
            raise ValueError(1)
        for raw in reader:
            if None in raw or any(value is None for value in raw.values()):
                raise ValueError(reader.line_num)
            row = {key: value.strip() for key, value in raw.items()}
            if not any(row.values()):
                continue
            id = row["id"]
            if not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", id) or not re.fullmatch(r"[1-9][0-9]{0,5}", row["cel"]):
                raise ValueError(reader.line_num)

            def translation(key):
                polish = row[key + "_pl"]
                return [polish, row.get(key + "_en") or polish]

            if id not in definitions:
                rule = row["regula"]
                location = re.fullmatch(
                    r"panstwo:[A-Z]{2}(?:\|[A-Z]{2})*|kontynent:[a-z-]+|(?:rejon|rejony):[a-zA-Z0-9_:-]+(?:\|[a-zA-Z0-9_:-]+)*"
                    r"|zamek:[a-z0-9-]+(?:\|[a-z0-9-]+)*",
                    rule,
                )
                if (rule not in rules and not location) or row["ukryte"] not in ("0", "1") or not row["nazwa_pl"]:
                    raise ValueError(reader.line_num)
                definitions[id] = {"id": id, "rule": rule, "secret": row["ukryte"] == "1",
                                   "icon": row["ikona"] or "★", "title": translation("nazwa"), "levels": []}
            definition = definitions[id]
            target = int(row["cel"])
            levels = definition["levels"]
            if ((levels and target <= levels[-1]["target"])
                    or (definition["rule"] == "bliza" and target > 3)):
                raise ValueError(reader.line_num)
            levels.append({"target": target, "goal": translation("wymog"), "description": translation("opis"),
                           "label": translation("poziom") if row["poziom_pl"] else [str(target), str(target)]})
    return list(definitions.values())


def write_settings(ranges, visibility, layout):
    write_csv(SETTINGS, SETTINGS_FIELDS, [
        {"widok": name, "min_zoom": ranges.get(name, {}).get("min", ""),
         "maks_zoom": ranges.get(name, {}).get("max", ""), "widoczny": int(shown)}
        for name, shown in visibility.items()
    ] + [{"widok": key, "wartosc": value} for key, value in layout.items()])


@lru_cache(maxsize=1)
def country_shapes():
    shapes = []
    for feature in json.loads(gzip.decompress(static_bytes("podklad.json.gz")))["features"]:
        country_id = feature["properties"].get("country_id")
        if not country_id:
            continue
        shapes.extend(polygon_bounds(country_id, feature["geometry"]))
    return shapes


def polygon_bounds(id, geometry):
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    for rings in polygons:
        xs, ys = zip(*rings[0])
        yield (min(xs), min(ys), max(xs), max(ys)), id, rings


def point_in_ring(lon, lat, ring):
    inside = False
    previous_x, previous_y = ring[-1]
    for x, y in ring:
        if (y > lat) != (previous_y > lat):
            if lon < (previous_x - x) * (lat - y) / (previous_y - y) + x:
                inside = not inside
        previous_x, previous_y = x, y
    return inside


def country_at(lon, lat):
    return region_at(lon, lat, country_shapes())


def region_at(lon, lat, shapes):
    for (west, south, east, north), id, rings in shapes:
        if west <= lon <= east and south <= lat <= north:
            if point_in_ring(lon, lat, rings[0]) and not any(point_in_ring(lon, lat, hole) for hole in rings[1:]):
                return id
    return None


def city_country_id(row, server, code=""):
    country_id = row.get("panstwo_id")
    if country_id not in server.countries:
        code = server.city_codes.get(row["id"], code)
        if row["id"].startswith(("prg:", "simc:")):
            code = "PL"
        country_id = server.country_codes.get(code)
    if country_id and country_id != server.country_codes.get("RU"):
        return country_id
    try:
        lon, lat = float(row["lon"]), float(row["lat"])
    except (KeyError, ValueError, TypeError):
        return country_id
    if country_id is None:
        return country_at(lon, lat)
    # Correct legacy Russian assignments on the Crimean peninsula.
    if 32.5 <= lon <= 36.6 and 44.3 <= lat <= 46.3:
        ukraine = server.country_codes.get("UA")
        if country_at(lon, lat) == ukraine:
            return ukraine
    return country_id


def most_countries_in_trip(rows, server):
    trips = [row for row in rows if row["kategoria"] == "wycieczka"]
    if not trips:
        return 0
    visits = diary_visits(rows)
    antarctica = server.country_codes.get("AQ")
    maximum = 0
    for trip in trips:
        countries = set()
        for key in trip_members(trip):
            visit = visits.get(key)
            if not visit:
                continue
            category = visit["kategoria"]
            if category == "panstwo":
                country = visit["id"]
            elif category == "miasto":
                country = city_country_id(visit, server)
            elif category == "rejon":
                country = visit.get("panstwo_id") or server.places.get((category, visit["id"]), {}).get("panstwo_id")
            else:
                continue
            if country in server.countries and country != antarctica:
                countries.add(country)
        maximum = max(maximum, len(countries))
    return maximum


def city_region_id(row, server, country_id):
    place_id = row["id"]
    if place_id.startswith("prg:"):
        code = place_id[4:6]
        return server.polish_region_codes.get(code)
    if place_id.startswith("simc:"):
        if not hasattr(server, "settlement_region_cache"):
            with open_database(SETTLEMENTS) as database:
                server.settlement_region_cache = {
                    id: server.polish_region_names.get(label.split(" · ")[1].casefold())
                    for id, label in database.execute("SELECT id, label FROM settlements") if " · " in label
                }
        region_id = server.settlement_region_cache.get(place_id)
        if region_id is not None:
            return region_id
    try:
        lon, lat = float(row["lon"]), float(row["lat"])
    except (KeyError, ValueError, TypeError):
        return None
    return region_at(lon, lat, server.region_shapes.get(country_id, ()))


def visit_continent(row, country_id, server):
    continent = server.continents_by_country.get(country_id)
    territories = server.continent_territories.get(country_id)
    if not territories or row["kategoria"] == "panstwo":
        return continent
    try:
        lon, lat = float(row["lon"]), float(row["lat"])
    except (KeyError, TypeError, ValueError):
        return continent
    return next((id for west, south, east, north, id in territories if west <= lon <= east and south <= lat <= north),
                continent)


def add_linked_visits(rows, server):
    visits = [row.copy() for row in rows if row.get("tryb") != "auto" or row["kategoria"] == "miasto"]
    existing = {(row["kategoria"], row["id"]) for row in visits}
    linked = {}
    for row in visits:
        category = row["kategoria"]
        if category not in ("panstwo", "miasto", "rejon") or row.get("tryb") in ("plan", SKIP_LINKED):
            continue
        if category == "panstwo":
            country_id = row["id"]
        elif category == "rejon":
            country_id = row.get("panstwo_id") or server.places.get((category, row["id"]), {}).get("panstwo_id")
        else:
            country_id = city_country_id(row, server)

        continent_id = visit_continent(row, country_id, server)
        continent_key = ("kontynent", continent_id)
        if continent_id and continent_key not in existing:
            linked[continent_key] = {**server.places[continent_key], "tryb": "auto"}

        if category != "panstwo" and country_id in server.countries:
            row["panstwo_id"] = country_id
            key = ("panstwo", country_id)
            if key not in existing:
                linked[key] = {**server.countries[country_id], "tryb": "auto"}
        if category == "miasto":
            key = ("rejon", city_region_id(row, server, country_id))
            if key in server.places and key not in existing:
                linked[key] = {**server.places[key], "tryb": "auto"}
            try:
                lon, lat = float(row["lon"]), float(row["lat"])
                subregion = region_at(lon, lat, getattr(server, "subregion_shapes", {}).get(country_id, ()))
                if subregion is None:
                    from .admin_boundaries import subregion_at
                    subregion = subregion_at(lon, lat, country_id)
            except (KeyError, TypeError, ValueError):
                subregion = None
            key = ("rejon", subregion)
            if key in server.places and key not in existing:
                linked[key] = {**server.places[key], "tryb": "auto"}
            parent = getattr(server, "region_parents", {}).get(subregion)
        elif category == "rejon":
            parent = getattr(server, "region_parents", {}).get(row["id"])
        else:
            parent = None
        key = ("rejon", parent)
        if key in server.places and key not in existing:
            linked[key] = {**server.places[key], "tryb": "auto"}
    return visits + list(linked.values())


FILL_PRESETS = {"continents", "countries", "regions", "subregions", "major", "capital-cities", "cities", "settlements"}


def developer_candidates(server, preset):
    """Enumerate the same local place IDs used by each geographic map view."""
    cache = getattr(server, "developer_catalogues", {})
    if preset in cache:
        return cache[preset]
    if preset in ("continents", "countries", "regions", "subregions"):
        category = {"continents": "kontynent", "countries": "panstwo", "regions": "rejon", "subregions": "rejon"}[preset]
        result = [place.copy() for (kind, _), place in server.places.items() if kind == category]
        if preset in ("regions", "subregions"):
            subregions = getattr(server, "subregion_ids", set())
            result = [place for place in result if (place["id"] in subregions) == (preset == "subregions")]
    else:
        places = {}

        def add(id, name, country, lon, lat):
            if not id or not name or not all(type(value) in (int, float) and math.isfinite(value) for value in (lon, lat)):
                return
            places.setdefault(id, {"kategoria": "miasto", "id": id, "nazwa": name, "lon": round(lon, 6),
                                   "lat": round(lat, 6), "panstwo_id": server.country_codes.get(country, "")})

        def add_feature(feature):
            props = feature["properties"]
            id = props["division_id"]
            if ":" not in id and props.get("legacy_id") != id:
                id = "overture:" + id
            lon, lat = props.get("lon"), props.get("lat")
            if lon is None or lat is None:
                geometry = feature["geometry"]
                polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
                points = [point for polygon in polygons for ring in polygon for point in ring]
                lon = (min(point[0] for point in points) + max(point[0] for point in points)) / 2
                lat = (min(point[1] for point in points) + max(point[1] for point in points)) / 2
            add(id, props.get("@name") or props.get("name"), props.get("country", ""), lon, lat)

        for feature in (() if preset == "capital-cities" else server.static_cities.values()):
            if preset != "major" or feature["properties"].get("major") or not feature["properties"]["division_id"].startswith("prg:"):
                add_feature(feature)
        def capital_name(value):
            return "".join(character for character in unicodedata.normalize("NFD", value.casefold().replace("ł", "l"))
                           if not unicodedata.combining(character))

        capital_names = set()
        for feature in json.loads(gzip.decompress(static_bytes("stolice.json.gz")))["features"]:
            add_feature(feature)
            props = feature["properties"]
            capital_names.add((props.get("country"), capital_name(props.get("@name") or props.get("name", ""))))
        # The overview map also contains capital markers with legacy IDs.
        for id, name, x, y, _, code, _, original, capital in json.loads(static_bytes("mapa.json"))["miasto"]:
            if not capital or (preset == "capital-cities" and any((code, capital_name(alias)) in capital_names for alias in (name, original) if alias)):
                continue
            south, north = -85, 85
            for _ in range(24):
                middle = (south + north) / 2
                p = math.radians(middle)
                p2, p4 = p * p, p ** 4
                projected_y = 260 - 182.75 * p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)))
                if projected_y > y:
                    south = middle
                else:
                    north = middle
            lat = (south + north) / 2
            p2, p4 = math.radians(lat) ** 2, math.radians(lat) ** 4
            width = 182.75 * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)))
            add(id, name, code, max(-180, min(180, math.degrees((x - 500) / width))), lat)
        if preset in ("cities", "settlements"):
            with open_database(WORLD_CITIES) as database:
                for id, name, country, lon, lat in database.execute("SELECT id, name, label, lon, lat FROM settlements"):
                    add(id, name, country, lon, lat)
        if preset == "settlements":
            with open_database(SETTLEMENTS) as database:
                for id, name, lon, lat in database.execute("SELECT id, name, lon, lat FROM settlements"):
                    add(id, name, "PL", lon, lat)
            for feature in json.loads(gzip.decompress(static_bytes("obrysy-wsi.json.gz")))["features"]:
                add_feature(feature)
        result = list(places.values())
    cache[preset] = result
    server.developer_catalogues = cache
    return result


def fill_map_progress(rows, candidates, percentage, status, *, today=None, rng=None):
    """Fill the selected status to its target share, using only empty places."""
    rng = rng or random.Random()
    today = today or date.today()
    occupied = {(row["kategoria"], row["id"]) for row in rows if row.get("tryb") != SKIP_LINKED}
    empty = [place for place in candidates if (place["kategoria"], place["id"]) not in occupied]
    total = len(candidates)
    candidate_keys = {(place["kategoria"], place["id"]) for place in candidates}
    filled = len({(row["kategoria"], row["id"]) for row in rows
                  if (row["kategoria"], row["id"]) in candidate_keys and row.get("tryb") != SKIP_LINKED
                  and (row.get("tryb") == "plan") == (status == "planned")})
    target = math.ceil(Decimal(str(percentage)) * total / 100)
    count = min(len(empty), max(0, target - filled))
    year = today.year + (80 if status == "planned" else -80)
    try:
        limit = today.replace(year=year)
    except ValueError:
        limit = today.replace(year=year, day=28)
    first, last = sorted((today, limit))
    selected = rng.sample(empty, count)
    added = [{**place, "tryb": "plan" if status == "planned" else "",
              "data": (first + timedelta(days=rng.randrange((last - first).days + 1))).isoformat()}
             for place in selected]
    keys = {(place["kategoria"], place["id"]) for place in selected}
    remaining = [row for row in rows if not (row.get("tryb") == SKIP_LINKED and (row["kategoria"], row["id"]) in keys)]
    return remaining + added, {"added": count, "filled": filled + count, "total": total, "target": target,
                               "remaining": len(empty) - count, "status": status}


class AtlasServer(ThreadingHTTPServer):
    def __init__(self, address, handler):
        self.write_lock = threading.Lock()
        super().__init__(address, handler)

    def server_bind(self):
        if os.name == "nt":
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def linked_visits(self):
        stat = CSV.stat() if CSV.exists() else None
        version = (str(CSV), stat.st_mtime_ns, stat.st_size, stat.st_ino) if stat else None
        if not hasattr(self, '_linked_version') or self._linked_version != version:
            self._linked_rows = add_linked_visits(read_visits(), self)
            self._linked_version = version
        return self._linked_rows


class App(BaseHTTPRequestHandler):
    timeout = 15

    def log_request(self, code="-", size="-"):
        # Keep routine requests from blocking on the launcher's Windows console.
        if sys.stderr is not None and isinstance(code, int) and code >= 500:
            super().log_request(code, size)

    def log_message(self, format, *args):
        if sys.stderr is not None:
            super().log_message(format, *args)

    def send_data(self, data, media_type, *, encoding=None, cache="no-store", filename=None, etag=None):
        if etag and self.headers.get('If-None-Match') == etag:
            self.send_response(304)
            self.send_header('ETag', etag)
            self.send_header('Cache-Control', cache)
            self.end_headers()
            return
        if not encoding and not filename and len(data) >= 2048 and ('json' in media_type or media_type.startswith('text/')) and accepts_gzip(self.headers.get('Accept-Encoding', '')):
            data = gzip.compress(data, compresslevel=3, mtime=0)
            encoding = 'gzip'
        self.send_response(200)
        self.send_header("Content-Type", media_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        if etag:
            self.send_header('ETag', etag)
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        if encoding:
            self.send_header("Content-Encoding", encoding)
        if encoding or 'json' in media_type or media_type.startswith('text/'):
            self.send_header("Vary", "Accept-Encoding")
        self.end_headers()
        self.wfile.write(data)

    def send_visits(self, rows):
        visits = [{**row, "kolejne_wizyty": additional_visits(row)} for row in rows if row["kategoria"] in MAP_CATEGORIES
                  and row.get("tryb") != SKIP_LINKED]
        for row in visits:
            if row["kategoria"] == "rejon":
                row["level"] = "subregion" if row["id"] in getattr(self.server, "subregion_ids", ()) else "region"
        self.send_data(json.dumps(visits, ensure_ascii=False).encode(), "application/json")

    def send_pins(self, rows):
        pins = [{**row, "kolejne_wizyty": additional_visits(row)} for row in rows if row["kategoria"] == "pinezka"]
        self.send_data(json.dumps(pins, ensure_ascii=False).encode(), "application/json")

    def send_diary(self, rows):
        visits = {key: row.copy() for key, row in diary_visits(rows, include_planned=True).items()}
        for row in visits.values():
            if row["kategoria"] == "rejon" and row["id"] in getattr(self.server, "subregion_ids", ()):
                row["diary_type"] = "subregions"
        if any(row["kategoria"] == "miasto" for row in visits.values()):
            if not hasattr(self.server, "diary_major_ids"):
                self.server.diary_major_ids = {place["id"] for place in developer_candidates(self.server, "major")}
            codes = {id: code for code, id in self.server.country_codes.items()}
            metadata = {}
            for row in visits.values():
                if row["kategoria"] != "miasto":
                    continue
                id = row["id"]
                if id not in metadata:
                    country_id = city_country_id(row, self.server)
                    if not country_id and id.startswith(("overture:", "osm:", "ne:", "jp:")):
                        with open_database(WORLD_CITIES) as database:
                            city = database.execute("SELECT label, lon, lat FROM settlements WHERE id = ?", (id,)).fetchone()
                        if city:
                            country_id = city_country_id({**row, "lon": city[1], "lat": city[2]}, self.server, city[0])
                    metadata[id] = {
                        "country_code": codes.get(country_id, ""),
                        "panstwo_id": country_id or row.get("panstwo_id", ""),
                        "diary_type": "villages" if id.startswith("simc:") else "major" if id in self.server.diary_major_ids else "cities",
                    }
                row.update(metadata[id])
        trips = [{**row, "miejsca": [key for key in trip_members(row) if key in visits]}
                 for row in rows if row["kategoria"] == "wycieczka"]
        self.send_data(json.dumps({"visits": visits, "trips": trips}, ensure_ascii=False).encode(), "application/json")

    def update_diary(self, change):
        trip_id, delete = change["id"], change.get("usun", False)
        if not isinstance(trip_id, str) or not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", trip_id):
            raise ValueError
        if type(delete) is not bool:
            raise ValueError
        rows = read_visits()
        remaining = [row for row in rows if (row["kategoria"], row["id"]) != ("wycieczka", trip_id)]
        if not delete:
            exists = len(remaining) < len(rows)
            members = change["miejsca"]
            if (not isinstance(members, list) or len(members) > 500 or not all(isinstance(key, str) for key in members)
                    or len(members) != len(set(members)) or (not exists and len(members) < 1)):
                raise ValueError
            claimed = {key for row in remaining if row["kategoria"] == "wycieczka" for key in trip_members(row)}
            if not set(members).issubset(diary_visits(rows, include_planned=True)) or claimed.intersection(members):
                self.send_error(409)
                return
            remaining.append(trip_record(change, trip_id, members))
        write_visits(remaining)
        self.send_diary(remaining)

    def send_challenges(self, rows):
        rows = migrate_sea_visits(rows)
        progress = {
            category: [row["id"] for row in rows if row["kategoria"] == category]
            for category in CHALLENGE_CATEGORIES
        }
        self.send_data(json.dumps(progress).encode(), "application/json")

    def send_settings(self, ranges, visibility, layout):
        self.send_data(json.dumps({"ranges": ranges, "defaults": DEFAULT_ZOOMS,
                                   "visibility": visibility, "layout": layout}).encode(), "application/json")

    def do_GET(self):
        try:
            parsed = urlsplit(self.path)
            if parsed.path == '/api/podklad':
                kind = parse_qs(parsed.query).get('kind', [''])[0]
                if kind not in ('country', 'water'):
                    self.send_error(400)
                    return
                path = ASSET_FILES['podklad.json.gz']
                stat = path.stat()
                encoded = accepts_gzip(self.headers.get('Accept-Encoding', ''))
                etag = f'"base-{kind}-{stat.st_mtime_ns:x}-{stat.st_size:x}-{int(encoded)}"'
                body = b'' if self.headers.get('If-None-Match') == etag else basemap_layer(path, stat.st_mtime_ns, stat.st_size, kind)[int(encoded)]
                self.send_data(body, 'application/geo+json', encoding='gzip' if encoded else None, cache='no-cache', etag=etag)
                return
            if parsed.path == '/api/challenge-catalogues':
                self.send_data(challenge_summaries(), 'application/json')
                return
            if parsed.path == "/api/rejony":
                params = parse_qs(parsed.query, keep_blank_values=True)
                if params.get("catalogue") == ["1"]:
                    data = {"type": "FeatureCollection", "features": [
                        {"type": "Feature", "properties": f["properties"], "geometry": None}
                        for f, _ in self.server.admin_boundary_index
                        if (not params.get('country', [''])[0] or f['properties']['country'] == params['country'][0])
                        and (not params.get('levels', [''])[0] or f['properties'].get('level', 'region') in params['levels'][0].split(','))]}
                else:
                    from .admin_boundaries import viewport_features, hydrate_features
                    try:
                        data = hydrate_features(viewport_features(self.server.admin_boundary_index, params))
                    except ValueError:
                        self.send_error(400)
                        return
                self.send_data(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode(), "application/geo+json")
                return
            if parsed.path == "/api/galeria":
                with self.server.write_lock:
                    data = gallery(read_visits())
                self.send_data(json.dumps(data, ensure_ascii=False).encode(), "application/json")
                return
            if parsed.path.startswith("/photos/"):
                name = parsed.path.removeprefix("/photos/")
                if not re.fullmatch(r"[a-f0-9]{64}\.jpg", name):
                    self.send_error(404)
                    return
                path = photo_path(name[:-4])
                if not path.is_file():
                    self.send_error(404)
                    return
                if parse_qs(parsed.query).get('thumbnail') == ['1']:
                    stat = path.stat()
                    etag = f'"thumb-{stat.st_mtime_ns:x}-{stat.st_size:x}"'
                    body = b'' if self.headers.get('If-None-Match') == etag else photo_thumbnail(path, stat.st_mtime_ns, stat.st_size)
                    self.send_data(body, 'image/jpeg', cache='private, no-cache', etag=etag)
                    return
                send_asset(self, path, 'image/jpeg', cache='private, no-cache')
                return
            if parsed.path == "/api/eksport-zdjec":
                with self.server.write_lock:
                    rows = read_visits()
                with tempfile.TemporaryFile() as archive:
                    archive_photos(rows, archive)
                    size = archive.tell()
                    archive.seek(0)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/zip")
                    self.send_header("Content-Length", str(size))
                    self.send_header("Content-Disposition", 'attachment; filename="travel-tracker-photos.zip"')
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    import shutil
                    shutil.copyfileobj(archive, self.wfile)
                return
            if parsed.path == "/api/instance":
                self.send_data(json.dumps({"application": "travel-tracker", "instance": INSTANCE_KEY}).encode(), "application/json")
                return
            if parsed.path == "/api/stolica-dzielnice":
                from .capital_districts import capital_districts
                try:
                    identifier = parse_qs(parsed.query)["id"][0]
                    if len(identifier) > 250:
                        raise ValueError
                    data = capital_districts(identifier, read_settings()[2]["online_details"] != "off")
                except (ValueError, KeyError, StopIteration):
                    self.send_error(400)
                    return
                self.send_data(json.dumps(data, ensure_ascii=False).encode(), "application/json")
                return
            if parsed.path in ("/api/obszar", "/api/obszar-szukaj", "/api/obszar-liczniki"):
                from .focus_map import focus_area, search_area, area_counts
                try:
                    params = parse_qs(parsed.query)
                    category, id = params["category"][0], params["id"][0]
                    if len(id) > 250:
                        raise ValueError
                    if parsed.path.endswith("-szukaj"):
                        data = search_area(category, id, params["q"][0], params.get("villages", ["1"])[0] != "0")
                    elif parsed.path.endswith("-liczniki"):
                        data = area_counts(category, id)
                    else:
                        data = focus_area(category, id)
                except (ValueError, KeyError, StopIteration):
                    self.send_error(400)
                    return
                self.send_data(json.dumps(data, ensure_ascii=False).encode(), "application/json")
                return
            if parsed.path == "/api/eksport-dziennika":
                from .journal_export import build_journal
                params = parse_qs(parsed.query)
                format = params.get("format", [""])[0]
                language = params.get("language", [read_settings()[2]["language"]])[0]
                title = params.get("title", [""])[0].strip()
                include_planned = params.get("include_planned", ["0"])[0]
                if (format not in ("pdf", "docx") or language not in ("pl", "en") or include_planned not in ("0", "1") or len(title) > 100
                        or any(ord(character) < 32 for character in title)):
                    self.send_error(400)
                    return
                with self.server.write_lock:
                    rows = read_visits()
                model = journal_model(rows, self.server, language, title, read_settings()[2]["user_name"], include_planned == "1")
                try:
                    data = build_journal(model, country_shapes(), format)
                except Exception:
                    self.log_error("Journal export failed: %s", traceback.format_exc())
                    self.send_error(500)
                    return
                media = "application/pdf" if format == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                self.send_data(data, media, filename=f"travel-journal-{date.today().isoformat()}.{format}")
                return
            if parsed.path == "/api/eksport":
                try:
                    format = parse_qs(parsed.query)["format"][0]
                    with self.server.write_lock:
                        rows = read_visits()
                    data, media_type, extension = export_progress(rows, format, self.server)
                except (ValueError, KeyError):
                    self.send_error(400)
                    return
                self.send_data(data, media_type, filename=f"travel-tracker-{date.today().isoformat()}.{extension}")
                return
            if parsed.path in ("/api/wsie", "/api/miasta", "/api/woda", "/api/odwiedzone-obrysy"):
                try:
                    params = parse_qs(parsed.query)
                    if parsed.path == "/api/odwiedzone-obrysy":
                        data = read_visited_outlines(self.server.static_cities)
                    elif parsed.path == "/api/woda":
                        data = read_water(params)
                    else:
                        data = read_settlements(params, world=parsed.path == "/api/miasta")
                except (ValueError, KeyError):
                    self.send_error(400)
                    return
                body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
                if accepts_gzip(self.headers.get("Accept-Encoding", "")):
                    self.send_data(gzip.compress(body, compresslevel=4), "application/json", encoding="gzip")
                else:
                    self.send_data(body, "application/json")
            elif self.path == "/api/odwiedzone":
                with self.server.write_lock:
                    self.send_visits(self.server.linked_visits())
            elif self.path == "/api/pinezki":
                self.send_pins(read_visits())
            elif self.path == "/api/dziennik":
                self.send_diary(read_visits())
            elif self.path == "/api/wyzwania":
                self.send_challenges(read_visits())
            elif self.path == "/api/osiagniecia":
                try:
                    definitions = read_achievements()
                except ValueError as error:
                    data = {"line": error.args[0] if type(error.args[0]) is int else 1}
                except csv.Error:
                    data = {"line": 1}
                else:
                    rows = read_visits()
                    data = {"definitions": definitions, "developerUnlocked": developer_achievements_unlocked(rows),
                            "tripCountries": most_countries_in_trip(rows, self.server)}
                self.send_data(json.dumps(data, ensure_ascii=False).encode(), "application/json")
            elif self.path == "/api/developer/progress":
                if read_settings()[2]["developer_panel"] != "on":
                    self.send_error(403)
                    return
                self.send_data(json.dumps({"achievementsUnlocked": developer_achievements_unlocked(read_visits())}).encode(), "application/json")
            elif self.path == "/api/ustawienia":
                self.send_settings(*read_settings())
            elif self.path in ("/odwiedzone.csv", "/ustawienia.csv", "/osiagniecia.csv"):
                path = {"/odwiedzone.csv": CSV, "/ustawienia.csv": SETTINGS, "/osiagniecia.csv": ACHIEVEMENTS}[self.path]
                self.send_data(path.read_bytes(), "text/plain; charset=utf-8")
            elif parsed.path in ASSETS:
                filename, media_type = ASSETS[parsed.path]
                send_asset(self, ROOT / filename, media_type)
            else:
                self.send_error(404)
        except (OSError, sqlite3.Error):
            self.send_error(500)

    def do_POST(self):
        if self.path not in ("/api/odwiedzone", "/api/pinezki", "/api/ustawienia", "/api/wyzwania",
                             "/api/dziennik", "/api/reset-postepu", "/api/developer/fill-map", "/api/developer/progress", "/api/import-postepu", "/api/zdjecia", "/api/galeria"):
            self.send_error(404)
            return
        origin = self.headers.get("Origin")
        if origin != f"http://127.0.0.1:{self.server.server_port}":
            self.send_error(403)
            return
        try:
            size = int(self.headers.get("Content-Length", 0))
            size_limit = {"/api/pinezki": 24576, "/api/odwiedzone": 16384, "/api/dziennik": 131072, "/api/zdjecia": 35 * 1024 * 1024,
                          "/api/import-postepu": 2 * TRANSFER_LIMIT, "/api/galeria": 32768}.get(self.path, 2048)
            if not 0 < size <= size_limit:
                raise ValueError
            change = json.loads(self.rfile.read(size))
        except ValueError:
            self.send_error(400)
            return
        with self.server.write_lock:
            self.apply_update(change)

    def apply_update(self, change):
        try:
            if self.path == "/api/galeria":
                update_gallery(change, read_visits())
                self.send_data(json.dumps(gallery(read_visits()), ensure_ascii=False).encode(), "application/json")
                return
            if self.path == "/api/zdjecia":
                if (not isinstance(change, dict) or set(change) not in ({"data"}, {"data", "name"})
                        or not isinstance(change.get("name", ""), str) or len(change.get("name", "")) > 250):
                    raise ValueError
                self.send_data(json.dumps(store_photo(change["data"], change.get("name", ""))).encode(), "application/json")
                return
            if self.path == "/api/import-postepu":
                if (not isinstance(change, dict) or set(change) != {"format", "content", "potwierdzam"}
                        or type(change["potwierdzam"]) is not bool):
                    raise ValueError
                try:
                    rows = import_progress(change["content"], change["format"], self.server)
                except (ValueError, TypeError, KeyError, csv.Error, OverflowError, RecursionError):
                    self.send_error(400)
                    return
                if change["potwierdzam"]:
                    write_visits(rows)
                self.send_data(json.dumps({"records": len(rows), "imported": change["potwierdzam"]}).encode(), "application/json")
                return
            if self.path == "/api/developer/progress":
                if read_settings()[2]["developer_panel"] != "on":
                    self.send_error(403)
                    return
                if not isinstance(change, dict):
                    raise ValueError
                kind, action = change["kind"], change["action"]
                rows = read_visits()
                if kind == "achievements":
                    if set(change) != {"kind", "action"} or action not in ("unlock", "reset"):
                        raise ValueError
                    unlocked = developer_achievements_unlocked(rows)
                    if action == "reset" and not unlocked:
                        self.send_error(409)
                        return
                    updated = [row for row in rows if (row["kategoria"], row["id"]) != ("osiagniecie", "developer_all")]
                    if action == "unlock":
                        updated.append({"kategoria": "osiagniecie", "id": "developer_all", "tryb": "unlock"})
                    changed = int(unlocked != (action == "unlock"))
                elif kind == "challenges":
                    if (set(change) != {"kind", "action", "challenge"} or action not in ("complete", "reset")
                            or change["challenge"] not in (*DEVELOPER_CHALLENGES, "all")):
                        raise ValueError
                    updated, changed = update_developer_challenges(rows, change["challenge"], action)
                else:
                    raise ValueError
                if updated != rows:
                    write_visits(updated)
                self.send_data(json.dumps({"kind": kind, "action": action, "changed": changed,
                                           "achievementsUnlocked": developer_achievements_unlocked(updated)}).encode(), "application/json")
                return
            if self.path == "/api/developer/fill-map":
                if read_settings()[2]["developer_panel"] != "on":
                    self.send_error(403)
                    return
                if not isinstance(change, dict) or set(change) != {"preset", "percentage", "status"}:
                    raise ValueError
                preset, percentage, status = change["preset"], change["percentage"], change["status"]
                if (preset not in FILL_PRESETS or status not in ("visited", "planned")
                        or type(percentage) not in (int, float) or not math.isfinite(percentage) or not 0 <= percentage <= 100):
                    raise ValueError
                rows, result = fill_map_progress(read_visits(), developer_candidates(self.server, preset), percentage, status)
                if result["added"]:
                    write_visits(add_linked_visits(rows, self.server))
                self.send_data(json.dumps(result).encode(), "application/json")
                return
            if self.path == "/api/reset-postepu":
                if not isinstance(change, dict) or change.keys() != {"potwierdzam"} or change["potwierdzam"] is not True:
                    raise ValueError
                ranges, visibility, layout = read_settings()
                layout["developer_panel"] = "off"
                write_settings(ranges, visibility, layout)
                write_visits([])
                self.send_data(b'{"reset":true}', "application/json")
                return
            if self.path == "/api/dziennik":
                self.update_diary(change)
                return
            if self.path == "/api/pinezki":
                place_id, delete = change["id"], change.get("usun", False)
                if not isinstance(place_id, str) or not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", place_id):
                    raise ValueError
                if type(delete) is not bool:
                    raise ValueError
                rows = read_visits()
                existing = next((row for row in rows if (row["kategoria"], row["id"]) == ("pinezka", place_id)), {})
                rows = [row for row in rows if row is not existing]
                if not delete:
                    record = {**existing, **pin_record(change, place_id)}
                    visit_details({field: record[field] for field in ("data", "data_konca") if field in record})
                    rows.append(record)
                write_visits(rows)
                self.send_pins(rows)
                return
            if self.path == "/api/wyzwania":
                category, place_id, selected = change["kategoria"], change["id"], change["odwiedzone"]
                if category not in CHALLENGE_CATEGORIES or not isinstance(place_id, str) or type(selected) is not bool:
                    raise ValueError
                if category == 'morze':place_id=sea_catalogue()[1].get(place_id,place_id)
                name, lon, lat = challenge_places(category)[place_id]
                rows = migrate_sea_visits(read_visits())
                if category == "park_narodowy" and selected:
                    attractions = challenge_places("atrakcja_parku")
                    if not any(row["kategoria"] == "atrakcja_parku" and row["id"].startswith(place_id + ":")
                               and row["id"] in attractions for row in rows):
                        raise ValueError
                rows = [row for row in rows if (row["kategoria"], row["id"]) != (category, place_id)]
                if selected:
                    rows.append({"kategoria": category, "id": place_id, "nazwa": name, "lon": lon, "lat": lat})
                write_visits(rows)
                self.send_challenges(rows)
                return
            if self.path == "/api/ustawienia":
                if not isinstance(change, dict) or not change or change.keys() - {"ranges", "visibility", "layout"}:
                    raise ValueError
                ranges, visibility, layout = read_settings()
                if "ranges" in change:
                    updated = change["ranges"]
                    if not isinstance(updated, dict) or updated.keys() != DEFAULT_ZOOMS.keys():
                        raise ValueError
                    ranges = {name: validate_zoom(updated[name]["min"], updated[name]["max"]) for name in DEFAULT_ZOOMS}
                if "visibility" in change:
                    updated = change["visibility"]
                    if (not isinstance(updated, dict) or updated.keys() != DEFAULT_VISIBILITY.keys()
                            or any(type(value) is not bool for value in updated.values())
                            or not any(updated[name] for name in DEFAULT_ZOOMS)):
                        raise ValueError
                    visibility = updated
                if "layout" in change:
                    updated = change["layout"]
                    if (not isinstance(updated, dict) or updated.keys() - LAYOUT_VALUES.keys()
                            or any(not valid_layout_value(key, value) for key, value in updated.items())):
                        raise ValueError
                    layout.update({key: value.strip() if key == "user_name" else value for key, value in updated.items()})
                write_settings(ranges, visibility, layout)
                self.send_settings(ranges, visibility, layout)
                return
            category, place_id = change["kategoria"], change["id"]
            selected = change["odwiedzone"]
            planning = change.get("planowane", False)
            create_only = change.get("tylko_nowe", False)
            if category not in ("kontynent", "panstwo", "rejon", "miasto") or not isinstance(place_id, str):
                raise ValueError
            if any(type(flag) is not bool for flag in (selected, planning, create_only)):
                raise ValueError
            details = visit_details(change)
            rows = read_visits()
            def same_place(row):
                return (row["kategoria"], row["id"]) == (category, place_id)

            existing = [row for row in rows if same_place(row) and row.get("tryb") != SKIP_LINKED]
            stored = next((row for row in existing if row.get("tryb") != "plan"), existing[0] if existing else None)
            if selected and create_only and stored:
                self.send_visits(add_linked_visits(rows, self.server))
                return
            place = stored or self.server.places.get((category, place_id))
            if place is None and category == "miasto" and isinstance(place_id, str) and re.fullmatch(r"simc:[0-9]{7}", place_id):
                with open_database(SETTLEMENTS) as database:
                    settlement = database.execute("SELECT name FROM settlements WHERE id = ?", (place_id,)).fetchone()
                if settlement is None:
                    raise ValueError
                place = {"kategoria": category, "id": place_id, "nazwa": settlement[0]}
            if place is None and category == "miasto" and isinstance(place_id, str) and place_id.startswith(("osm:", "ne:", "jp:")):
                with open_database(WORLD_CITIES) as database:
                    settlement = database.execute("SELECT name, label FROM settlements WHERE id = ?", (place_id,)).fetchone()
                if settlement is None:
                    raise ValueError
                name, country_code = settlement
                place = {"kategoria": category, "id": place_id, "nazwa": name,
                         "panstwo_id": self.server.country_codes.get(country_code)}
            if place is None:
                name = change["nazwa"]
                if (
                    category != "miasto" or not isinstance(place_id, str)
                    or not re.fullmatch(r"overture:[a-f0-9]{32}|overture:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", place_id)
                    or not isinstance(name, str) or not 0 < len(name) <= 250
                    or name != name.strip() or name.startswith(("=", "+", "-", "@"))
                    or any(ord(char) < 32 for char in name)
                ):
                    raise ValueError
                place = {"kategoria": category, "id": place_id, "nazwa": name}
            if selected:
                combined = {**place, **details}
                visit_details({field: combined[field] for field in ("data", "data_konca") if field in combined})
            position = change.get("pozycja")
            if category == "miasto" and selected and position is not None and not stored:
                lon, lat = position
                if (
                    type(lon) not in (int, float) or type(lat) not in (int, float)
                    or not -180 <= lon <= 180 or not -85.05113 <= lat <= 85.05113
                ):
                    raise ValueError
                place = {**place, "lon": round(lon, 6), "lat": round(lat, 6)}
            if category == "miasto" and selected:
                country_code = change.get("panstwo")
                country_id = city_country_id(place, self.server, country_code if isinstance(country_code, str) else "")
                if country_id is not None:
                    place = {**place, "panstwo_id": country_id}
        except (ValueError, KeyError, TypeError):
            self.send_error(400)
            return
        except (OSError, sqlite3.Error):
            self.send_error(500)
            return
        try:
            rows = [row for row in rows if not same_place(row)]
            if selected:
                rows.append({**place, **details, "tryb": "plan" if planning else ""})
            rows = add_linked_visits(rows, self.server)
            if not selected:
                # A removed country or region can still be implied by a saved visit within it.
                for row in rows:
                    if same_place(row) and row.get("tryb") == "auto":
                        row["tryb"] = SKIP_LINKED
            write_visits(rows)
            self.send_visits(rows)
        except OSError:
            self.send_error(500)


def run_atlas(instance_file):
    USER_DATA.mkdir(parents=True, exist_ok=True)
    records = json.loads(static_bytes("mapa.json"))
    polish_cities = json.loads(gzip.decompress(static_bytes("miasta-polska.json.gz")))["features"]
    major_cities = json.loads(gzip.decompress(static_bytes("duze-miasta.json.gz")))["features"]
    from .focus_map import administrative_features
    admin_regions = administrative_features()
    try:
        server = AtlasServer(("127.0.0.1", 8765), App)
    except OSError as error:
        if error.errno not in (48, 98, 10048) and getattr(error, "winerror", None) != 10048:
            raise
        server = AtlasServer(("127.0.0.1", 0), App)
    with server:
        if SETTINGS.exists():
            with SETTINGS.open(encoding="utf-8-sig", newline="") as file:
                rows = csv.DictReader(file)
                stored = {row.get("widok") for row in rows}
                migrate = (not set(SETTINGS_FIELDS).issubset(rows.fieldnames or [])
                           or (DEFAULT_VISIBILITY.keys() | DEFAULT_LAYOUT.keys()) - stored)
        else:
            migrate = True
        if migrate:
            write_settings(*read_settings())
        if not CSV.exists():
            write_visits([])
        server.places = {
            (category, item[0]): {
                "kategoria": category, "id": item[0], "nazwa": item[1]
            }
            for category, items in records.items() for item in items
        }
        server.countries = {item[0]: server.places["panstwo", item[0]] for item in records["panstwo"]}
        server.country_codes = {item[5]: item[0] for item in records["panstwo"] if item[5]}
        country_continents = {}
        server.continent_territories = {}
        for continent in json.loads(static_bytes("kontynenty.json")):
            id = continent["id"]
            server.places["kontynent", id] = {"kategoria": "kontynent", "id": id, "nazwa": continent["name"]}
            country_continents.update(dict.fromkeys(continent["codes"].split(), id))
            for code, west, south, east, north in continent.get("territories", []):
                country_id = server.country_codes[code]
                server.continent_territories.setdefault(country_id, []).append((west, south, east, north, id))
        server.continents_by_country = {item[0]: country_continents[item[5] or item[0]] for item in records["panstwo"]}
        server.city_codes = {item[0]: item[5] for item in records["miasto"] if item[5]}
        server.static_cities = {feature["properties"]["division_id"]: feature for feature in polish_cities}
        for feature in major_cities:
            id = feature["properties"]["division_id"]
            if ":" not in id:
                id = "overture:" + id
            server.static_cities[id] = feature
        for feature in json.loads(gzip.decompress(static_bytes("stolice.json.gz")))["features"]:
            props = feature["properties"]
            id = props["division_id"]
            if ":" not in id and props.get("legacy_id") != id:
                id = "overture:" + id
            server.static_cities.setdefault(id, feature)
            server.city_codes[id] = props.get("country", "")
            server.places.setdefault(("miasto", id), {"kategoria":"miasto", "id":id,
                "nazwa":props.get("@name") or props["name"], "panstwo_id":server.country_codes.get(props.get("country"), "")})
        province_teryt = dict(zip(
            ("PL-DS", "PL-KP", "PL-LU", "PL-LB", "PL-LD", "PL-MA", "PL-MZ", "PL-OP",
             "PL-PK", "PL-PD", "PL-PM", "PL-SL", "PL-SK", "PL-WN", "PL-WP", "PL-ZP"),
            (f"{code:02d}" for code in range(2, 33, 2)),
        ))
        server.region_shapes = {}
        server.subregion_shapes = {}
        server.subregion_ids = {f["properties"]["id"] for f in admin_regions if f["properties"].get("level") == "subregion"}
        server.region_parents = {f["properties"]["id"]: f["properties"]["parent_id"] for f in admin_regions if f["properties"].get("parent_id")}
        server.polish_region_codes = {}
        server.polish_region_names = {}
        server.admin_boundary_index = []
        for feature in admin_regions:
            props = feature["properties"]
            country = server.country_codes.get(props["country"])
            shapes = server.subregion_shapes if props.get("level") == "subregion" else server.region_shapes
            polygons = list(polygon_bounds(props["id"], feature["geometry"])) if feature["geometry"] else []
            shapes.setdefault(country, []).extend(polygons)
            server.admin_boundary_index.append((feature, [polygon[0] for polygon in polygons] or feature.get('bboxes') or [feature['bbox']]))
            server.places["rejon", props["id"]] = {
                "kategoria": "rejon", "id": props["id"], "nazwa": props["name"],
                "lon": props["lon"], "lat": props["lat"],
                "panstwo_id": country,
            }
            if props["country"] == "PL" and props.get("level") != "subregion":
                iso = props["alias"].split()[-1]
                server.polish_region_codes[province_teryt[iso]] = props["id"]
                name = props["name"].casefold().removeprefix("województwo ")
                server.polish_region_names[name] = props["id"]
        server.places.update({
            ("miasto", feature["properties"]["division_id"]): {
                "kategoria": "miasto",
                "id": feature["properties"]["division_id"],
                "nazwa": feature["properties"]["name"],
            }
            for feature in polish_cities
        })
        visits = read_visits()
        merged = migrate_sea_visits(visits)
        if merged != visits and CSV.exists():
            backup = USER_DATA/'backups'/'before-seas-merge.csv'
            if not backup.exists():
                backup.parent.mkdir(parents=True,exist_ok=True)
                backup.write_bytes(CSV.read_bytes())
        updated = add_linked_visits(merged, server)
        if updated != visits:
            write_visits(updated)
        address = f"http://127.0.0.1:{server.server_port}"
        instance_file.seek(0)
        instance_file.truncate()
        instance_file.write(address)
        instance_file.flush()
        if sys.stdout is not None:
            print(f"{APP_NAME}: {address}  (Ctrl+C)", flush=True)
        if "--no-browser" not in sys.argv:
            threading.Thread(target=webbrowser.open, args=(address,), daemon=True).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


def existing_atlas(address):
    try:
        parsed = urlsplit(address)
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port:
            return False
        with build_opener().open(address + "/api/instance", timeout=1) as response:
            data = json.load(response)
        return data.get("application") == "travel-tracker" and data.get("instance") == INSTANCE_KEY
    except (OSError, ValueError):
        return False


def main():
    import msvcrt

    lock_path = Path(tempfile.gettempdir()) / ("travel-tracker-" + INSTANCE_KEY + ".lock")
    with lock_path.open("a+b") as lock, lock_path.with_suffix(".address").open("a+", encoding="utf-8") as address_file:
        lock.seek(0, os.SEEK_END)
        if lock.tell() == 0:
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            for _ in range(120):
                address_file.seek(0)
                address = address_file.read().strip()
                if existing_atlas(address):
                    if "--no-browser" not in sys.argv:
                        webbrowser.open(address)
                    return
                time.sleep(0.25)
            raise RuntimeError(f"{APP_NAME} nie zakończył uruchamiania. Spróbuj ponownie.")
        try:
            address_file.seek(0)
            address_file.truncate()
            run_atlas(address_file)
        finally:
            address_file.seek(0)
            address_file.truncate()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def launch():
    try:
        main()
    except Exception:
        details = traceback.format_exc()
        log_path = ROOT / "blad-uruchamiania.log"
        try:
            log_path.write_text(details, encoding="utf-8")
            message = f"Nie udało się uruchomić aplikacji. Szczegóły zapisano w pliku:\n{log_path}"
        except OSError:
            message = "Nie udało się uruchomić aplikacji. Rozpakuj cały folder w miejscu, do którego masz prawo zapisu."
        if sys.stderr is not None:
            sys.stderr.write(details)
        if os.name == "nt":
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, message, APP_NAME, 0x10)
        sys.exit(1)


if __name__ == "__main__":
    launch()
