#!/usr/bin/env python3
"""Encode lossless baselines and compare RGB pixels with an explicit tolerance."""
import argparse, hashlib, json, math
from pathlib import Path
from PIL import Image, ImageChops
THRESHOLD=16
FRACTION=0.0015
def compare(expected,actual,diff=None,exact=False):
    with Image.open(expected) as a, Image.open(actual) as b:
        a,b=a.convert("RGB"),b.convert("RGB")
        if a.size!=b.size:
            return dict(passed=False,expectedSize=list(a.size),actualSize=list(b.size),reason="Image dimensions differ")
        threshold,fraction=(0,0) if exact else (THRESHOLD,FRACTION)
        delta=ImageChops.difference(a,b);r,g,blue=delta.split()
        mask=ImageChops.lighter(ImageChops.lighter(r,g),blue).point(lambda n: 255 if n>threshold else 0)
        different=mask.histogram()[255];total=a.width*a.height
        result=dict(width=a.width,height=a.height,changedPixels=different,pixels=total,
                    channelThreshold=threshold,allowedFraction=fraction,passed=different<=math.floor(fraction*total))
        if diff and not result["passed"]:
            Path(diff).parent.mkdir(exist_ok=True,parents=True)
            Image.composite(Image.new("RGB",a.size,"#bc332b"),b.convert("L").convert("RGB"),mask).save(diff,format="WEBP",lossless=True,method=4)
        return result
if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest="cmd",required=True)
    enc=sub.add_parser("pack");enc.add_argument("png");enc.add_argument("webp",type=Path)
    cmp=sub.add_parser("compare");cmp.add_argument("expected");cmp.add_argument("actual");cmp.add_argument("--diff");cmp.add_argument("--exact",action="store_true")
    a=p.parse_args()
    if a.cmd=="compare":
        r=compare(a.expected,a.actual,a.diff,a.exact);print(json.dumps(r));raise SystemExit(not r["passed"])
    a.webp.parent.mkdir(parents=True,exist_ok=True)
    with Image.open(a.png) as im: im.convert("RGB").save(a.webp,format="WEBP",lossless=True,method=4)
    print(hashlib.sha256(a.webp.read_bytes()).hexdigest())
