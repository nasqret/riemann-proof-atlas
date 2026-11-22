"""Verify the public daily archive and optionally sample changed source lines in Git."""
import argparse
from datetime import date, timedelta
import gzip
import hashlib
import json
from pathlib import Path
import random
import re

from build import git


def read(path):
    raw=path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix==".gz" else raw)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify(root, repo=None, lean=None, recent=False):
    data=read(root/"index.json")
    cards=data["editions"]
    records={}
    loaded={}
    total_links=0
    selected={day["comparison"] for day in data["days"][-2:]} | {p["comparison"] for p in data["proposals"].values()}
    sampled_pins={pin for key in selected for pin in key.split("..")}

    def check_file(path,digest):
        require(hashlib.sha256(path.read_bytes()).hexdigest()==digest,"Wrong digest for "+str(path))

    def source_line(pin,row):
        card=cards[pin]
        directory=root/"editions"/card["assetPin"]
        if pin not in loaded:
            locations=read(directory/"locations.json.gz")
            shifted={r:(locations["files"][f],line) for r,f,line in locations["positions"]}
            loaded[pin]=(shifted,locations,gzip.decompress((directory/"states.bin.gz").read_bytes()))
        shifted,loc,states=loaded[pin]
        if row<len(states):
            require(states[row]!=2,"Source link points to a missing occurrence")
            stride=index["recordStride"]
            shard=row//stride
            if shard not in records:
                records[shard]=read(lean/"records"/(str(shard)+".json.gz"))
            record=records[shard][row%stride]
            name=record["name"]
            file,line=shifted.get(row,(record["file"],record["line"]))
        else:
            name,f,line=loc["added"][row-len(states)]
            file=loc["files"][f]
        body=git(repo,"show",pin+":src/"+file).decode().splitlines()
        written=body[line-1].replace("«","").replace("»","")
        require(name.split(".")[-1] in written,"Invalid source anchor "+pin+" "+file+" "+str(line))
        return file,line,name

    if repo:
        index=read(lean/"index.json")
    for pin,card in cards.items():
        require(re.fullmatch(r"[0-9a-f]{40}",pin) and card["commit"]==pin,"Invalid revision pin")
        folder=root/"editions"/card["assetPin"]
        summary=read(folder/"summary.json")
        check_file(folder/"summary.json",card["summarySha256"])
        for key in ("lines","sourceFiles","states","written","sourceTree","assets"):
            require(card[key]==summary[key],"Snapshot disagrees with "+key)
        for path,checksum in card["assets"].items():
            check_file(folder/path,checksum)
        if repo and (not recent or pin in sampled_pins):
            require(git(repo,"rev-parse",pin+":src").decode().strip()==card["sourceTree"],"Wrong source tree")
    prior=data["baseline"]
    previous_day=None
    for day in data["days"]:
        current=date.fromisoformat(day["day"])
        require(previous_day is None or current==previous_day+timedelta(days=1),"Calendar gap")
        require(day["before"]==prior and day["comparison"]==prior+".."+day["pin"],"Discontinuous history")
        require(day["closed"]==(day["day"]<data["capturedAt"][:10]),"Wrong closing status")
        require(day["captures"][-1]["pin"]==day["pin"],"Stale capture")
        prior,previous_day=day["pin"],current
    for key,c in data["comparisons"].items():
        left,right=c["before"],c["after"]
        require(key==left+".."+right and c["asset"]=="pairs/"+key+".json.gz","Wrong comparison URI")
        path=root/c["asset"]
        check_file(path,c["sha256"])
        l,r=cards[left],cards[right]
        delta=read(path)
        require(delta["before"]==left and delta["after"]==right,"Wrong comparison payload")
        for kind in ("removed","added","moved","ambiguousRemoved","ambiguousAdded"):
            require(c[kind]==len(delta[kind]),"Wrong change counts for "+key)
        require(c["added"]-c["removed"]==r["written"]-l["written"] and
                c["retained"]+c["added"]==r["written"],"Declaration totals disagree")
        require(sum(row[2] for row in delta["files"])==c["insertedLines"] and
                sum(row[3] for row in delta["files"])==c["deletedLines"] and
                r["lines"]-l["lines"]==c["insertedLines"]-c["deletedLines"],"Line totals disagree")
        require(r["sourceFiles"]-l["sourceFiles"]==c["filesAdded"]-c["filesRemoved"],"File totals disagree")
        for kind in ("removed","added","edited"):
            require(sum(row[1]==kind for row in delta["files"])==c["files"+kind.capitalize()],"Module status mismatch")
        for side,kind in enumerate(("removed","added")):
            known=set(delta[kind])
            moved=[x[side] for x in delta["moved"]]
            require(len(known)==len(delta[kind]) and known.isdisjoint(moved) and
                    known.issuperset(delta["ambiguous"+kind.capitalize()]),"Overlapping or ambiguous row IDs")
        if repo and (not recent or key in selected):
            rng=random.Random(key)
            for kind,pin in (("removed",left),("added",right)):
                ids=delta[kind]
                for row in rng.sample(ids,min(12,len(ids))):
                    source_line(pin,row);total_links+=1
            for b,a in rng.sample(delta["moved"],min(12,len(delta["moved"]))):
                require(source_line(left,b)[2]==source_line(right,a)[2],"Relocation spelling differs");total_links+=2
    return dict(days=len(data["days"]),pinnedRevisions=len(cards),comparisons=len(data["comparisons"]),
                checkedChangeLinks=total_links,manifestSha256=hashlib.sha256((root/"index.json").read_bytes()).hexdigest())


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",type=Path,required=True)
    parser.add_argument("--git",type=Path)
    parser.add_argument("--lean",type=Path)
    parser.add_argument("--recent",action="store_true",help="Sample Git blobs for the two latest dates and active proposals")
    args=parser.parse_args()
    if bool(args.git)!=bool(args.lean):
        parser.error("--git and --lean must be supplied together")
    print(json.dumps(verify(args.root,args.git,args.lean,args.recent)))
