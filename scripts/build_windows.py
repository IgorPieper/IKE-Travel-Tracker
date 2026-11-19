"""Build the portable Windows application and its client ZIP."""

import csv
import io
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import atlas


def csv_bytes(fields, rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fields)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8-sig")


def main():
    root = ROOT
    build = root / ".build-windows"
    runtime = build / "runtime" / "Scripts" / "python.exe"
    if not runtime.exists():
        subprocess.run([sys.executable, "-m", "venv", str(build / "runtime")], check=True)
    subprocess.run([str(runtime), "-m", "pip", "install", "pyinstaller==6.22.3", "-r", str(root / "requirements.txt")], check=True)
    subprocess.run([
        str(runtime), "-m", "PyInstaller",
        "--noconfirm", "--clean", "--onefile", "--windowed",
        "--name", "Tracker Wyjazdow",
        "--distpath", str(root),
        "--workpath", str(build / "work"),
        "--specpath", str(build),
        str(root / "uruchom.py"),
    ], cwd=root, check=True)

    releases = root / "wydanie"
    releases.mkdir(exist_ok=True)
    destination = releases / "Tracker-Wyjazdow-Windows.zip"
    partial = destination.with_suffix(".zip.tmp")
    asset_names = {filename for filename, _ in atlas.ASSETS.values()}
    asset_names.update(("data/maps/miejscowosci.sqlite3", "data/maps/miasta-swiat.sqlite3",
                        "data/maps/hydrografia.sqlite3", "config/osiagniecia.csv", "Tracker Wyjazdow.exe",
                        "README.md", "LICENSE.md"))
    try:
        with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for filename in sorted(asset_names):
                archive.write(root / filename, "Tracker Wyjazdow/" + filename)
            archive.writestr("Tracker Wyjazdow/data/user/odwiedzone.csv", csv_bytes(atlas.FIELDS, []))
            settings = [
                {"widok": name, "min_zoom": atlas.DEFAULT_ZOOMS.get(name, {}).get("min", ""),
                 "maks_zoom": atlas.DEFAULT_ZOOMS.get(name, {}).get("max", ""), "widoczny": int(visible)}
                for name, visible in atlas.DEFAULT_VISIBILITY.items()
            ]
            settings.extend({"widok": name, "wartosc": value} for name, value in atlas.DEFAULT_LAYOUT.items())
            archive.writestr("Tracker Wyjazdow/data/user/ustawienia.csv", csv_bytes(atlas.SETTINGS_FIELDS, settings))
            archive.writestr("Tracker Wyjazdow/URUCHOMIENIE.txt", (
                f"{atlas.APP_NAME} — Windows 64-bit\r\n\r\n"
                "1. Rozpakuj cały folder z ZIP, np. na Pulpit.\r\n"
                "2. Otwórz Tracker Wyjazdow.exe. Mapa otworzy się w przeglądarce.\r\n\r\n"
                "Program zawiera własne środowisko uruchomieniowe.\r\n"
                "Postęp i ustawienia CSV znajdują się w data/user.\r\n"
                "Definicje osiągnięć znajdują się w config/osiagniecia.csv.\r\n"
                "Zachowaj cały folder aplikacji, gdy przenosisz ją na inny komputer.\r\n"
                "Do internetowych warstw map i kafelków ulic potrzebne jest połączenie z internetem.\r\n"
            ).encode("utf-8-sig"))
        with zipfile.ZipFile(partial) as archive:
            bad_file = archive.testzip()
            if bad_file:
                raise RuntimeError("Uszkodzony plik w wydaniu: " + bad_file)
        partial.replace(destination)
    finally:
        if partial.exists():
            partial.unlink()
    print("Gotowe:", destination)


if __name__ == "__main__":
    main()
