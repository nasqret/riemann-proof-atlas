"""Compare an exact Git source tree to the numbered declarations of the submitted atlas."""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "corpus"))
from source import declarations

UNCHANGED, EDITED, ABSENT, ADDED, MOVED = range(5)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write(directory, name, data):
    if not isinstance(data, bytes):
        data = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode()
    if name.endswith(".gz"):
        data = gzip.compress(data, mtime=0)
    (directory / name).write_bytes(data)
    return sha(data)


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args])


def tree(repo, revision):
    files = {}
    for item in git(repo, "ls-tree", "-rz", revision + ":src").split(b"\0"):
        if not item:
            continue
        meta, name = item.split(b"\t", 1)
        name = name.decode()
        if name.endswith(".lean") and name != "Challenge.lean":
            files[name] = meta.split()[2].decode()
    return files


def line_delta(repo, left, right):
    data = git(repo, "diff", "--numstat", "-z", "--no-renames", left, right, "--", "src")
    plus = minus = 0
    for record in filter(None, data.split(b"\0")):
        a, d, path = record.split(b"\t", 2)
        if path.endswith(b".lean") and path != b"src/Challenge.lean":
            plus += int(a)
            minus += int(d)
    return [plus, minus]


class Blobs:
    def __init__(self, repo):
        self.process = subprocess.Popen(["git", "-C", str(repo), "cat-file", "--batch"],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def read(self, oid):
        p = self.process
        p.stdin.write((oid + "\n").encode())
        p.stdin.flush()
        name, kind, size = p.stdout.readline().split()
        if name.decode() != oid or kind != b"blob":
            raise ValueError("Missing Git blob " + oid)
        body = p.stdout.read(int(size))
        if len(body) != int(size) or p.stdout.read(1) != b"\n":
            raise ValueError("Truncated Git blob " + oid)
        return body.decode()

    def close(self):
        self.process.stdin.close()
        code = self.process.wait()
        self.process.stdout.close()
        if code:
            raise RuntimeError("git cat-file failed")


def archive_catalog(lean):
    by_file = defaultdict(list)
    names = []
    index = json.loads((lean / "index.json").read_bytes())
    for start in range(0, index["count"], index["recordStride"]):
        path = lean / "records" / f"{start // index['recordStride']}.json.gz"
        rows = json.loads(gzip.decompress(path.read_bytes()))
        for row in rows:
            by_file[row["file"]].append((row["name"], row["line"], len(names)))
            names.append(row["name"])
    assert len(names) == index["count"]
    return by_file, names, Counter(names)


def snapshot(repo, pin, baseline, archive, current, catalog, out, original_lines, job):
    by_file, names, multiplicity = catalog
    status = bytearray(len(names))
    files = sorted(path for path in current if current[path] != archive.get(path))
    deleted = archive.keys() - current.keys()
    touched = sum(path in archive for path in files)
    additions = []
    offsets = []
    examples = defaultdict(list)
    blobs = Blobs(repo)
    parsed = unchanged = 0
    try:
        for path in deleted:
            for _, _, row in by_file.get(path, ()):
                status[row] = ABSENT
        for file_index, path in enumerate(files):
            old = by_file.get(path, ())
            old_by_name = defaultdict(list)
            for name, line, row in old:
                old_by_name[name].append((line, row))
                status[row] = ABSENT
            module = path[:-5].replace("/", ".")
            text = blobs.read(current[path])
            new = [(e["qualified"], e["line"]) for e in declarations(module, text, current[path], Counter())]
            occurrences = Counter(name for name, _ in new)
            parsed += len(new)
            for name, line in new:
                found = old_by_name.get(name, ())
                if len(found) == occurrences[name] == 1:
                    old_line, row = found[0]
                    status[row] = EDITED
                    if line != old_line:
                        offsets.append([row, file_index, line])
                else:
                    additions.append([name, file_index, line])
        unchanged = sum(len(by_file.get(path, ())) for path in current.keys() & archive.keys()
                        if current[path] == archive[path])
    finally:
        blobs.close()
    # Private names and repeated spellings in consolidated modules are intentionally
    # conservative. A cross-file match requires a globally unique original name and
    # precisely one otherwise unmatched occurrence in the new tree.
    missing = {names[i]: i for i, s in enumerate(status) if s == ABSENT and multiplicity[names[i]] == 1}
    pending = Counter(a[0] for a in additions)
    extra = []
    for name, idx, line in additions:
        if name in missing and pending[name] == 1:
            row = missing[name]
            status[row] = MOVED
            offsets.append([row, idx, line])
        else:
            extra.append([name, idx, line])
    counts = [status.count(i) for i in range(5)]
    counts[ADDED] = len(extra)
    total = len(status) - counts[ABSENT] + len(extra)
    if total != parsed + unchanged or counts[UNCHANGED] != unchanged:
        raise ValueError("Independent source enumeration disagrees with the physical join")
    for row, state in enumerate(status):
        if len(examples[state]) < 12:
            examples[state].append(row)
    examples[ADDED] = list(range(len(status), len(status) + min(12, len(extra))))
    plus, minus = line_delta(repo, baseline, pin) if pin != baseline else [0, 0]
    out.mkdir(exist_ok=True, parents=True)
    assets = {
        "states.bin.gz": write(out, "states.bin.gz", bytes(status)),
        "locations.json.gz": write(out, "locations.json.gz", dict(files=files, positions=sorted(offsets), added=extra)),
    }
    summary = dict(commit=pin, sourceTree=git(repo,"rev-parse",pin+":src").decode().strip(),
                   baseline=baseline, sourceFiles=len(current), written=total, states=counts,
                   filesAdded=len(files)-touched, filesEdited=touched, filesRemoved=len(deleted),
                   lines=original_lines+plus-minus, insertedLines=plus, deletedLines=minus,
                   unchangedSourceRows=unchanged, parsedChangedSourceRows=parsed,
                   revisedLocations=len(offsets), examples=examples, assets=assets,
                   slurmJob=job, sourceParser=sha((HERE.parent/"corpus/source.py").read_bytes()),
                   producer=sha(Path(__file__).read_bytes()))
    write(out,"summary.json",summary)
    print(pin, "files",len(current),"declarations",total,"states",counts,flush=True)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ["git","lean","output","registry"]:
        p.add_argument("--"+key,type=Path,required=True)
    p.add_argument("--ids",nargs="+",required=True)
    p.add_argument("--job",default="local")
    a=p.parse_args()
    registry=json.loads(a.registry.read_bytes())
    base=registry["baseline"]
    index=json.loads((a.lean/"index.json").read_bytes())
    if index["sourcePin"] != base:
        raise ValueError("Baseline geometry belongs to another revision")
    archived=tree(a.git,base)
    catalog=archive_catalog(a.lean)
    if catalog[0].keys() - archived.keys():
        raise ValueError("Original catalog contains a file absent from its Git tree")
    # Git computes line totals using the same convention for the original and every diff.
    empty=subprocess.check_output(["git","hash-object","-t","tree","--stdin"],input=b"").decode().strip()
    original_lines=line_delta(a.git,empty,base)[0]
    editions={e["id"]:e for e in registry["editions"]}
    for id_ in a.ids:
        revision=editions[id_]["commit"]
        snapshot(a.git,revision,base,archived,tree(a.git,revision),catalog,
                 a.output/revision,original_lines,a.job)


if __name__ == "__main__":
    main()
