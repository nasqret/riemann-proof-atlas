"""Capture UTC closing revisions, pairwise Lean changes and a separately pinned PR."""
import argparse
from datetime import date, datetime, time, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

from audit import audit
from build import archive_catalog, git, snapshot, tree
from daily_delta import make_delta

BASE = "40e56bab026552e089d7afcfeff08d2defb9c005"
REPOSITORY = "leanprover-community/riemann-hypothesis"
FIRST = date(2026, 11, 20)
UTC = timezone.utc


def stamp(value):
    return value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def iso(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Capture times require a UTC offset")
    return parsed.astimezone(UTC)


def read(path):
    return json.loads(path.read_bytes())


def save(path, value):
    temp = path.with_suffix(".pending")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temp.replace(path)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rev(repo, spec):
    return git(repo, "rev-parse", "--verify", spec).decode().strip()


def day_pins(history, first, observed):
    """Git ancestry determines order. A child cannot precede a later-dated parent."""
    idx = 0
    day = first
    while day <= observed.date():
        midnight = datetime.combine(day + timedelta(days=1), time.min, tzinfo=UTC)
        while idx < len(history):
            moment = history[idx][1]
            if moment >= midnight or moment > observed:
                break
            idx += 1
        if idx:
            yield day.isoformat(), history[idx-1][0], day < observed.date()
        day += timedelta(days=1)


def first_parent(repo, tip):
    rows = git(repo, "log", "--reverse", "--first-parent", "--format=%H %ct", tip).decode().splitlines()
    chain = [(pin, datetime.fromtimestamp(int(t), UTC)) for pin, t in (r.split() for r in rows)]
    pins = [p for p, _ in chain]
    if BASE not in pins:
        raise ValueError("The first-parent history is incomplete or has diverged from the submission")
    return chain[pins.index(BASE):]


def source_events(repo, left, right, chain):
    pins = [pin for pin,_ in chain]
    result = []
    for index in range(pins.index(left) + 1, pins.index(right) + 1):
        previous, pin = pins[index-1:index+1]
        if rev(repo, previous+":src") == rev(repo, pin+":src"):
            continue
        changed = git(repo,"diff","--name-only","-z","--no-renames",previous,pin,"--","src").split(b"\0")
        if not any(p.endswith(b".lean") and p != b"src/Challenge.lean" for p in changed):
            continue
        lines = git(repo,"show","-s","--format=%s%n%b",pin).decode().splitlines()
        subject = lines[0]
        match = re.search(r"(?:Merge pull request #|\(#)(\d+)", subject)
        if subject.startswith("Merge pull request"):
            subject = next((line.strip() for line in lines[1:] if line.strip()),subject)
        result.append(dict(pin=pin, title=subject, pr=int(match[1]) if match else None))
    return result


def capture(args):
    root = args.output
    root.mkdir(parents=True, exist_ok=True)
    editions = root / "editions"
    pairs = root / "pairs"
    editions.mkdir(exist_ok=True)
    pairs.mkdir(exist_ok=True)
    manifest = root / "index.json"
    m = read(manifest) if manifest.exists() else dict(schema=1, repository=REPOSITORY, baseline=BASE,
                     days=[], editions={}, comparisons={}, proposals={}, external="verifytask/index.json")
    if m["schema"] != 1 or m["baseline"] != BASE or m["repository"] != REPOSITORY:
        raise ValueError("Unrecognized daily archive")
    observed = args.as_of
    if m.get("capturedAt") and iso(m["capturedAt"]) > observed:
        raise ValueError("An older capture cannot replace the public manifest")
    tip = rev(args.git,args.tip+"^{commit}")
    history = first_parent(args.git,tip)
    if read(args.lean/"index.json")["sourcePin"] != BASE:
        raise ValueError("The supplied declaration catalogue belongs to a different commit")
    catalog = None
    archive = None

    def get_catalog():
        nonlocal catalog
        if catalog is None:
            catalog = archive_catalog(args.lean)
        return catalog

    def edition(pin):
        nonlocal archive
        known = m["editions"]
        oid = rev(args.git,pin+":src")
        if pin in known:
            card = known[pin]
            if oid != card["sourceTree"]:
                raise ValueError("Edition source mismatch: "+pin)
            return card
        committed = stamp(iso(git(args.git,"show","-s","--format=%cI",pin).decode().strip()))
        for prior in list(known.values()):
            if prior["sourceTree"] == oid:
                known[pin] = dict(prior,commit=pin,committedAt=committed)
                return known[pin]
        destination = editions / pin
        if not destination.exists():
            with tempfile.TemporaryDirectory(dir=root) as scratch:
                folder = Path(scratch)/pin
                cached = next((c/pin for c in args.cache if (c/pin/"summary.json").exists()),None)
                if cached:
                    shutil.copytree(cached,folder)
                else:
                    if archive is None:
                        archive = tree(args.git,BASE)
                    if pin == BASE:
                        from build import line_delta
                        # Git's canonical empty tree object.
                        lines = line_delta(args.git,"4b825dc642cb6eb9a060e54bf8d69288fbee4904",BASE)[0]
                    else:
                        lines = known[BASE]["lines"]
                    snapshot(args.git,pin,BASE,archive,tree(args.git,pin),get_catalog(),folder,lines,args.job)
                folder.rename(destination)
        summary = read(destination/"summary.json")
        if summary["sourceTree"] != oid or summary["commit"] != pin or summary["baseline"] != BASE:
            raise ValueError("Cached state belongs to another Git tree")
        checked = audit(editions,args.git,args.lean,dict(baseline=BASE,observedMain=pin,editions=[dict(commit=pin)]))["editions"][0]
        card = {k:summary[k] for k in ("sourceTree","sourceFiles","lines","written","states","assets","examples")}
        known[pin] = dict(card, commit=pin, assetPin=pin, committedAt=committed,
                          checkedLinks=checked["sourceLinksChecked"],summarySha256=checked["summarySha256"])
        return known[pin]

    def comparison(left,right):
        l, r = edition(left), edition(right)
        key = left+".."+right
        path = pairs/(key+".json.gz")
        if key not in m["comparisons"]:
            meta = make_delta(args.git,left,right,editions/l["assetPin"],editions/r["assetPin"],get_catalog(),path)
            m["comparisons"][key] = dict(meta, asset="pairs/"+path.name)
        comp = m["comparisons"][key]
        if sha(path) != comp["sha256"] or r["written"]-l["written"] != comp["added"]-comp["removed"]:
            raise ValueError("Daily declaration comparison does not reconcile: "+key)
        if r["lines"]-l["lines"] != comp["insertedLines"]-comp["deletedLines"]:
            raise ValueError("Daily line comparison does not reconcile: "+key)
        return key

    edition(BASE)
    prior = {d["day"]:d for d in m["days"]}
    days = []
    last = BASE
    for day,pin,closed in day_pins(history,FIRST,observed):
        old = prior.get(day)
        if old and old["closed"]:
            if old["pin"] != pin or old["before"] != last:
                raise ValueError("Finalized mainline ancestry changed for "+day)
            days.append(old)
        else:
            key = comparison(last,pin)
            captures = list(old["captures"]) if old else []
            if old and captures and "observedAt" not in captures[-1] and "endExclusive" not in captures[-1]:
                captures[-1] = dict(captures[-1], observedAt=m["capturedAt"])
            if not captures or captures[-1]["pin"] != pin:
                boundary = datetime.combine(date.fromisoformat(day)+timedelta(days=1),time.min,tzinfo=UTC)
                timing = {"endExclusive":stamp(boundary)} if closed else {"observedAt":stamp(observed)}
                captures.append(dict(pin=pin,comparison=key,**timing))
            days.append(dict(day=day, pin=pin, before=last, comparison=key, closed=closed, captures=captures,
                             changes=source_events(args.git,last,pin,history)))
        last = pin
    entry = read(args.pr)
    head = entry["head"]["sha"]
    if entry["number"] != 55 or entry["base"]["repo"]["full_name"] != REPOSITORY:
        raise ValueError("Unexpected tracked pull request")
    if rev(args.git,head+"^{commit}") != head or iso(git(args.git,"show","-s","--format=%cI",head).decode().strip()) > observed:
        raise ValueError("PR capture and observation time disagree")
    merged = entry.get("merged_at")
    # Once merged, GitHub's merge parent preserves the comparison before acceptance.
    target = rev(args.git,entry["merge_commit_sha"]+"^1") if merged else last
    merge_base = git(args.git,"merge-base",target,head).decode().strip()
    key = comparison(merge_base,head)
    proposal = dict(pr=55,title=entry["title"],head=head,base=merge_base,comparison=key,
                    status="merged" if merged else entry["state"], mergedAt=merged)
    versions = m["proposals"].get("55",{}).get("versions",[])
    # The previous atlas release captured the first head before the contributor
    # merged main into the proposal. Keep the real observation time on that record.
    frozen=read(args.registry)
    archived=next((e for e in frozen["editions"] if e.get("pr")==55 and e["status"]=="proposal"),None)
    if archived and all(v["head"]!=archived["commit"] for v in versions) and archived["commit"]!=head:
        earlier=archived["commit"]
        then=iso(frozen["observedAt"].replace(" UTC","+00:00"))
        if then<=observed:
            prior_base=git(args.git,"merge-base",frozen["observedMain"],earlier).decode().strip()
            old_key=comparison(prior_base,earlier)
            versions=[dict(pr=55,title=archived["title"],head=earlier,base=prior_base,comparison=old_key,
                           status="open",mergedAt=None,observedAt=stamp(then)),*versions]
    if not versions or any(versions[-1][k] != proposal[k] for k in ("head","base","status")):
        versions = [*versions, dict(proposal,observedAt=stamp(observed))]
    m["proposals"]["55"] = dict(proposal,versions=versions)
    m.update(days=days,capturedAt=stamp(observed),observedTip=tip)
    # Validate every referenced payload again before the atomic manifest replacement.
    for card in m["editions"].values():
        folder = editions/card["assetPin"]
        for name,digest in {**card["assets"],"summary.json":card["summarySha256"]}.items():
            if sha(folder/name) != digest:
                raise ValueError("Damaged snapshot payload "+str(folder/name))
    for data in m["comparisons"].values():
        if sha(root/data["asset"]) != data["sha256"]:
            raise ValueError("Damaged pair "+data["asset"])
    save(manifest,m)
    for day in days[-3:]:
        comp = m["comparisons"][day["comparison"]]
        print(day["day"],day["pin"],m["editions"][day["pin"]]["written"],"-",comp["removed"],"+",comp["added"])
    print("PR #55",proposal["status"],head)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for opt in ("git","lean","output","pr"):
        p.add_argument("--"+opt,type=Path,required=True)
    p.add_argument("--registry",type=Path,default=Path(__file__).with_name("registry.json"))
    p.add_argument("--cache",type=Path,action="append",default=[])
    p.add_argument("--tip",default="refs/remotes/community/main")
    p.add_argument("--as-of",type=iso,default=datetime.now(UTC))
    p.add_argument("--job",default=os.environ.get("SLURM_JOB_ID","daily-runner"))
    capture(p.parse_args())
