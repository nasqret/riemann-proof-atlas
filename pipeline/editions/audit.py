"""Check counts, source identities and a stratified sample of links directly against Git."""
from collections import Counter
import argparse
import gzip
import hashlib
import json
import random
from pathlib import Path
from build import ADDED, ABSENT, EDITED, MOVED, Blobs, git, tree, write


def audit(root, repo, lean, registry):
    index=json.loads((lean/"index.json").read_bytes())
    base=registry["baseline"]
    old=tree(repo,base)
    main=git(repo,"rev-parse",registry["observedMain"]+":src").decode().strip()
    stride=index["recordStride"]
    cache={}
    blobs=Blobs(repo)
    result=[]
    for item in registry["editions"]:
        pin=item["commit"]; directory=root/pin
        info=json.loads((directory/"summary.json").read_bytes())
        paths=tree(repo,pin)
        assert info["baseline"]==base and info["sourceFiles"]==len(paths)
        assert all(hashlib.sha256((directory/k).read_bytes()).hexdigest()==v for k,v in info["assets"].items())
        states=gzip.decompress((directory/"states.bin.gz").read_bytes())
        loc=json.loads(gzip.decompress((directory/"locations.json.gz").read_bytes()))
        files=loc["files"]; positions={r:(f,l) for r,f,l in loc["positions"]}
        assert len(states)==index["count"] and len(positions)==len(loc["positions"])
        assert files==sorted(p for p in paths if old.get(p)!=paths[p])
        assert all(states[row] in (EDITED,MOVED) and 0<=f<len(files) and l>=1 for row,(f,l) in positions.items())
        assert all(0<=f<len(files) and l>=1 for _,f,l in loc["added"])
        counts=Counter(states); counts[ADDED]=len(loc["added"])
        assert [counts[i] for i in range(5)]==info["states"]
        assert len(states)-counts[ABSENT]+counts[ADDED]==info["written"]
        rng=random.Random(pin)
        samples=0
        for state in range(5):
            if state==ADDED: ids=range(len(states),len(states)+len(loc["added"]))
            else: ids=[i for i,s in enumerate(states) if s==state]
            for i in rng.sample(ids,min(24,len(ids))):
                if state==ADDED:
                    name,fi,line=loc["added"][i-len(states)]; path=files[fi]
                else:
                    sh=i//stride
                    if sh not in cache:
                        if len(cache)>20:cache.clear()
                        cache[sh]=json.loads(gzip.decompress((lean/f"records/{sh}.json.gz").read_bytes()))
                    r=cache[sh][i%stride]; name=r["name"]; path=r["file"]; line=r["line"]
                    if state==0: assert old[path]==paths[path]
                    if state==EDITED: assert old[path]!=paths[path]
                    if state==ABSENT: assert old[path]!=paths.get(path)
                    if i in positions:
                        fi,line=positions[i]; newpath=files[fi]
                        assert (path!=newpath)==(state==MOVED)
                        path=newpath
                oid=(old if state==ABSENT else paths)[path]
                written=blobs.read(oid).splitlines()[line-1].replace("«","").replace("»","")
                assert name.split(".")[-1] in written,(pin,i,path,line,name,written[:150])
                samples+=1
        result.append(dict(commit=pin,sourceTree=info["sourceTree"],summarySha256=hashlib.sha256((directory/"summary.json").read_bytes()).hexdigest(),sourceLinksChecked=samples))
    blobs.close()
    return dict(observedMain=registry["observedMain"],observedMainSourceTree=main,editions=result)


if __name__=="__main__":
    p=argparse.ArgumentParser()
    for f in ["output","git","lean","registry"]:p.add_argument("--"+f,type=Path,required=True)
    a=p.parse_args(); reg=json.loads(a.registry.read_bytes())
    write(a.output,"audit.json",audit(a.output,a.git,a.lean,reg))
