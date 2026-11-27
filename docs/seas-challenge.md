# Dip a Toe in Every Sea

## Display and performance

The sea challenge shows a merged land coastline, with no political borders.
`seas_simple` defaults to `on` and is saved in device settings. Its checkbox is
available in challenge Options and Settings → General → Other.

The default display has around 3,000 polygon vertices. The compressed display file
is under 40 KB. All 52 entries and their original IDs are retained;
only the visible outlines are simplified. Marking and completion are unchanged.

With simple outlines disabled, an approximately 24,000-vertex overview is used at distant
zooms. Full geometry loads at zoom 6 and above, and only seas intersecting the
viewport are submitted to the renderer. Panning within the same set of seas
does not rebuild the source. The sea map skips the unrelated world rivers and
lakes basemap and uses separate, bounded-detail GeoJSON sources.

Regenerate the display files with `scripts/prepare_sea_rendering.py` after
updating either the source sea geometry or country coastline.

The catalogue in `data/challenges/morza-lista.json` has 48 required seas and
four optional entries: the Dead Sea, Caspian Sea, Fiji Sea and Sargasso Sea. Completion requires
90% of the required pool, rounded up: **44 of 48**. Optional visits do not affect
the progress counter or achievement.

Subdivisions are merged into their larger sea rather than counted twice.
The Baltic includes the Gulf of Bothnia, Åland Sea, Archipelago Sea and Väinameri;
the Mediterranean includes its component seas. Other mergers are recorded in
`data/challenges/morza-laczenia.json`. The Baltic geometry includes the entire
SeaVoX region, rather than only a filtered subdivision.

Old visits are migrated to their parent sea and deduplicated. Before the startup
migration changes an existing CSV, its original is kept under
`data/user/backups/before-seas-merge.csv`. Old progress backups remain importable.

The map and progress work offline. A list entry locates the sea. Clicking its
polygon marks or unmarks the visit directly, with no sidebar checkbox, and
records completion in the existing local progress CSV under category `morze`.
Developer completion/reset, progress backups and challenge pinning support it.

## Map coverage and attribution

`data/challenges/morza-wyzwanie.json` has outlines for all 52 entries. Forty-five
come from source polygons. Seven supplemental cartographic outlines are marked
`boundary_kind: approximate`: Argentine, Chilean, Fiji, Irminger, Koro, Salish
and Sargasso Seas. Their selection panel says **Approximate outline**; they are
display areas rather than official hydrographic or maritime limits. There are
no point markers: polygon interiors handle clicks and pointer-following names.

The Cantabrian Sea uses OpenStreetMap relation 4674330. Salish uses a regional
clip of IHO coastal-water geometry. Sargasso uses a generalized, non-rectangular
ecosystem outline following the North Atlantic gyre described by the
[Sargasso Sea Commission](https://www.sargassoseacommission.org/sargasso-sea).
The remaining supplementary shapes are coarse regional sketches clipped against
land, with references stored per feature in `morza-uzupelnienia.json`.

Sources:

- Flanders Marine Institute (2018), IHO Sea Areas v3, via
  [Marine Regions](https://www.marineregions.org/sources.php). CC BY 4.0.
- British Oceanographic Data Centre (2023), SeaVoX Sea Areas v19,
  [doi:10.14284/590](https://doi.org/10.14284/590). CC BY 4.0.
- [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL,
  for named sea locations. Marine Regions Gazetteer records supplement these.

Polygons are simplified at 0.005 degrees and SeaVoX hierarchy members are
merged where necessary. Each feature preserves its source or geographic reference.
Map data retain their respective source licences, independently of the app's
code licence. Supplemental extents can be regenerated using
`scripts/prepare_missing_sea_outlines.py` before running the main preparation
and display-level scripts.

Preparation: `scripts/prepare_seas.py` uses cached source polygons and location
records under `.local/boundaries`; `--refresh-sources` streams the raw IHO and
SeaVoX downloads into simplified caches and requires the build-time `ijson`
package. Raw source downloads are not shipped.
