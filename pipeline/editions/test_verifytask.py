"""Exercise Git/HTTP source measurements and the UTC mirror history without a network."""

import json
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import verifytask as vt


class SourceWatchTests(unittest.TestCase):
    def test_pinned_physical_paths_and_http_join(self):
        with TemporaryDirectory() as workspace:
            work = Path(workspace)
            src = work / "src"
            src.mkdir()
            vt.git(work, "init", "--quiet")
            vt.git(work, "config", "user.name", "Source fixtures")
            vt.git(work, "config", "user.email", "source@example.invalid")
            entries = {
                "src/Old.lean": b"one\ntwo\n",
                "src/F.lean": b"a\nb\nc",
                "src/Challenge.lean": b"unchanged scope\n",
            }
            for name, body in entries.items():
                (work / name).write_bytes(body)
            vt.git(work, "add", ".")
            vt.git(work, "commit", "--quiet", "-m", "before")
            base = vt.git(work, "rev-parse", "HEAD").decode().strip()
            (src / "Old.lean").rename(src / "New.lean")
            (src / "F.lean").write_bytes(b"a\nz\n")
            (src / "Challenge.lean").write_bytes(b"outside the measured scope\nmore\n")
            vt.git(work, "add", "-A")
            vt.git(work, "commit", "--quiet", "-m", "after")
            head = vt.git(work, "rev-parse", "HEAD").decode().strip()
            local = {
                r["path"]: r for r in vt.git_rows(work, "a/from", "b/to", base, head)
            }
            http_files = [
                {
                    "filename": "src/New.lean",
                    "previous_filename": "src/Old.lean",
                    "status": "renamed",
                    "sha": vt.blob_id(entries["src/Old.lean"]),
                    "additions": 0,
                    "deletions": 0,
                },
                {
                    "filename": "src/F.lean",
                    "status": "modified",
                    "sha": vt.blob_id(b"a\nz\n"),
                    "additions": 1,
                    "deletions": 2,
                },
                {"filename": "src/Challenge.lean", "status": "modified"},
            ]

            def download(url):
                parts = url.split("/")
                return vt.git(work, "show", parts[-3] + ":" + "/".join(parts[-2:]))

            with patch.object(vt, "get", side_effect=download):
                http = {
                    r["path"]: r
                    for r in vt.http_rows(
                        {"files": http_files}, "a/from", "b/to", base, head
                    )
                }
            self.assertEqual(http, local)
            self.assertEqual(local["src/F.lean"]["netLines"], -1)
            self.assertTrue(local["src/F.lean"]["beforeUrl"].endswith("/src/F.lean#L2"))
            self.assertIn("/" + base + "/", local["src/F.lean"]["beforeUrl"])
            self.assertIn("/" + head + "/", local["src/F.lean"]["afterUrl"])
            self.assertIsNone(local["src/Old.lean"]["afterUrl"])
            self.assertIsNone(local["src/New.lean"]["beforeUrl"])

    def test_cutoff_is_first_parent_utc_and_handles_unpublished_dates(self):
        old, new, unrelated = "1" * 40, "2" * 40, "3" * 40

        def fake(path, **params):
            if path.endswith("/commits"):
                return [dict(sha=new)]
            if path.endswith("/" + new):
                return dict(
                    committer=dict(date="2026-11-22T01:00:00+01:00"),
                    parents=[dict(sha=old), dict(sha=unrelated)],
                )
            if path.endswith("/" + old):
                return dict(committer=dict(date="2026-11-20T00:00:00Z"), parents=[])
            self.fail(path)

        dates = [date(2026, 11, i) for i in (19, 20, 21, 22)]
        with (
            patch.object(vt, "api", side_effect=fake),
            patch.object(vt, "src_tree", side_effect=lambda _, rev: rev),
        ):
            rows = vt.mirror_snapshots(dates, vt.date_time("2026-11-22T00:00:00Z"), old)
        self.assertIsNone(rows[dates[0]])
        self.assertEqual([rows[d]["commit"] for d in dates[1:]], [old, old, new])
        self.assertFalse(rows[dates[-1]]["equalsSubmission"])

    def test_large_http_counts_fail_closed_and_receipts_are_content_addressed(self):
        with self.assertRaisesRegex(ValueError, "300"):
            vt.http_rows({"files": [None] * 300}, "a/src", "b/src", "1" * 40, "2" * 40)
        with TemporaryDirectory() as td:
            root = Path(td)
            path = vt.evidence(root, "capture", {"n": 1})
            self.assertEqual(path, vt.evidence(root, "capture", {"n": 1}))
            (root / path).write_text(json.dumps({"n": 2}))
            with self.assertRaisesRegex(ValueError, "checksum"):
                vt.evidence(root, "capture", {"n": 1})


if __name__ == "__main__":
    unittest.main()
