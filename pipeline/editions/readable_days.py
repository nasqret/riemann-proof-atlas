"""Record the readable edition's separate UTC history from immutable first-parent source trees."""
import argparse
from datetime import datetime, timezone
from pathlib import Path

from daily import day_pins, git, iso, read, rev, save, stamp


START = "47fcde57c49eedd5a6352f4c8745d30bebbe4b0b"


def capture(repo, tip, observed, out):
    head = rev(repo, tip+"^{commit}")
    raw = git(repo, "log", "--first-parent", "--reverse", "--format=%H %ct", head).decode().splitlines()
    chain = [(p, datetime.fromtimestamp(int(t),timezone.utc)) for p,t in (line.split() for line in raw)]
    keys = [p for p,_ in chain]
    if START not in keys:
        raise ValueError("The readable history does not contain its published root-path import")
    chain = chain[keys.index(START):]
    old = read(out) if out.exists() else {"baseline":START,"days":[],"editions":{}}
    if old["baseline"] != START or old.get("capturedAt", "") > stamp(observed):
        raise ValueError("Incompatible readable catalogue")
    old_days = {row["day"]:row for row in old["days"]}
    editions = dict(old["editions"])

    def source(pin):
        tree = rev(repo,pin+":src")
        if pin in editions and editions[pin]["sourceTree"] != tree:
            raise ValueError("Recorded source tree changed for "+pin)
        editions[pin] = {"sourceTree":tree,"committedAt":stamp(iso(git(repo,"show","-s","--format=%cI",pin).decode().strip()))}

    source(START)
    days = []
    for day,pin,closed in day_pins(chain,chain[0][1].date(),observed):
        past = old_days.get(day,{})
        if past.get("closed") and past["pin"] != pin:
            raise ValueError("The readable branch diverged at the recorded close for "+day)
        captures = list(past.get("captures",[]))
        if not any(entry["pin"] == pin for entry in captures):
            captures.append({"pin":pin})
        for entry in captures:
            source(entry["pin"])
        days.append({"day":day,"pin":pin,"closed":closed,"captures":captures})
    save(out,{"schema":1,"repository":"leanprover-community/riemann-hypothesis","branch":"main","baseline":START,
              "capturedAt":stamp(observed),"observedTip":head,"days":days,"editions":editions})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--git",type=Path,required=True)
    parser.add_argument("--tip",required=True)
    parser.add_argument("--as-of",type=iso,required=True)
    parser.add_argument("--out",type=Path,required=True)
    args = parser.parse_args()
    capture(args.git,args.tip,args.as_of,args.out)
