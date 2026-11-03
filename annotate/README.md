# Chess Annotation Studio

Public frontend: https://haoyu-zhao.github.io/chessdemo/annotate/

The interface defaults to English, with a persistent Chinese language switch.
It uses the existing Chess Studio board assets and a vendored chess.js 1.4.0
rules library (BSD-2-Clause; license in static/vendor/).

Start from the standard initial position. Stockfish suggests three next moves;
select one, tick relevant concepts, and explain why it fits this position.
The primary Save & switch button saves and verifies this annotation, plays the
selected move, rotates the board to the next side, and loads that side's engine
suggestions with a fresh annotation. White and Black alternate throughout the
game. A failed save never advances the position. Edits made during a save must
be saved again before advancing. Save without switching retains the position;
Skip annotation advances while retaining any meaningful local draft. Candidate
clicks are explicitly labeled as previews. New game starts again.
FEN/PGN import remains available in the collapsed position menu.
The 24 labels are **explanatory relevance**:
unchecked means not selected as a reason, not that a board feature is absent.
Labels are not engine output or verified causal effects.

Records are posted to an authenticated collector on the owner's Z890 computer.
Only endpoint metadata is public. No access codes, sessions, annotations or
database files belong in this repository. The connection branch contains
annotation-endpoint.json; this directory has a fallback endpoint file.

New records use schema chess-annotation-2 and bind the human explanation to
a persisted engine analysis ID. The server rejects mismatched positions,
histories or actions. Legacy v1 records remain readable and editable.
Each record includes before/after FEN, legal UCI/SAN move,
move history, stable concept IDs, a binary vector and its ordering, human text,
source, schema/catalog version, timestamps and revision. No name or annotator
identity is requested. Engine evidence includes version and binary hash,
search settings, three ranked candidates, mover-relative CP/mate scores,
depth and legal continuations. No LLM generates the human explanation.
Changing positions or target moves starts a separate draft. Saving commits a
SQLite transaction and the browser reads it back before reporting success.
Retry IDs and revision checks protect against duplicate or stale writes.

Server exports: JSON (with catalog), JSONL (one record per line), UTF-8 CSV.
Download annotation saves the current record to the visitor's own computer,
including unsaved/offline drafts, engine evidence, labels and original text.
Download this device's annotations exports the records retained in that browser.
Local exports contain readable records plus restoration entries and mark
unsaved content as draft. They can be imported again. CSV prefixes
potential spreadsheet formulas with an apostrophe; JSON preserves exact text.
Browser download initiation is shown separately from successful server saves.

The collector requires Z890 and its network connection to be running. Local
drafts remain in browser storage until submitted or exported. Collection access
grants read/write access to this shared research collection. Share link copies
the complete invitation; recipients do not enter a name, install software or
connect manually to Z890. The address bar omits the invitation code after entry,
so use Share link rather than copying the stripped address bar.
