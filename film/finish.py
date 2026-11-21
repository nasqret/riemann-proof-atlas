#!/usr/bin/env python3
"""Add the original instrumental score and prepare a progressive MP4 for X."""
import argparse
import math
from pathlib import Path
import subprocess
import tempfile
import wave

import numpy as np


FPS = 30
SECONDS = 52
RATE = 48000
CHAPTERS = (0, 6, 13.5, 21.5, 29.5, 38, 46, 52)


def soundtrack(path):
    score = np.zeros((RATE * SECONDS, 2), dtype=np.float32)

    def note(start, length, pitch, amplitude, pan, pluck=False):
        begin = round(start * RATE)
        count = min(round(length * RATE), len(score) - begin)
        if count <= 0:
            return
        t = np.arange(count, dtype=np.float32) / RATE
        f = 440 * 2 ** ((pitch - 69) / 12)
        attack = .018 if pluck else .9
        env = (1 - np.exp(-t / attack)) * (1 - np.exp(-(length-t) / .52))
        env *= np.exp(-t / (1.25 if pluck else length*1.9))
        phi = 2 * math.pi * f * t
        sound = amplitude * env * (np.sin(phi) + .21*np.sin(2*phi) + .07*np.sin(3*phi))
        score[begin:begin+count, 0] += sound * math.sqrt((1-pan)/2)
        score[begin:begin+count, 1] += sound * math.sqrt((1+pan)/2)

    roots = (50, 46, 53, 48, 50, 55, 50)
    for i, root in enumerate(roots):
        start, end = CHAPTERS[i:i+2]
        length = min(end-start+.7, SECONDS-start)
        note(start, length, root-12, .082, -.1)
        note(start+.09, length-.1, root+7, .041, .38)
        for j, interval in enumerate((12, 19, 14)):
            note(start+.35+j*1.08, 2.55, root+interval, .06 if j==0 else .035, (-.3,.35,.08)[j], True)
    score[-2*RATE:] *= np.linspace(1, 0, 2*RATE, dtype=np.float32)[:, None]
    pcm = (np.clip(score,-1,1)*32767).round().astype("<i2")
    with wave.open(str(path), "wb") as f:
        f.setparams((2, 2, RATE, 0, "NONE", "not compressed"))
        f.writeframes(pcm.tobytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("h264", type=Path)
    parser.add_argument("mp4", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as directory:
        wav = Path(directory) / "score.wav"
        soundtrack(wav)
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-fflags", "+genpts",
            "-framerate", str(FPS), "-f", "h264", "-i", str(args.h264), "-i", str(wav),
            "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "fast",
            "-crf", "18", "-maxrate", "6M", "-bufsize", "12M", "-threads", "3",
            "-pix_fmt", "yuv420p", "-profile:v", "high", "-level:v", "3.1", "-g", "60",
            "-x264-params", "open-gop=0", "-vf", "setsar=1", "-c:a", "aac",
            "-profile:a", "aac_low", "-b:a", "128k", "-movflags", "+faststart",
            "-t", str(SECONDS), str(args.mp4),
        ], check=True)


if __name__ == "__main__":
    main()
