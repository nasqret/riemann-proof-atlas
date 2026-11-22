import {existsSync, readFileSync, appendFileSync} from 'node:fs';
import path from 'node:path';
const [directory,engine]=process.argv.slice(2);
const read = file => existsSync(path.join(directory,file)) ? JSON.parse(readFileSync(path.join(directory,file))) : null;
const visual=read('visual/report.json');
const journeys=read('journeys/journeys.json');
const lines=['## Chapter 5992 · '+engine,''];
if(journeys)lines.push('Reading journeys passed: '+journeys.journeys.map(x=>x.journey).join(', ')+'.','');
if(visual){
  const measured=visual.results.filter(x=>x.audit);
  const issues=new Set(measured.flatMap(x=>x.audit.violations.map(v=>v.id)));
  lines.push('| Check | Passed / recorded |','| --- | ---: |',
    '| Viewport replay | '+visual.results.filter(x=>x.pixels?.passed).length+' / '+visual.results.length+' |',
    '| Exact numbered Lean crops | '+visual.results.filter(x=>x.codePixels?.passed).length+' / '+visual.results.filter(x=>x.codePixels).length+' |',
    '| Accessibility observations | '+measured.length+' |','');
  if(issues.size)lines.push('Accessibility diagnostics: '+[...issues].sort().join(', ')+'.','');
  const flagged=measured.filter(x=>x.audit.exceeded.length);
  if(flagged.length)lines.push('Performance budgets exceeded in '+flagged.length+' observed views. See the artifact for the affected routes and metrics.','');
  if(visual.failures.length){
    lines.push('### Failures','');
    for(const f of visual.failures)lines.push('- '+[f.size?.join('×'),f.id,f.region,f.type,f.message?.split('\n')[0]].filter(Boolean).join(' · '));
  }
}
const text=lines.join('\n')+'\n';
console.log(text);if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,text);
