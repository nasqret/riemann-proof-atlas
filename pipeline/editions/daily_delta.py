"""Compare written theorem/lemma occurrences in two numbered atlas editions.

Rows are local to each side. An unchanged module has identical physical occurrences.
In an edited module, a name is joined only if unique within that module on both sides.
A uniquely paired, byte-identical deleted/added module carries its original source
lines with it. Remaining cross-module joins require a unique name in *both whole
editions*. Unmatched rows with other unmatched occurrences of the same spelling on
the opposite side are flagged as ambiguous. Renames of a declaration's written name
appear as an unmatched occurrence on each side.
"""
from collections import Counter, defaultdict
from dataclasses import dataclass
import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile

from build import ABSENT, ADDED, EDITED, MOVED, git


@dataclass
class Edition:
    summary: dict
    flags: bytes
    files: list
    positions: dict
    added: list

    @classmethod
    def read(cls, repo, pin, folder, row_count):
        folder = Path(folder)
        summary = json.loads((folder / 'summary.json').read_bytes())
        source = git(repo, 'rev-parse', '--verify', pin + ':src').decode().strip()
        if summary['sourceTree'] != source:
            raise ValueError('Edition data belong to a different source tree: ' + pin)

        def payload(name):
            raw = (folder / name).read_bytes()
            if hashlib.sha256(raw).hexdigest() != summary['assets'][name]:
                raise ValueError('Edition asset checksum differs: ' + str(folder / name))
            return gzip.decompress(raw)

        flags = payload('states.bin.gz')
        locations = json.loads(payload('locations.json.gz'))
        files, added = locations['files'], locations['added']
        counts = Counter(flags)
        if len(flags) != row_count or counts.keys() - {0, EDITED, ABSENT, MOVED}:
            raise ValueError('Invalid archive row states: ' + pin)
        counts[ADDED] = len(added)
        if ([counts[i] for i in range(5)] != summary['states'] or
                row_count - counts[ABSENT] + len(added) != summary['written']):
            raise ValueError('Edition counts disagree: ' + pin)
        positions = {}
        for row, file_id, line in locations['positions']:
            if (not 0 <= row < row_count or flags[row] not in (EDITED, MOVED) or
                    row in positions or not 0 <= file_id < len(files) or line < 1):
                raise ValueError('Invalid edition location: ' + pin)
            positions[row] = (files[file_id], line)
        if sum(flags[row] == MOVED for row in positions) != counts[MOVED]:
            raise ValueError('Missing source location for a relocated declaration: ' + pin)
        if any(not 0 <= f < len(files) or line < 1 for _, f, line in added):
            raise ValueError('Invalid additional declaration location: ' + pin)
        return cls(summary, flags, files, positions, added)

    def changed_modules(self, archive, paths):
        modules = defaultdict(list)
        # Baseline row numbers are stable, but a retained row may already occupy
        # a different module at either endpoint of today's comparison.
        for base_path, records in archive.items():
            for name, line, row in records:
                if self.flags[row] == ABSENT:
                    continue
                shifted = self.positions.get(row)
                path = shifted[0] if shifted else base_path
                if path in paths:
                    modules[path].append((name, shifted[1] if shifted else line, row))
        for row, (name, file_id, line) in enumerate(self.added, start=len(self.flags)):
            path = self.files[file_id]
            if path in paths:
                modules[path].append((name, line, row))
        return modules

    def whole_counts(self, candidates, names, baseline_counts):
        # Count collisions in unchanged files too, without materialising all
        # 818,755 source records a second time.
        counts = Counter({name: baseline_counts[name] for name in candidates})
        if candidates:
            for row, flag in enumerate(self.flags):
                if flag == ABSENT and names[row] in counts:
                    counts[names[row]] -= 1
            for name, _, _ in self.added:
                if name in counts:
                    counts[name] += 1
        return counts


def source_changes(repo, before, after):
    """Return src-relative paths and both Git blob IDs, including empty modules."""
    options = ('--no-ext-diff', '--no-textconv', '--no-renames', '-z')
    args = (before, after, '--', 'src')
    entries = git(repo, 'diff', '--raw', '--no-abbrev', *options, *args).split(b'\0')[:-1]
    if len(entries) % 2:
        raise ValueError('Incomplete Git raw diff')
    raw = {}
    for meta, path in zip(entries[::2], entries[1::2]):
        if path.endswith(b'.lean') and path != b'src/Challenge.lean':
            _, _, old, new, status = meta.split()
            raw[path] = (old, new, {b'A': 'added', b'D': 'removed', b'M': 'edited', b'T': 'edited'}[status])
    stats = {}
    for entry in git(repo, 'diff', '--numstat', *options, *args).split(b'\0'):
        if entry:
            inserted, deleted, path = entry.split(b'\t', 2)
            if path in raw:
                stats[path] = (int(inserted), int(deleted))
    if raw.keys() != stats.keys():
        raise ValueError('Git path and line inventories disagree')
    files, deleted_blobs, added_blobs = [], defaultdict(list), defaultdict(list)
    for path in sorted(raw):
        name = path.removeprefix(b'src/').decode()
        old, new, status = raw[path]
        files.append([name, status, *stats[path]])
        if status == 'removed':
            deleted_blobs[old].append(name)
        elif status == 'added':
            added_blobs[new].append(name)
    renames = [(paths[0], added_blobs[oid][0]) for oid, paths in deleted_blobs.items()
               if len(paths) == 1 and len(added_blobs.get(oid, ())) == 1]
    same_blob = {path.removeprefix(b'src/').decode() for path, (old, new, _) in raw.items()
                 if old == new}
    return files, renames, same_blob


