"""Find each first-parent change to the upstream Lean source using Git tree metadata."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess


def git(repo, *args):
    return subprocess.check_output(['git','-C',str(repo),*args]).decode().strip()


def source_changes(repo, cursor, tip):
    tip = git(repo,'rev-parse','--verify',tip+'^{commit}')
    # Keep comparisons on the observed first-parent line, including source reverts.
    history = git(repo,'rev-list','--first-parent',tip).splitlines()
    if cursor not in history:
        raise ValueError('Upstream first-parent ancestry diverged from '+cursor)
    commits = list(reversed(history[:history.index(cursor)]))
    result = []
    parent = cursor
    for pin in commits:
        source_tree = git(repo,'rev-parse',pin+':src')
        previous = git(repo,'rev-parse',parent+':src')
        if source_tree != previous:
            changed = git(repo,'diff','--name-only','--no-renames',parent,pin,'--',
                          ':(glob)src/**/*.lean',':(exclude)src/Challenge.lean')
            if changed:
                message = git(repo,'show','-s','--format=%s%n%b',pin)
                subject, *body = message.splitlines()
                match = re.search(r'(?:Merge pull request #|\(#)(\d+)',subject)
                number = int(match.group(1)) if match else None
                title = next((line.strip() for line in body if line.strip()),subject) if subject.startswith('Merge pull request') else subject
                row = dict(id='merge-'+str(number) if number else 'source-'+pin[:12],title=title,
                           status='merged',date=git(repo,'show','-s','--format=%cI',pin)[:10],commit=pin,
                           description=f"{len(changed.splitlines()):,} Lean source paths changed relative to the preceding mainline revision.")
                if number:row['pr']=number
                result.append(row)
        parent=pin
    return tip,result


def advance(repo, registry, tip):
    pin, rows=source_changes(repo, registry['observedMain'], tip)
    known={r['commit'] for r in registry['editions']}
    fresh=[r for r in rows if r['commit'] not in known]
    used_ids={r['id'] for r in registry['editions']}
    for row in fresh:
        if row['id'] in used_ids:row['id']='source-'+row['commit'][:12]
        used_ids.add(row['id'])
    promoted={r['pr'] for r in fresh if 'pr' in r}
    updated=dict(registry,observedMain=pin,editions=registry['editions']+fresh,
                 otherProposals=[r for r in registry['otherProposals'] if r['pr'] not in promoted])
    if pin != registry['observedMain']:
        updated['observedAt']=datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    return updated,fresh


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--git',required=True,type=Path)
    p.add_argument('--registry',type=Path,default=Path(__file__).with_name('registry.json'))
    p.add_argument('--tip',default='refs/remotes/origin/main')
    p.add_argument('--output',required=True,type=Path)
    a=p.parse_args()
    registry=json.loads(a.registry.read_bytes())
    tip, rows=source_changes(a.git,registry['observedMain'],a.tip)
    a.output.write_text(json.dumps(dict(repository=registry['repository'],since=registry['observedMain'],
                                      tip=tip,changes=rows),indent=2,ensure_ascii=False)+'\n')
    print(f'{len(rows)} new source-changing mainline revisions through {tip}')
