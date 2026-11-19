"""Prepare Hewelion's offline map from the City of Gdansk open dataset.

Build-time dependencies: pyshp, pyproj, shapely (not needed by the app).
Source: https://ckan.multimediagdansk.pl/dataset/granice-dzielnic-w-gdansku
License: Creative Commons Attribution; dataset date: 2024-11-06.
"""

import io
import json
import urllib.request
import zipfile
from pathlib import Path

import shapefile
from pyproj import Transformer
from shapely import make_valid, transform
from shapely.geometry import MultiLineString, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://ckan.multimediagdansk.pl/dataset/granice-dzielnic-w-gdansku"
DOWNLOAD = ("https://ckan.multimediagdansk.pl/dataset/6a7eb20f-7b5a-478c-a5c6-385ff0c4247d/"
            "resource/9ebca2d2-7771-49c3-9321-2165cc61e3a3/download/dzielnice.zip")


def main():
    cache = ROOT / ".build-windows" / "gdansk-dzielnice.zip"
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(DOWNLOAD, timeout=60) as response:
            cache.write_bytes(response.read())
    with zipfile.ZipFile(cache) as archive:
        reader = shapefile.Reader(shp=io.BytesIO(archive.read("Dzielnice.shp")),
                                 dbf=io.BytesIO(archive.read("Dzielnice.dbf")), encoding="utf-8")
        districts = [(row.record["NAZWA"], make_valid(shape(row.shape.__geo_interface__)))
                     for row in reader.iterShapeRecords()]
    sea = next(geometry for name, geometry in districts if name == "Zatoka Gdańska")
    districts = [(name, geometry) for name, geometry in districts if name != "Zatoka Gdańska"]
    assert len(districts) == 35
    land = unary_union([geometry for _, geometry in districts])

    def lines(geometry):
        if geometry.geom_type == "LineString":
            yield geometry
        elif hasattr(geometry, "geoms"):
            for part in geometry.geoms:
                yield from lines(part)

    coast = MultiLineString(list(lines(sea.boundary.intersection(land.boundary))))
    assert coast.length > 30000
    project = Transformer.from_crs(2177, 4326, always_xy=True)

    def geometry(value):
        result = mapping(transform(value.simplify(3, preserve_topology=True), project.transform, interleaved=False))

        def rounded(item):
            if isinstance(item, (list, tuple)):
                return [rounded(part) for part in item]
            return round(item, 6)

        return {"type": result["type"], "coordinates": rounded(result["coordinates"])}

    def feature(kind, name, value):
        return {"type": "Feature", "properties": {"kind": kind, "name": name}, "geometry": geometry(value)}

    destination = ROOT / "data" / "challenges" / "heweliony.json"
    data = json.loads(destination.read_text(encoding="utf-8"))
    data["boundary"] = feature("city", "Gdańsk", land)
    data["boundary_source"] = "Urząd Miejski w Gdańsku · Creative Commons Attribution"
    data["offline_map"] = {"type": "FeatureCollection", "features": [
        feature("sea", "Zatoka Gdańska", sea), feature("coastline", "Linia brzegowa", coast),
        *(feature("district", name, value) for name, value in districts),
    ]}
    data["offline_map_source"] = {"url": SOURCE, "date": "2024-11-06", "license": "CC BY",
                                  "attribution": "Urząd Miejski w Gdańsku"}
    destination.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Prepared {len(districts)} districts and {coast.length / 1000:.1f} km of coastline: {destination.stat().st_size} bytes")


if __name__ == "__main__":
    main()
