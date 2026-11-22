"""Inventory explicit Lean theorem/lemma commands and link each to hashed physical source."""
import argparse
from collections import Counter
from contextlib import contextmanager
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys
import tarfile

MEMBER = 'lean/src/'
KEY = re.compile(r'(?<![\w.\x27])(?:namespace|section|end|theorem|lemma)\b')
START = re.compile(r'(?:private|protected|public|noncomputable|nonrec|unsafe|partial|local|scoped|meta|nonempty|uniform_inductive)\b')
PART = r'(?:«[^»\n]+»|[^\s.«»(){}⦃⦄\[\]:=|,;@]+)'
NAME = re.compile(PART + '(?:\\.' + PART + ')*')
SPECIAL = re.compile(r'--|/-|(?:r(#+)?")|"(?:\\[\s\S]|[^"\\])*"|(?<![\w\x27])\x27(?:\\[\s\S]|[^\x27\\\n])\x27|«[^»\n]+»')
COMMENT = re.compile(r'/-|-/')
BOUND = re.compile(r':=|[(){}⦃⦄\[\]]|\bwhere\b|^\s*\|', re.M)
IDENT = re.compile(r'[^\s.]+')
ROOTS = ('riemannHypothesis','riemannZeta_eq_zero_re','LFunction_ne_zero_of_half_lt_re','LFunction_eq_zero_re','LFunction_eq_zero_re_of_isPrimitive')

def sha(p):
    h=hashlib.sha256()
    with Path(p).open('rb') as f:
        for b in iter(lambda:f.read(4<<20),b''): h.update(b)
    return h.hexdigest()

def dump(x): return json.dumps(x,ensure_ascii=False,separators=(',',':'))
def require(value,msg):
    if not value: raise ValueError(msg)

@contextmanager
def gzwrite(path):
    with Path(path).open('wb') as raw:
        with gzip.GzipFile(fileobj=raw,filename='',mtime=0,mode='wb',compresslevel=3) as f: yield f

def mask(text):
    """Preserve positions and newlines while ignoring strings, nested comments and char literals."""
    chunks=[]; pos=0
    while m:=SPECIAL.search(text,pos):
        i,j=m.span(); tag=m[0]
        chunks.append(text[pos:i])
        if tag.startswith('«'):
            chunks.append(tag);pos=j;continue
        if tag=='/-':
            d=1
            while d:
                k=COMMENT.search(text,j);require(k is not None,'unterminated block comment')
                d+=1 if k[0]=='/-' else -1;j=k.end()
        elif tag=='--':
            j=text.find('\n',j)
            if j<0:j=len(text)
        elif tag.startswith('r') and (i==0 or not (text[i-1].isalnum() or text[i-1] in "_'")):
            term='"'+(m[1] or '');stop=text.find(term,j)
            require(stop>=0,'unterminated raw string');j=stop+len(term)
        elif tag.startswith('r'):
            # The r is the last character of a regular identifier. Its quote opens a normal string.
            q=re.match(r'"(?:\\[\s\S]|[^"\\])*"',text[j-1:]);require(q,'unterminated string')
            j=j-1+q.end()
        chunks.append(re.sub(r'[^\n]',' ',text[i:j]));pos=j
    return ''.join(chunks)+text[pos:]

def prefix_modifiers(prefix):
    prefix=prefix.strip();mods=[]
    while prefix:
        if prefix.startswith('@['):
            depth=1;k=2
            while depth and k<len(prefix):
                depth+=(prefix[k]=='[')-(prefix[k]==']');k+=1
            if depth: return None
            prefix=prefix[k:].lstrip();continue
        m=START.match(prefix)
        if not m:return None
        mods.append(m[0]);prefix=prefix[m.end():].lstrip()
    return mods

def clean_name(name):
    return '.'.join(x[1:-1] if x.startswith('«') else x for x in re.findall(r'«[^»]*»|[^.]+',name))

