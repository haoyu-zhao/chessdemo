# Chess Annotation Studio

Public frontend: https://haoyu-zhao.github.io/chessdemo/annotate/

The interface defaults to English, with a persistent Chinese language switch.
It uses the existing Chess Studio board assets and a vendored chess.js 1.4.0
rules library (BSD-2-Clause; license in static/vendor/).

Select a position and optional move, tick concepts relevant to the explanation,
and write a human explanation. The 24 labels are **explanatory relevance**:
unchecked means not selected as a reason, not that a board feature is absent.
Labels are not engine output or verified causal effects.

Records are posted to an authenticated collector on the owner's Z890 computer.
Only endpoint metadata is public. No access codes, sessions, annotations or
database files belong in this repository. The connection branch contains
annotation-endpoint.json; this directory has a fallback endpoint file.

Each record includes before/after FEN, legal UCI/SAN move (or position scope),
move history, stable concept IDs, a binary vector and its ordering, human text,
annotator alias, source, schema/catalog version, timestamps and revision.
Changing positions or target moves starts a separate draft. Saving commits a
SQLite transaction and the browser reads it back before reporting success.
Retry IDs and revision checks protect against duplicate or stale writes.

Server exports: JSON (with catalog), JSONL (one record per line), UTF-8 CSV.
Browser backups include unsynced drafts and can be imported again. CSV prefixes
potential spreadsheet formulas with an apostrophe; JSON preserves exact text.
Browser download initiation is shown separately from successful server saves.

The collector requires Z890 and its network connection to be running. Local
drafts remain in browser storage until submitted or exported. Collection access
grants read/write access to this shared research collection; annotator names
are research labels, not verified identities.
