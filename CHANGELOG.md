# Changelog

## 1.1 — 2026-11-25

### Photos and gallery

- Add compressed local photos to places and pins, and multiple captioned photos to trips.
- Browse photos in the new Gallery, available under More by default. Edit descriptions, titles, dates taken and custom tags; view file information and remove photos.
- Read photo titles and dates from image properties and write metadata edits back to the local JPEG.
- Filter photos by automatic trip tags or custom tags. Tag filters update immediately.
- Show a trip's first photo in the journal, with View more photos opening its gallery filter.
- Include photos in PDF and Word journal exports, and export all photos in a ZIP.

### Visits, journal and navigation

- Add separate arrival and departure dates, each with an independent approximate-date checkbox, including repeat visits and pins.
- Improve the place editor, photo replacement controls and configurable closing when clicking the map.
- Give the pin editor explicit Save and Cancel buttons.
- Add a responsive More menu and settings for top-bar visibility. Map always remains available.
- Use one shared permission for detailed maps in area focus and challenges.

### Maps and area focus

- Expand offline administrative data to 48,185 subregions across 172 countries and territories.
- Add missing boundaries across Europe, Africa, Asia, Oceania and the Americas, including German districts, Spanish provinces, Ukrainian districts, US counties and Canadian census divisions.
- Correct regional groupings in Spain, Belgium and the Philippines while preserving existing place IDs.
- Store additional geometry in a compact local database and load boundaries for the visible map area.
- Add a Back arrow for returning through magnifier levels, restoring the previous camera and layer choices.
- Add independent Subregions, Cities and Villages checkboxes in regional focus, with subregions selected by default.
- Show counts for the complete selected area, independently of visible layers and zoom. Unavailable counts display a dash.
- Show subregions directly for countries without regional-tier boundaries, such as Latvia.
- Frame Europe with Iceland and northern Scandinavia, and frame Australia together with Oceania across the date line.
- Add detailed maps at every focus level. Higher levels start with details off and reset them on zoom; the final locality level follows the global permission by default.
- Disable the focus detail checkbox when detailed maps are not allowed in settings. Detailed mode supports custom pins without marking places through map clicks.
- Hide Regions, Subregions, Cities and Villages presets by default; they remain available in settings.
- Toggle the magnifier with the middle mouse button as well as F, and remove the small home controls.

### Updating the Windows application

1. Close the application and back up its folder.
2. Extract the new Windows ZIP into a new folder.
3. Copy the entire `data/user` folder from the old application into the new one, replacing the empty files included in the ZIP. This preserves CSV data, settings and photos. If you edited achievement definitions, also keep your `config/osiagniecia.csv`.
4. Open `Tracker Wyjazdow.exe` in the new folder.

External street maps and other online layers require internet access. Bundled map data and user files remain local.
