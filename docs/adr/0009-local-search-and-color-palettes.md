# 0009: Local full-text and color search

## Status
Accepted

## Context
Browsing needs "search by inspiration": typing words or picking a color to find similar artwork. The project must run offline with no paid services, so no hosted search engine or vision API can be used.

## Decision
- Text search uses SQLite FTS5 (`unicode61` with accent folding, prefix indexes). One index row per listing is rewritten inside the transaction that changes the listing, and the migration backfills existing rows. A `reindex` script rebuilds it.
- Public visibility is never stored in the index. Queries join the same public conditions used for browsing, so a status change takes effect immediately with nothing to resynchronize.
- Search input is reduced to Unicode letters and digits and turned into quoted prefix terms joined by AND. Operators, quotes and punctuation become plain words or disappear, so no input can alter the FTS expression. BM25 weights favor title, then tags, category, artist and description.
- Color uses a palette computed once per uploaded image: a 32x32 sample, flattened onto white, grouped into 4096 bins, top five bins by pixel count with ties broken by bin number, each reported as its bins' mean color with integer weights summing to 10000. It is deterministic and needs no model.
- Similarity is measured in CIELAB (CIE76): each palette color is matched to the nearest color in the other palette, weighted by share, averaged in both directions, and rounded to an integer score from 0 to 1000. Distances beyond 50 count as unrelated, so unrelated listings are left out rather than ranked last.
- A color query scores the newest 2,000 matching listings in application code. Palettes of non-image assets simply do not exist, so those listings can match text but never color.

## Consequences
- Search scales comfortably for a single-node catalog; a much larger catalog would need a precomputed nearest-neighbour structure for colors.
- CIE76 is simple but less accurate than newer color-difference formulas for saturated colors; swapping the distance function would not change the data model.
- Changing the palette algorithm requires recomputing palettes (`npm run reindex` after clearing the table).
