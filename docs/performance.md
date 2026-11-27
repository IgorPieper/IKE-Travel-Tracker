# Performance work — 27 November 2026

## Main-map outline levels

Country and continent geometry now has separate display-only outline levels.
At zooms below 5 the main map uses an overview, omitting small fjord bends and
coastal details that are smaller than a screen pixel. At zoom 5 and above it
returns to the original geometry, including the corrected coastal capitals.
Sources change only when the level changes; ordinary panning never rebuilds them.
Late responses cannot replace a newer zoom or checkbox choice.

`map_simple` defaults to `off`. Enabling **Simplified land outlines** in map
Options or Settings → General → Render distance keeps strongly simplified
country and continent shapes at every zoom. This setting is independent of
the sea challenge's default-on simple outline option. Both retain the same IDs,
saved visits and plans. The canvas fallback follows the same chosen level.

The country overview transfers 283,269 bytes instead of 780,192 bytes. Very
simple country and continent outlines transfer 70,389 and 36,059 bytes. Original
source geometry and the geometry used by area-focus queries remain unchanged.
Regenerate these assets using `scripts/prepare_world_outlines.py` after updating
either original coastline file.

The offline map keeps its original coordinates and place IDs. The changes reduce
data transfer, work on the browser's main thread, and the size of static databases.

## Measured sizes

| Item | Before | After |
| --- | ---: | ---: |
| World cities database | 198,156,288 B | 136,331,264 B |
| Polish settlements database | 54,816,768 B | 42,602,496 B |
| Rivers and lakes database | 158,457,856 B | 116,076,544 B |
| Initial basemap transfer | 3,230,909 B | 780,192 B |
| Map metadata transfer | 1,931,796 B | 694,437 B |
| Map JavaScript transfer | approximately 188 KB | approximately 48 KB |
| Region data needed by achievements | 11,761,878 B | 2,000 B |
| Decoded challenge catalogues for cards | 10,332,617 B | 1,374,546 B |

The three databases save **116,420,608 bytes** without dropping any features.
Local measurements of decoding 2,000 geometries, median of five repetitions,
were 245 → 215 ms for world cities, 66 → 60 ms for Polish settlements, and
17 → 11 ms for water. These are component measurements on this machine, not
a promise of a fixed frame rate or total startup time on every computer.

## Changes

- Version-aware ETags and conditional requests reuse unchanged assets. Browser
  validation detects updates instead of keeping an obsolete coastline for an hour.
- Compress text and JSON over HTTP; cache prepared static responses in a bounded
  LRU cache. Progress remains private and uses `no-store`.
- Separate the country basemap from local water data at delivery time. Load water
  only in a relevant view and zoom, retaining the complete offline source.
- Cards and achievement calculations load catalogue properties rather than full
  park, island and sea geometries. Opening a challenge loads its complete map.
- Achievement initialization fetches the 50 U.S. states, not the worldwide list
  of regions and subregions. Polish city polygons load when a city view needs them.
- Skip rendering the hidden canvas fallback while WebGL is active. Avoid region
  geometry requests in unrelated views and repeated requests for saved-only
  outlines when only the camera changes.
- Reuse parsed CSV rows, returning independent dictionaries to callers. File
  identity, modification time and size invalidate caches, including atomic saves.
- Gallery and journal use cached 640-pixel previews with lazy, asynchronous image
  decoding. Original photos remain available to details and exports.
- Static geometry uses compressed integer deltas only when every coordinate can
  be represented **exactly**. Higher precision or unsupported geometries retain
  their original representation. Readers support both database formats.

## Verification and rebuilding

`scripts/optimize_map_databases.py --output <directory>` makes separate database
copies. It verifies every decoded geometry and other table fields, and runs
SQLite integrity checks. RTree row identities must stay unchanged. Stop the app
before replacing the three source databases with the verified output files;
rebuild the EXE with the matching geometry reader before distributing them.

Tests cover both geometry encodings, coordinate precision, HTTP compression and
cache invalidation, miniature photo generation, lazy catalogue races and retries,
and reconstruction of the full country/water basemap. Existing map, journal,
challenge, export and editing tests remain part of validation.

External street maps, forest layers and detailed world water tiles still depend
on network and provider response time. Their latency cannot be eliminated by
local application caching.