def declarations(module,text,file_sha,audit):
    from bisect import bisect_right
    code=mask(text);starts=[0]+[m.end() for m in re.finditer('\n',text)]
    stack=[];namespace='';pending_mods=[];candidates=[]
    for token in KEY.finditer(code):
        pos=token.start();idx=bisect_right(starts,pos)-1
        prefix=code[starts[idx]:pos]; tag=token[0]; mods=prefix_modifiers(prefix)
        if mods is None:
            if tag in ('theorem','lemma'):
                audit['noncommand_keyword']+=1
            continue
        if tag in ('namespace','section'):
            i=token.end()
            while i<len(code) and code[i] in ' \t':i+=1
            m=NAME.match(code,i)
            label=clean_name(m[0]) if m else ''
            stack.append((namespace,tag,label))
            if tag=='namespace':
                require(label, f'{module}:{idx+1}: unlabeled namespace')
                namespace=label.removeprefix('_root_.') if label.startswith('_root_.') else '.'.join(filter(None,(namespace,label)))
            continue
        if tag=='end':
            if stack: namespace=stack.pop()[0]
            else:audit['end_without_scope']+=1
            continue
        i=token.end()
        while i<len(code) and code[i].isspace(): i+=1
        m=NAME.match(code,i);require(m and m[0],f'{module}:{idx+1}: unwritten declaration name')
        line=bisect_right(starts,i);col=i-starts[line-1]+1
        # A modifier may be on its own preceding line. Never cross a declaration or a blank command.
        j=idx-1
        while j>=0:
            prior=code[starts[j]:starts[j+1]].strip()
            if not prior:break
            inherited=prefix_modifiers(prior)
            if inherited is None:break
            mods=inherited+mods;j-=1
        spelling=text[m.start():m.end()];plain=clean_name(spelling)
        qualified=plain.removeprefix('_root_.') if plain.startswith('_root_.') else '.'.join(filter(None,(namespace,plain)))
        candidates.append((token.start(),m.end(),line,col,tag,spelling,qualified,mods))
    for j,(s,after,line,col,tag,spelling,qualified,mods) in enumerate(candidates):
        limit=candidates[j+1][0] if j+1<len(candidates) else len(code)
        depth=0;stop=None
        for m in BOUND.finditer(code,after,limit):
            v=m[0]
            if v in ('(', '{','⦃','['):depth+=1
            elif v in (')','}','⦄',']'):depth-=1
            elif depth==0:stop=m.start();break
        if stop is None:
            audit['signature_delimiter_unresolved']+=1;audit['signature review '+module+':'+str(line)+':'+str(col)]+=1;stop=after
        yield dict(id=f'{module}:{line}:{col}',module=module,member=MEMBER+module.replace('.','/')+'.lean',
                   sha256=file_sha,line=line,column=col,keyword=tag,spelling=spelling,qualified=qualified,
                   visibility='private' if 'private' in mods else ('protected' if 'protected' in mods else 'public'),
                   signature=text[s:stop].rstrip())
    if any(t=='namespace' for _,t,_ in stack):audit['file_with_unclosed_namespace']+=1

def visit(args):
    expected={}
    with gzip.open(args.manifest,'rt') as f:
        for line in f:
            digest,member=line.rstrip('\n').split('  ',1)
            if member.startswith(MEMBER) and member.endswith('.lean'):expected[member]=digest
    if args.sample:expected={m:s for m,s in expected.items() if m in {MEMBER+x.replace('.','/')+'.lean' for x in args.sample}}
    remain=set(expected);roots={};stats=Counter();keywords=Counter();audit=Counter()
    def process(member,data,out):
        require(member in remain,'duplicate/unexpected source '+member)
        remain.remove(member);digest=hashlib.sha256(data).hexdigest();require(digest==expected[member],'source digest '+member)
        module=member[len(MEMBER):-5].replace('/','.')
        n=0
        for row in declarations(module,data.decode('utf-8'),digest,audit):
            require(row['member']==member,'module/member bijection')
            out.write((dump(row)+'\n').encode());n+=1;keywords[row['keyword']]+=1
            if module=='Main':roots[row['qualified']]=row['id']
        stats['modules']+=1;stats['bytes']+=len(data);stats['statements']+=n
        if not n:stats['without_written_statement']+=1
    args.out.mkdir(parents=True,exist_ok=True)
    partial=args.out/'source-lexical.jsonl.gz.partial'
    with gzwrite(partial) as out:
        if args.tar:
            with tarfile.open(mode='r|*',fileobj=sys.stdin.buffer) as tar:
                for f in tar:
                    m=f.name.removeprefix('./')
                    if m in expected:process(m,tar.extractfile(f).read(),out)
        else:
            for m in sorted(expected):process(m,(args.root/m[len(MEMBER):]).read_bytes(),out)
    require(not remain,f'{len(remain)} original members missing')
    if not args.sample:require(stats['modules']==175187 and tuple(roots)==ROOTS,'original module or endpoint coverage')
    path=args.out/'source-lexical.jsonl.gz';partial.replace(path)
    obj=dict(stats=stats,keywords=keywords,diagnostics=audit,roots=roots,manifest_sha256=sha(args.manifest),
             source_table_sha256=sha(path),driver_sha256=sha(Path(__file__)))
    (args.out/'source-receipt.json').write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n');print(dump(obj))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    mode=p.add_mutually_exclusive_group(required=True);mode.add_argument('--root',type=Path);mode.add_argument('--tar',action='store_true')
    p.add_argument('--sample',nargs='+');visit(p.parse_args())
