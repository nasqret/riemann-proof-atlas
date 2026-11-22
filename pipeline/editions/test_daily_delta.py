"""Exercise daily row identities on a small real Git repository, including source-only ties."""
from collections import Counter, defaultdict
from contextlib import redirect_stdout
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from build import git, line_delta, snapshot, tree
from daily_delta import make_delta
from source import declarations


def lemma(name):
    return 'private theorem ' + name + ' : True := True.intro\n'


class DailyDeltaTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.repo = self.work / 'git'
        self.repo.mkdir()
        git(self.repo, 'init', '-q')
        git(self.repo, 'config', 'user.email', 'fixture@example.invalid')
        git(self.repo, 'config', 'user.name', 'Atlas fixture')
        original = {
            'App.lean': lemma('anchored') + lemma('depart') + lemma('withdrawn'),
            'Copy/Former.lean': lemma('duplicate') + lemma('known'),
            'Independent.lean': lemma('duplicate'),
            'Empty.lean': '',
            'Challenge.lean': lemma('excluded'),
        }
        self.baseline = self.commit('Original submission', original)
        self.archive = tree(self.repo, self.baseline)
        names, by_file = [], defaultdict(list)
        for path, oid in sorted(self.archive.items()):
            text = git(self.repo, 'cat-file', 'blob', oid).decode()
            for item in declarations(path[:-5], text, oid, Counter()):
                by_file[path].append((item['qualified'], item['line'], len(names)))
                names.append(item['qualified'])
        self.catalog = by_file, names, Counter(names)
        empty = subprocess.check_output(['git', 'hash-object', '-t', 'tree', '--stdin'], input=b'').decode().strip()
        self.original_lines = line_delta(self.repo, empty, self.baseline)[0]
        self.before = self.commit('New rows relative to the submission', {
            'Extras.lean': lemma('ephemeral') + lemma('fresh') + lemma('newMover'),
            'L1.lean': '-- L1\n' + lemma('ambiguous'),
            'L2.lean': '-- L2\n' + lemma('ambiguous'),
        })
        self.after = self.commit('Move, delete and edit on the next day', {
            'App.lean': '-- shifted\n' + lemma('anchored'),
            'Beta.lean': '-- new location\n' + lemma('depart'),
            'Copy/Former.lean': None,
            'Copy/Latter.lean': original['Copy/Former.lean'],
            'Empty.lean': None,
            'Extras.lean': '-- shifted\n' + lemma('fresh') + lemma('brandNew'),
            'Elsewhere.lean': '-- pre-existing addition moved\n' + lemma('newMover'),
            'L1.lean': None, 'L2.lean': None,
            'R1.lean': '-- R1\n' + lemma('ambiguous'),
            'R2.lean': '-- R2\n' + lemma('ambiguous'),
            'Challenge.lean': original['Challenge.lean'] + lemma('excludedAgain'),
            'unicode/π\tnew.lean': '', 'ignored.txt': 'metadata\n',
        })
        self.old_map = self.make_map(self.before)
        self.new_map = self.make_map(self.after)

    def commit(self, subject, changes):
        for rel, body in changes.items():
            path = self.repo / 'src' / rel
            if body is None:
                path.unlink()
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(body)
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-qm', subject)
        return git(self.repo, 'rev-parse', 'HEAD').decode().strip()

    def make_map(self, pin):
        result = self.work / pin
        with redirect_stdout(io.StringIO()):
            snapshot(self.repo, pin, self.baseline, self.archive, tree(self.repo, pin), self.catalog,
                     result, self.original_lines, 'test')
        return result

    def identities(self, folder):
        flags = gzip.decompress((folder / 'states.bin.gz').read_bytes())
        loc = json.loads(gzip.decompress((folder / 'locations.json.gz').read_bytes()))
        offsets = {r: (loc['files'][f], line) for r, f, line in loc['positions']}
        inverse = {}
        for path, rows in self.catalog[0].items():
            for name, line, i in rows:
                if flags[i] != 2:
                    p, line = offsets.get(i, (path, line))
                    inverse[i] = (p, name, line)
        for i, (name, f, line) in enumerate(loc['added'], len(flags)):
            inverse[i] = (loc['files'][f], name, line)
        return inverse

    def compare(self, before, after, old, new, name='pair.json.gz'):
        path = self.work / name
        counts = make_delta(self.repo, before, after, old, new, self.catalog, path)
        raw = path.read_bytes()
        self.assertEqual(counts['sha256'], hashlib.sha256(raw).hexdigest())
        return counts, json.loads(gzip.decompress(raw))

    def test_rows_files_and_both_source_locations(self):
        counts, data = self.compare(self.before, self.after, self.old_map, self.new_map)
        self.assertEqual((counts['removed'], counts['added'], counts['moved'], counts['retained']), (4, 3, 4, 7))
        self.assertEqual((counts['ambiguousRemoved'], counts['ambiguousAdded']), (2, 2))
        old, new = self.identities(self.old_map), self.identities(self.new_map)
        self.assertEqual({old[row][:2] for row in data['removed']}, {
            ('App.lean', 'withdrawn'), ('Extras.lean', 'ephemeral'), ('L1.lean', 'ambiguous'), ('L2.lean', 'ambiguous')})
        self.assertEqual({new[row][:2] for row in data['added']}, {
            ('Extras.lean', 'brandNew'), ('R1.lean', 'ambiguous'), ('R2.lean', 'ambiguous')})
        self.assertEqual({(old[a], new[b]) for a, b in data['moved']}, {
            (('App.lean', 'depart', 2), ('Beta.lean', 'depart', 2)),
            (('Extras.lean', 'newMover', 3), ('Elsewhere.lean', 'newMover', 2)),
            (('Copy/Former.lean', 'duplicate', 1), ('Copy/Latter.lean', 'duplicate', 1)),
            (('Copy/Former.lean', 'known', 2), ('Copy/Latter.lean', 'known', 2)),
        })
        self.assertEqual({old[row][1] for row in data['ambiguousRemoved']}, {'ambiguous'})
        self.assertEqual({new[row][1] for row in data['ambiguousAdded']}, {'ambiguous'})
        files = {p: (st, a, d) for p, st, a, d in data['files']}
        self.assertEqual(files['Empty.lean'], ('removed', 0, 0))
        self.assertEqual(files['unicode/π\tnew.lean'], ('added', 0, 0))
        self.assertEqual(files['Copy/Former.lean'], ('removed', 0, 2))
        self.assertEqual(files['Copy/Latter.lean'], ('added', 2, 0))
        self.assertNotIn('Challenge.lean', files)
        self.assertNotIn('ignored.txt', files)
        self.assertEqual(self.compare(self.before, self.after, self.old_map, self.new_map), (counts, data))
        reverse, mirror = self.compare(self.after, self.before, self.new_map, self.old_map, 'reverse.gz')
        self.assertEqual((reverse['removed'], reverse['added'], reverse['insertedLines'], reverse['deletedLines']),
                         (counts['added'], counts['removed'], counts['deletedLines'], counts['insertedLines']))
        self.assertEqual(data['removed'], mirror['added'])
        self.assertEqual(data['added'], mirror['removed'])
        self.assertEqual(sorted([b, a] for a, b in data['moved']), mirror['moved'])

    def test_same_source_dates_and_immutability(self):
        (self.repo / 'README').write_text('Document a run\n')
        doc_pin = self.commit('Documentation only', {})
        counts, data = self.compare(self.after, doc_pin, self.new_map, self.new_map)
        self.assertEqual(data['before'], self.after)
        self.assertEqual(data['after'], doc_pin)
        self.assertEqual((counts['removed'], counts['added'], counts['moved'], data['files']), (0, 0, 0, []))
        self.assertEqual(counts['retained'], len(self.identities(self.new_map)))
        with self.assertRaisesRegex(ValueError, 'immutable|Existing daily comparison'):
            self.compare(self.before, self.after, self.old_map, self.new_map)
        with self.assertRaisesRegex(ValueError, 'different source tree'):
            self.compare(self.before, self.after, self.new_map, self.new_map, 'bad.gz')
        (self.new_map / 'states.bin.gz').write_bytes(b'invalid')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.compare(self.before, self.after, self.old_map, self.new_map, 'bad.gz')
        self.assertFalse((self.work / 'bad.gz').exists())

    def test_single_unmatched_counterpart_with_an_unchanged_namesake(self):
        # 'duplicate' also survives in Independent.lean. With both file blobs
        # changed, the sole unmatched counterpart is insufficient move evidence.
        next_pin = self.commit('Split a private name away from its former module', {
            'Copy/Latter.lean': lemma('known'),
            'Another.lean': '-- different module contents\n' + lemma('duplicate'),
        })
        next_map = self.make_map(next_pin)
        counts, data = self.compare(self.after, next_pin, self.new_map, next_map)
        self.assertEqual((counts['removed'], counts['added'], counts['moved']), (1, 1, 0))
        self.assertEqual((data['removed'], data['added']), (data['ambiguousRemoved'], data['ambiguousAdded']))
        self.assertEqual(self.identities(self.new_map)[data['removed'][0]], ('Copy/Latter.lean', 'duplicate', 1))
        self.assertEqual(self.identities(next_map)[data['added'][0]], ('Another.lean', 'duplicate', 2))


if __name__ == '__main__':
    unittest.main()
