# Riemann proof atlas

Explore the Lean declarations behind the Riemann hypothesis project on two maps of arXiv papers. Select a paper, a proof bundle and a declaration to open its Lean source. The snapshot slider follows each edition at its own Git revision.

**[Original map](https://nasqret.github.io/riemann-proof-atlas/)** · **[Paper Sky](https://nasqret.github.io/riemann-proof-atlas/june-map.html)** · **[Full dependency graph](https://nasqret.github.io/riemann-proof-atlas/#graph=1&constant=14065054)** · [All 30 source editions](https://nasqret.github.io/riemann-proof-atlas/notes.html#proof-snapshots) · [Readable edition in Paper Sky](https://nasqret.github.io/riemann-proof-atlas/june-map.html?snapshot=dd2dcbe020d101dc603063ba5a7197b2c69600f1&track=readable)

The last stop on the Proof evolution slider opens Sernau’s compact GRH edition. All 10,953 declarations have locations on both maps. The original submission contains 97.5 times as many written declarations and 204.0 times as many Lean code lines as the compact edition. The readable and compact projects share one commit and have separate source roots. [Open compact](https://nasqret.github.io/riemann-proof-atlas/?snapshot=72fead102f663d5c7a407964a13dc0cf9d977207&edition=grh-compact) · [Paper Sky](https://nasqret.github.io/riemann-proof-atlas/june-map.html?snapshot=72fead102f663d5c7a407964a13dc0cf9d977207&edition=grh-compact) · [Source measurements](https://nasqret.github.io/riemann-proof-atlas/notes.html#sernau-compact) · [Four-page reading note](https://nasqret.github.io/riemann-rev/summary/grh-condensed-summary.pdf)

The submission has 1,068,007 written declarations and 1,484,733 compiled constants. Both maps place every written command and 1,484,660 compiled constants. The remaining 73 are foundational constants such as equality. They remain available in the graph, which contains 116,808,656 directed dependency edges. Later snapshots expose source references at their own revisions. [Placement audit](https://nasqret.github.io/riemann-proof-atlas/data/time-map/placement-audit.json) · [Snapshot source audit](https://nasqret.github.io/riemann-proof-atlas/data/time-map/source-audit.json)

**[Explore the map](https://nasqret.github.io/riemann-proof-atlas/)** · [Watch the 52-second tour](https://nasqret.github.io/riemann-proof-atlas/film/) · [Reading notes](https://nasqret.github.io/riemann-proof-atlas/notes.html) · [Public reading dashboard](https://nasqret.github.io/riemann-rev/) · [Original paper map](https://lmcinnes.github.io/datamapplot_examples/arXiv/)

**[Daily snapshot dashboard](https://nasqret.github.io/riemann-proof-atlas/daily.html)** · [Official history](https://nasqret.github.io/riemann-proof-atlas/daily.html#track=official) · [PR #55 revisions](https://nasqret.github.io/riemann-proof-atlas/daily.html#track=proposal) · [VerifyTask and contributor changes](https://nasqret.github.io/riemann-proof-atlas/daily.html#track=verifytask) · [Daily capture runs](https://github.com/nasqret/riemann-proof-atlas/actions/workflows/atlas-daily.yml)

Use **Map removals** to find a declaration by mathematical subject and open its line in the earlier revision. Each date also indexes all changed modules and gives their before and after source links. UTC days close at midnight. The scheduled capture runs daily at 00:23 UTC and fills gaps left by missed runs. The website reads the current [data archive](https://github.com/nasqret/riemann-proof-atlas/tree/atlas-daily) and ships a local copy for offline use.

[Compare the source editions](https://nasqret.github.io/riemann-proof-atlas/editions.html) · [Read the tower-bound chapter](https://nasqret.github.io/riemann-proof-atlas/#chapter=1.5992) · [Open the note beside its Lean proofs](https://nasqret.github.io/riemann-proof-atlas/companion/index.html)

The edition map preserves the original coordinates for confidently matched declarations and links to the Lean source in each revision. The selector records the submission, merged simplifications and separately pinned proposals. In the tower-bound chapter, select a citation in the note to open its structured proof and the corresponding Lean lines. [Snapshot catalogue](https://nasqret.github.io/riemann-proof-atlas/data/editions/index.json) · [Upstream intake](https://github.com/nasqret/riemann-proof-atlas/blob/atlas-edition-intake/source-editions/intake.json)

[![The interactive atlas showing the classical RH proof filter](film/assets/edition.webp)](https://nasqret.github.io/riemann-proof-atlas/)

The original theorem and lemma layer covers 818,755 written declarations, 4,983 proof bundles and 2,477,303 papers. Of the 818,755 declarations, 802,362 have a subject or contextual placement. Another 16,393 appear in 168 named source sections. Choose **Layers → Placement evidence** to isolate declarations and proofs or their surrounding mathematical context. [Inspect matrix addition](https://nasqret.github.io/riemann-proof-atlas/#theorem=10) · [Browse source sections](https://nasqret.github.io/riemann-proof-atlas/#subject=unresolved) · [Attribution evidence](https://nasqret.github.io/riemann-proof-atlas/data/refinement/index.json)

Select **ζ** to return to the original map. Zooming reveals more declarations while each existing marker keeps its geographic anchor. Use the four-corner icon or **F** for fullscreen. **Inspector** opens the theorem panel while the map stays in fullscreen. Use **/** to search, the arrow keys to pan, and **+** or **−** to zoom.

Serve this directory locally with Python and open [the local map](http://127.0.0.1:8000/).

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

With the explorer open, run the wheel, pinch and attribution checks in the browser console. The check opens three source declarations, zooms through both Lean layers and restores the opening view.

```js
await (await import("./qa/refinement-check.mjs")).checkRefinement()
```

The [file inventory](./SHA256SUMS) records the SHA-256 of every published payload file. The [Lean archive](https://github.com/leanprover-community/riemann-hypothesis/tree/40e56bab026552e089d7afcfeff08d2defb9c005/src) and [arXiv map revision](https://github.com/lmcinnes/datamapplot_examples/tree/551adb0d3c54a11eaec0d64874370f435b8cc195/arXiv) identify the original sources.

[Download the video walkthrough (MP4)](https://nasqret.github.io/riemann-proof-atlas/media/riemann-proof-atlas.mp4)
