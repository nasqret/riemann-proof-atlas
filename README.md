# Riemann proof atlas

Explore the written Lean theorems and lemmas of the Riemann hypothesis project on Leland McInnes’s map of arXiv papers. Select a subject or proof bundle, click a theorem, and follow **Open Lean source** to its original line. **Trace full graph path** explains how one of the five endpoint statements reaches the chosen theorem.

**[Explore the map](https://nasqret.github.io/riemann-proof-atlas/)** · [Reading notes](https://nasqret.github.io/riemann-proof-atlas/notes.html) · [Public reading dashboard](https://nasqret.github.io/riemann-rev/) · [Original paper map](https://lmcinnes.github.io/datamapplot_examples/arXiv/)

The atlas covers 818,755 written declarations, 1,448 proof bundles and 2,477,303 papers. The standalone edition includes the search indexes, map tiles, paper coordinates and theorem records.

Serve this directory locally with Python and open [the local map](http://127.0.0.1:8000/).

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

The [file inventory](./SHA256SUMS) records the SHA-256 of every published payload file. The [Lean archive](https://github.com/leanprover-community/riemann-hypothesis/tree/40e56bab026552e089d7afcfeff08d2defb9c005/src) and [arXiv map revision](https://github.com/lmcinnes/datamapplot_examples/tree/551adb0d3c54a11eaec0d64874370f435b8cc195/arXiv) identify the original sources.