def unmatched(left, right, paths, renames, same_blob, catalog):
    by_file, names, multiplicity = catalog
    old = left.changed_modules(by_file, paths)
    new = right.changed_modules(by_file, paths)
    moved = []
    old_pending, new_pending = defaultdict(list), defaultdict(list)

    def exact(before_path, after_path):
        # The declaration's line/name in identical source bytes resolves repeated
        # spellings even when modules elsewhere also declare this private name.
        a = sorted(old.pop(before_path, ()))
        b = sorted(new.pop(after_path, ()))
        if len(a) != len(b):
            raise ValueError('Different declaration counts for identical module bytes')
        for (name, line, row), (new_name, new_line, new_row) in zip(a, b):
            if (name, line) != (new_name, new_line):
                raise ValueError('Different declaration locations for identical module bytes')
            if before_path != after_path:
                moved.append([row, new_row])

    for path in same_blob:
        exact(path, path)
    for before_path, after_path in renames:
        exact(before_path, after_path)
    for path in old.keys() | new.keys():
        old_names, new_names = defaultdict(list), defaultdict(list)
        for name, _, row in old.get(path, ()):
            old_names[name].append(row)
        for name, _, row in new.get(path, ()):
            new_names[name].append(row)
        for name in old_names.keys() | new_names.keys():
            a, b = old_names.get(name, ()), new_names.get(name, ())
            if len(a) == len(b) == 1:
                continue
            if a:
                old_pending[name].extend((path, row) for row in a)
            if b:
                new_pending[name].extend((path, row) for row in b)

    undecided = old_pending.keys() & new_pending.keys()
    candidates = {name for name in undecided if len(old_pending[name]) == len(new_pending[name]) == 1}
    old_counts = left.whole_counts(candidates, names, multiplicity)
    new_counts = right.whole_counts(candidates, names, multiplicity)
    for name in candidates:
        if old_counts[name] == new_counts[name] == 1:
            old_path, row = old_pending.pop(name)[0]
            new_path, new_row = new_pending.pop(name)[0]
            if old_path == new_path:
                raise ValueError('Same-module unique name was left unmatched')
            moved.append([row, new_row])
    ambiguous = old_pending.keys() & new_pending.keys()

    def row_ids(pending, keys):
        return sorted(row for name in keys for _, row in pending[name])

    return dict(removed=row_ids(old_pending, old_pending), added=row_ids(new_pending, new_pending),
                moved=sorted(moved), ambiguousRemoved=row_ids(old_pending, ambiguous),
                ambiguousAdded=row_ids(new_pending, ambiguous))


def store_ledger(path, payload):
    """Publish complete immutable bytes, preserving existing equivalent compression."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode()
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as staging:
        temp = Path(staging.name)
    try:
        with temp.open('wb') as out, gzip.GzipFile(filename='', mode='wb', fileobj=out, mtime=0, compresslevel=9) as compressed:
            compressed.write(data)
        # Linking within the target directory atomically creates an immutable file.
        try:
            os.link(temp, path)
        except FileExistsError:
            if gzip.decompress(path.read_bytes()) != data:
                raise ValueError('Existing daily comparison differs: ' + str(path))
        return hashlib.sha256(path.read_bytes()).hexdigest()
    finally:
        temp.unlink()


def make_delta(repo, before_pin, after_pin, before_dir, after_dir, catalog, out_file):
    """Write a source-pinned daily ledger and return small, checked index counts.

    `removed` and `added` are unmatched physical occurrences. `retained` contains
    `moved`. All file paths are relative to `src/`. File counts and line churn use
    Git's literal old/new paths, so a file rename has a deletion and an addition.
    A matching `sourceTree` permits reuse of the map of a documentation-only commit.
    """
    row_count = len(catalog[1])
    left = Edition.read(repo, before_pin, before_dir, row_count)
    right = Edition.read(repo, after_pin, after_dir, row_count)
    if left.summary['baseline'] != right.summary['baseline']:
        raise ValueError('Compared editions have different baseline row numberings')
    files, renames, same_blob = source_changes(repo, before_pin, after_pin)
    rows = (unmatched(left, right, {change[0] for change in files}, renames, same_blob, catalog)
            if files else dict(removed=[], added=[], moved=[], ambiguousRemoved=[], ambiguousAdded=[]))
    file_counts = Counter(status for _, status, _, _ in files)
    inserted, deleted = sum(f[2] for f in files), sum(f[3] for f in files)
    retained = left.summary['written'] - len(rows['removed'])
    if (retained != right.summary['written'] - len(rows['added']) or retained < len(rows['moved']) or
            right.summary['sourceFiles'] - left.summary['sourceFiles'] != file_counts['added'] - file_counts['removed'] or
            right.summary['lines'] - left.summary['lines'] != inserted - deleted):
        raise ValueError('Two-revision declaration, file or source line totals do not reconcile')
    for rows_on_side, side in [('removed', 0), ('added', 1)]:
        ids = rows[rows_on_side] + [pair[side] for pair in rows['moved']]
        if len(ids) != len(set(ids)):
            raise ValueError('A declaration appears in two change classes on one side')
    pins = dict(before=before_pin, after=after_pin)
    digest = store_ledger(out_file, dict(schema=1, **pins, **rows, files=files))
    return dict(**pins, **{kind: len(values) for kind, values in rows.items()}, retained=retained,
                filesAdded=file_counts['added'], filesRemoved=file_counts['removed'],
                filesEdited=file_counts['edited'], insertedLines=inserted, deletedLines=deleted, sha256=digest)
