# Riemann proof atlas film

The 52-second film moves through the same arXiv coordinates, proof bundles and theorem records as the interactive atlas. The remastered sequence follows the point for `lie_add` through a continuous zoom and shows the `Matrix.add` reference in its exported type. Its displayed proof chain is checked against the exported value references before playback. The reading-project scene uses a screenshot of the atlas and the title page of the project's PDF guide.

Play the [animated tour](./index.html) or [download the finished MP4](../media/riemann-proof-atlas.mp4). The MP4 includes an original instrumental score and on-screen text.

## Render a new copy

Serve the standalone site over HTTPS or localhost. Open `film/?studio=1` in a Chromium browser with H.264 WebCodecs support. Select **Render video** and then **Save rendered stream**. The renderer generates 1,560 frames on a fixed clock. Python with NumPy and FFmpeg can add the score and produce the final file.

```sh
python3 film/finish.py atlas-tour.h264 riemann-proof-atlas.mp4
```

The result is a 1280 × 720 progressive H.264 MP4 at 30 fps, with square pixels, AAC-LC stereo audio and a fast-start index. Playback uses the same rendering code as the export. The interactive atlas loads its own interface independently of the film.
