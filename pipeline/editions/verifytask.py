"""Capture the VerifyTask guide, its cited mirror and the site-linked contributor's PRs.

python3 verifytask.py --output data/daily/verifytask --git /path/to/upstream.git
The optional Git object cache enables complete comparisons exceeding GitHub's REST
file-list limit. Small comparisons can also be measured directly from pinned HTTPS blobs.
"""

import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from hashlib import sha1, sha256
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import subprocess
from tempfile import NamedTemporaryFile
from urllib.parse import quote, urlencode, urlsplit
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from time import sleep


UTC = timezone.utc
SITE = "https://riemann.verifytask.cn/"
UPSTREAM = "leanprover-community/riemann-hypothesis"
MIRROR = "Reen-Ai-H/riemann-hypothesis-lean-zh"
AUTHOR = "Osgood001"
FORK = AUTHOR + "/riemann-hypothesis"
BASELINE = "40e56bab026552e089d7afcfeff08d2defb9c005"
API = "https://api.github.com/"


def stamp(dt):
    return dt.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def date_time(value):
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("A UTC offset is required")
    return dt.astimezone(UTC)


def get(url):
    headers = {"User-Agent": "Riemann-proof-atlas daily source watch"}
    if urlsplit(url).netloc == "api.github.com":
        headers.update(
            {
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }
        )
        token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = "Bearer " + token
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers=headers), timeout=40) as response:
                return response.read()
        except HTTPError as exc:
            if exc.code not in {429, 500, 502, 503, 504} or attempt == 2:
                raise
        except (TimeoutError, URLError):
            if attempt == 2:
                raise
        sleep(2**attempt)


def api(path, **params):
    suffix = "?" + urlencode(params) if params else ""
    return json.loads(get(API + path + suffix))


def pin(value):
    if not re.fullmatch("[0-9a-f]{40}", value or ""):
        raise ValueError("Expected a full Git object ID")
    return value


def encoded(value):
    return (
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode()


def replace_file(path, data):
    path.parent.mkdir(exist_ok=True, parents=True)
    with NamedTemporaryFile(dir=path.parent, delete=False) as temp:
        temp.write(data)
    Path(temp.name).replace(path)


def evidence(root, kind, record):
    data = encoded(record)
    name = f"evidence/{kind}-{sha256(data).hexdigest()}.json"
    path = root / name
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("Evidence checksum mismatch: " + name)
    else:
        replace_file(path, data)
    return name


class GuidePage(HTMLParser):
    def __init__(self, raw):
        super().__init__()
        self.links = set()
        self.rows = []
        self.canonical = None
        self.cell = self.row = None
        self.feed(raw.decode("utf-8"))
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and attrs.get("href"):
            self.links.add(attrs["href"])
        if tag == "link" and attrs.get("rel") == "canonical":
            self.canonical = attrs.get("href")
        if tag == "tr":
            self.row = []
        if tag in ("th", "td"):
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("th", "td") and self.cell is not None:
            if self.row is not None:
                self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        if tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def site_record(root):
    pages, records = {}, {}
    for key, url in [
        ("home", SITE),
        ("guide", SITE + "riemann/"),
        ("sources", SITE + "riemann/sources/"),
    ]:
        try:
            raw = get(url)
        except HTTPError as exc:
            if key == "home" or exc.code not in (404, 410):
                raise
            # The subdomain can change its publication while older guide URLs expire.
            pages[key] = GuidePage(b"")
            records[key] = dict(url=url, httpStatus=exc.code)
            continue
        page = pages[key] = GuidePage(raw)
        records[key] = dict(
            url=url,
            sha256=sha256(raw).hexdigest(),
            canonical=page.canonical,
            githubLinks=sorted(
                link for link in page.links if link.startswith("https://github.com/")
            ),
            downloads=sorted(
                link
                for link in page.links
                if re.search(
                    r"(\.lean|\.csv|\.json|\.parquet|\.zip|\.gz(\.part\d+)?)(\?|$)",
                    link,
                )
            ),
        )
    facts = {row[0]: row[1] for row in pages["guide"].rows if len(row) == 2}

    def extract(label, pattern, factor=1):
        match = re.search(pattern, facts.get(label, "").replace(",", ""))
        return int(match.group(1)) * factor if match else None

    associated = "https://github.com/" + AUTHOR + "/verifytask" in pages["guide"].links
    cited = "https://github.com/" + MIRROR in pages["sources"].links
    metrics = dict(
        reportedFiles=extract("文件数", r"(\d+)"),
        reportedApproxLines=extract("代码行数", r"(\d+)\s*万", 10000),
        reportedArchiveBytes=extract("源码包大小", r"(\d+)\s*字节"),
    )
    return dict(
        url=SITE,
        guide=SITE + "riemann/",
        sourcePage=SITE + "riemann/sources/",
        role="Reading guide" if cited else "Source attribution needs review",
        contributorAccountLinked=associated,
        mirrorLinked=cited,
        **metrics,
        evidence=evidence(root, "site", dict(pages=records, reported=metrics)),
    )


def src_tree(repo, revision):
    tree = api(f"repos/{repo}/git/trees/{pin(revision)}")
    if tree.get("truncated"):
        raise ValueError("Incomplete top-level tree in " + repo)
    return pin(
        next(
            row["sha"]
            for row in tree["tree"]
            if row["path"] == "src" and row["type"] == "tree"
        )
    )


def mirror_snapshots(dates, instant, original):
    if not dates:
        return {}
    tip = pin(api(f"repos/{MIRROR}/commits", per_page=1)[0]["sha"])
    records, trees = {}, {}
    revision, commit = tip, None
    for day in reversed(dates):
        limit = min(instant, datetime.combine(day, time.max, UTC))
        while revision:
            if commit is None:
                commit = api(f"repos/{MIRROR}/git/commits/{revision}")
            if date_time(commit["committer"]["date"]) <= limit:
                break
            parents = commit["parents"]
            revision = pin(parents[0]["sha"]) if parents else None
            commit = None
        if revision is None:
            records[day] = None
            continue
        if revision not in trees:
            trees[revision] = src_tree(MIRROR, revision)
        records[day] = dict(
            commit=revision,
            committedAt=commit["committer"]["date"],
            sourceTree=trees[revision],
            equalsSubmission=trees[revision] == original,
            sourceUrl=f"https://github.com/{MIRROR}/tree/{revision}/src",
        )
    return records


def lean(path):
    return (
        path.startswith("src/")
        and path.endswith(".lean")
        and path != "src/Challenge.lean"
    )


def source(repo, revision, path, line):
    fragment = f"#L{line}" if line else ""
    return f"https://github.com/{repo}/blob/{pin(revision)}/{quote(path, safe='/')}{fragment}"


def blob_id(data):
    return sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def physical_lines(data):
    return data.count(b"\n") + int(bool(data) and not data.endswith(b"\n"))


def file_measure(
    path, old_path, before, after, adds, dels, before_repo, after_repo, base, head
):
    left, right = before or b"", after or b""
    n, m = physical_lines(left), physical_lines(right)
    if m - n != adds - dels:
        raise ValueError("Source bodies and diff totals disagree for " + path)
    # First unequal physical line, clamped to a surviving line on each side for an insertion at EOF.
    index = 1
    for x, y in zip(left.split(b"\n"), right.split(b"\n")):
        if x != y:
            break
        index += 1
    return dict(
        path=path,
        beforePath=old_path if before is not None else None,
        beforeUrl=source(before_repo, base, old_path, min(index, n))
        if before is not None
        else None,
        afterUrl=source(after_repo, head, path, min(index, m))
        if after is not None
        else None,
        beforeBlob=blob_id(left) if before is not None else None,
        afterBlob=blob_id(right) if after is not None else None,
        linesBefore=n,
        linesAfter=m,
        bytesBefore=len(left),
        bytesAfter=len(right),
        insertedLines=adds,
        deletedLines=dels,
        netLines=m - n,
    )


def git(git_dir, *args):
    return subprocess.check_output(["git", "-C", str(git_dir), *args])


def git_rows(repo, before_repo, after_repo, base, head):
    for name, sha in [(before_repo, base), (after_repo, head)]:
        has = subprocess.run(
            ["git", "-C", str(repo), "cat-file", "-e", sha + "^{commit}"],
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if has.returncode:
            git(
                repo,
                "fetch",
                "--no-tags",
                "--no-write-fetch-head",
                "https://github.com/" + name + ".git",
                sha + ":refs/atlas-verifytask/pins/" + sha,
            )
    # Use physical path accounting for additions, removals and moves alike.
    args = ["--no-renames", "-z", base, head, "--", "src/"]
    entries = git(repo, "diff", "--raw", "--no-abbrev", *args).split(b"\0")[:-1]
    changes = {}
    for mode, file in zip(entries[::2], entries[1::2]):
        path = file.decode()
        if lean(path):
            _, _, old_oid, new_oid, _ = mode.decode().split()
            changes[path] = old_oid, new_oid
    rows = []
    with subprocess.Popen(
        ["git", "-C", str(repo), "cat-file", "--batch"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
    ) as cat:

        def body(oid):
            if oid == "0" * 40:
                return None
            cat.stdin.write((oid + "\n").encode())
            cat.stdin.flush()
            name, kind, length = cat.stdout.readline().split()
            data = cat.stdout.read(int(length))
            if (
                kind != b"blob"
                or name.decode() != oid
                or cat.stdout.read(1) != b"\n"
                or blob_id(data) != oid
            ):
                raise ValueError("Invalid Git blob " + oid)
            return data

        try:
            for record in filter(
                None, git(repo, "diff", "--numstat", *args).split(b"\0")
            ):
                a, d, p = record.split(b"\t", 2)
                path = p.decode()
                if path in changes:
                    old_oid, new_oid = changes.pop(path)
                    rows.append(
                        file_measure(
                            path,
                            path,
                            body(old_oid),
                            body(new_oid),
                            int(a),
                            int(d),
                            before_repo,
                            after_repo,
                            base,
                            head,
                        )
                    )
        finally:
            cat.stdin.close()
    if changes or cat.returncode:
        raise RuntimeError("Incomplete local comparison")
    return rows


def http_rows(response, before_repo, after_repo, base, head):
    files = response["files"]
    if len(files) >= 300:
        raise ValueError(
            "The GitHub compare list can end at 300 files; supply --git for this revision"
        )

    def read_file(row):
        path = row["filename"]
        old_path = row.get("previous_filename", path)

        def raw(repo, sha, name):
            return get(
                f"https://raw.githubusercontent.com/{repo}/{sha}/{quote(name, safe='/')}"
            )

        before = (
            raw(before_repo, base, old_path)
            if lean(old_path) and row["status"] not in ("added", "copied")
            else None
        )
        after = (
            raw(after_repo, head, path)
            if lean(path) and row["status"] != "removed"
            else None
        )
        if after is not None and blob_id(after) != pin(row["sha"]):
            raise ValueError("GitHub raw source differs from its Git blob: " + path)
        pins = (before_repo, after_repo, base, head)
        if row["status"] == "renamed":
            # Use the same physical path convention as git diff --no-renames.
            result = []
            if before is not None:
                result.append(
                    file_measure(
                        old_path,
                        old_path,
                        before,
                        None,
                        0,
                        physical_lines(before),
                        *pins,
                    )
                )
            if after is not None:
                result.append(
                    file_measure(
                        path, path, None, after, physical_lines(after), 0, *pins
                    )
                )
            return result
        adds, dels = row["additions"], row["deletions"]
        if row["status"] == "copied":
            adds, dels = physical_lines(after or b""), 0
        return [file_measure(path, old_path, before, after, adds, dels, *pins)]

    relevant = [
        r for r in files if lean(r["filename"]) or lean(r.get("previous_filename", ""))
    ]
    with ThreadPoolExecutor(max_workers=4) as pool:
        return [row for result in pool.map(read_file, relevant) for row in result]


def comparison(root, git_dir, before_repo, after_repo, base, head, github_data=None):
    if git_dir:
        rows = git_rows(git_dir, before_repo, after_repo, base, head)
    else:
        response = github_data or api(
            f"repos/{after_repo}/compare/{base}...{head}", per_page=1
        )
        if response["merge_base_commit"]["sha"] != base:
            raise ValueError("The HTTP comparison has a different merge base")
        rows = http_rows(response, before_repo, after_repo, base, head)
    rows.sort(key=lambda row: row["path"])
    groups = defaultdict(lambda: dict(files=0, netLines=0))
    for row in rows:
        group = groups[row["path"].rsplit("/", 1)[0].removeprefix("src/")]
        group["files"] += 1
        group["netLines"] += row["netLines"]
    keys = (
        "linesBefore",
        "linesAfter",
        "bytesBefore",
        "bytesAfter",
        "insertedLines",
        "deletedLines",
        "netLines",
    )
    totals = {k: sum(row[k] for row in rows) for k in keys}
    obj = dict(
        base=base,
        head=head,
        beforeRepository=before_repo,
        afterRepository=after_repo,
        files=rows,
        totals=totals,
        scope="Changed physical Lean paths in src, excluding Challenge.lean. A final unterminated line counts as one source line.",
    )
    details = evidence(root, "comparison", obj)
    return dict(
        files=len(rows),
        **totals,
        details=details,
        groups=[
            dict(name=k, **v)
            for k, v in sorted(groups.items(), key=lambda pair: pair[1]["netLines"])
        ],
    )


def search_pulls(since):
    query = f"repo:{UPSTREAM} is:pr author:{AUTHOR} updated:>={since}"
    page = 1
    numbers = []
    while True:
        response = api("search/issues", q=query, per_page=100, page=page)
        if response["incomplete_results"] or response["total_count"] > 1000:
            raise RuntimeError("Incomplete upstream PR discovery for " + AUTHOR)
        numbers.extend(i["number"] for i in response["items"])
        if len(numbers) >= response["total_count"]:
            return numbers
        if not response["items"]:
            raise RuntimeError("Incomplete search pagination")
        page += 1


def check_assets(root, index):
    """Check the atomic manifest and its content-addressed evidence without a network."""
    seen = {}

    def read(asset):
        matched = re.fullmatch(
            r"evidence/(?:site|observation|comparison)-([0-9a-f]{64})\.json", asset
        )
        if not matched:
            raise ValueError("Invalid evidence object path")
        raw = (root / asset).read_bytes()
        if sha256(raw).hexdigest() != matched.group(1):
            raise ValueError("Evidence checksum mismatch: " + asset)
        return json.loads(raw)

    def measured(prop):
        result = prop["comparison"]
        asset = result["details"]
        pins = (prop["base"], prop["head"])
        if asset in seen:
            if seen[asset] != pins:
                raise ValueError("Reused comparison source pins differ")
            return
        data = read(asset)
        if data["base"] != prop["base"] or data["head"] != prop["head"]:
            raise ValueError("Comparison source pins differ")
        rows = data["files"]
        totals = data["totals"]
        if (
            len(rows) != result["files"]
            or any(
                sum(r[key] for r in rows) != v or result[key] != v
                for key, v in totals.items()
            )
            or totals["netLines"] != totals["insertedLines"] - totals["deletedLines"]
            or totals["netLines"] != totals["linesAfter"] - totals["linesBefore"]
        ):
            raise ValueError("Comparison totals differ")
        for row in rows:
            for side, rev, path in [
                ("before", prop["base"], row["beforePath"]),
                ("after", prop["head"], row["path"]),
            ]:
                url = row[side + "Url"]
                if row[side + "Blob"] is None and url is None:
                    continue
                pin(row[side + "Blob"])
                expected = source(data[side + "Repository"], rev, path, 0)
                if not url:
                    raise ValueError("Missing source link")
                address, _, fragment = url.partition("#")
                lines = row["lines" + side.capitalize()]
                if (
                    address != expected
                    or (lines and not re.fullmatch(r"L[1-9][0-9]*", fragment))
                    or (fragment and not 1 <= int(fragment[1:]) <= lines)
                ):
                    raise ValueError("Source link disagrees with its pin")
        seen[asset] = pins

    for entry in [index] + [read(path) for path in index["observations"]]:
        read(entry["site"]["evidence"])
        for prop in entry["proposals"]:
            measured(prop)
    previous = previous_mirror = None
    for day in index["days"]:
        current = date.fromisoformat(day["date"])
        if previous and current != previous + timedelta(days=1):
            raise ValueError("Calendar gap in mirror snapshots")
        if day["observation"] and day["observation"] not in index["observations"]:
            raise ValueError("Missing dated observation")
        mirror = day["mirror"]
        if mirror:
            pin(mirror["commit"])
            if mirror["equalsSubmission"] != (
                pin(mirror["sourceTree"]) == index["mirror"]["originalTree"]
            ):
                raise ValueError("Mirror tree identity differs")
        if day.get("mirrorChange"):
            if not previous_mirror or not mirror:
                raise ValueError("Missing predecessor for mirror change")
            measured(
                {
                    "base": previous_mirror["commit"],
                    "head": mirror["commit"],
                    "comparison": day["mirrorChange"],
                }
            )
        previous, previous_mirror = current, mirror


def collect(output_directory, observed_at_datetime, git_dir=None):
    root = Path(output_directory)
    if observed_at_datetime.tzinfo is None:
        raise ValueError("Pass a timezone-aware cutoff")
    instant = observed_at_datetime.astimezone(UTC)
    today = instant.date()
    checked = datetime.now(UTC)
    if instant > checked + timedelta(seconds=1):
        raise ValueError("Cannot observe a future cutoff")
    dest = root / "index.json"
    prior = json.loads(dest.read_bytes()) if dest.exists() else {}
    if prior and (prior.get("schema") != 1 or date_time(prior["asOf"]) > instant):
        raise ValueError("Incompatible or newer published observation")
    site = site_record(root)
    site["observedAt"] = stamp(checked)
    days = {date.fromisoformat(d["date"]): d for d in prior.get("days", [])}
    start = min(days) if days else today - timedelta(days=2)
    pending = [
        start + timedelta(days=i)
        for i in range((today - start).days + 1)
        if not days.get(start + timedelta(days=i), {}).get("final")
    ]
    original = src_tree(UPSTREAM, BASELINE)
    snapshots = mirror_snapshots(pending, instant, original)
    proposals = {p["number"]: p for p in prior.get("proposals", [])}
    numbers = set(search_pulls(min(pending).isoformat())) | {
        n for n, p in proposals.items() if p["status"] == "open"
    }
    for number in sorted(numbers):
        data = api(f"repos/{UPSTREAM}/pulls/{number}")
        head_repo = (data["head"].get("repo") or {}).get("full_name")
        if (
            data["user"]["login"] != AUTHOR
            or head_repo != FORK
            or date_time(data["created_at"]) > instant
        ):
            continue
        head = pin(data["head"]["sha"])
        target = pin(data["base"]["sha"])
        merged = data["merged_at"]
        if merged:
            merge_sha = pin(data["merge_commit_sha"])
            merge = api(f"repos/{UPSTREAM}/git/commits/{merge_sha}")
            target = pin(merge["parents"][0]["sha"])
        gh = api(f"repos/{FORK}/compare/{target}...{head}", per_page=1)
        base = pin(gh["merge_base_commit"]["sha"])
        old = proposals.get(number, {})
        if (base, head) == (old.get("base"), old.get("head")):
            totals = old["comparison"]
        else:
            totals = comparison(root, git_dir, UPSTREAM, FORK, base, head, gh)
        state = "merged" if merged else data["state"]
        proposals[number] = dict(
            number=number,
            title=data["title"],
            url=data["html_url"],
            status=state,
            author=AUTHOR,
            repository="https://github.com/" + FORK,
            head=head,
            base=base,
            createdAt=data["created_at"],
            mergedAt=merged,
            updatedAt=data["updated_at"],
            observedAt=stamp(checked),
            comparison=totals,
        )
    for d in pending:
        mirror = snapshots[d]
        previous = days.get(d - timedelta(days=1), {}).get("mirror")
        changed = None
        if previous and mirror and previous["sourceTree"] != mirror["sourceTree"]:
            changed = comparison(
                root, git_dir, MIRROR, MIRROR, previous["commit"], mirror["commit"]
            )
        days[d] = dict(
            date=d.isoformat(),
            final=d < today,
            mirror=mirror,
            mirrorChange=changed,
            opened=sorted(
                n for n, p in proposals.items() if date_time(p["createdAt"]).date() == d
            ),
            observation=days.get(d, {}).get("observation"),
            siteMetricsChange=days.get(d, {}).get("siteMetricsChange"),
        )
    # Keep exact measurements from superseded branch heads and previous site observations addressable.
    observation = evidence(
        root,
        "observation",
        dict(
            asOf=stamp(instant),
            observedAt=stamp(checked),
            site=site,
            proposals=list(proposals.values()),
            mirror=days[today]["mirror"],
        ),
    )
    if today == checked.date():
        days[today]["observation"] = observation
        earlier = next(
            (
                days[d].get("observation")
                for d in sorted(days, reverse=True)
                if d < today and days[d].get("observation")
            ),
            None,
        )
        if earlier:
            previous_site = json.loads((root / earlier).read_bytes())["site"]
            metrics = ("reportedFiles", "reportedApproxLines", "reportedArchiveBytes")
            deltas = {
                key: site[key] - previous_site[key]
                for key in metrics
                if site.get(key) is not None and previous_site.get(key) is not None
            }
            days[today]["siteMetricsChange"] = dict(
                previousEvidence=previous_site["evidence"],
                evidence=site["evidence"],
                changeInReportedValues=deltas,
            )
    history = sorted(set(prior.get("observations", [])) | {observation})
    result = dict(
        schema=1,
        asOf=stamp(instant),
        site=site,
        mirror=dict(
            repository="https://github.com/" + MIRROR,
            originalCommit=BASELINE,
            originalTree=original,
        ),
        days=[days[d] for d in sorted(days)],
        proposals=sorted(proposals.values(), key=lambda p: p["number"]),
        observations=history,
    )
    check_assets(root, result)
    replace_file(dest, encoded(result))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--as-of", type=date_time, default=None)
    parser.add_argument(
        "--check", action="store_true", help="Verify published receipts offline"
    )
    parser.add_argument(
        "--git",
        type=Path,
        help="Bare Git object cache for complete two-sided source measurements",
    )
    args = parser.parse_args()
    if args.check:
        result = json.loads((args.output / "index.json").read_bytes())
        check_assets(args.output, result)
    else:
        result = collect(args.output, args.as_of or datetime.now(UTC), args.git)
    print(
        f"{len(result['days'])} UTC dates, {len(result['proposals'])} contributor proposals, through {result['asOf']}"
    )
