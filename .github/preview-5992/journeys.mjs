/** End-to-end acceptance checks for the chapter 5992 candidate. Run with Playwright installed. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium, firefox, webkit } = require(process.env.ATLAS_PLAYWRIGHT || 'playwright');
const base = new URL(process.argv[2]);
const dest = process.argv[3];
if (dest) await mkdir(dest, { recursive: true });
const engine = process.env.ATLAS_ENGINE || 'chromium';
const browser = await ({chromium,firefox,webkit})[engine].launch({headless:true});
const coker = 'Development.AutomorphicArithmetic.AutomorphicVarieties.NumberFieldTowers.CokerDual:8:9';
const root = base.href.split('#')[0];
const sourceEnd = 'CokerDual.lean#L8-L19';
const reports = [];
const errors = [];
async function run(label, task, mobile=false) {
  const context = await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},reducedMotion:'reduce'});
  const page = await context.newPage();
  const traffic = [];
  page.on('response',r=>traffic.push({url:r.url(),status:r.status()}));
  page.on('pageerror',e=>errors.push(label+': '+e.message));
  page.setDefaultTimeout(22000);
  try { const extra = await task(page,traffic); reports.push({journey:label,...extra}); console.log(label+' passed'); }
  catch(e) { if(dest){await mkdir(dest,{recursive:true});await page.screenshot({path:path.join(dest,label+'-failure.png')}).catch(()=>{});}throw e; }
  finally { await context.close(); }
}
async function view(p, type) { await p.locator(`[data-reader-view="${type}"]`).waitFor({state:'visible'}); }
async function cold(p, hash='') { await p.goto(root+hash,{waitUntil:'domcontentloaded'}); }
async function choose(link) { await link.focus(); await link.press('Enter'); }
async function marked(p) {
  const lines=await p.locator('[data-card="step"] [data-source-line][data-marked="true"]').evaluateAll(a=>a.map(x=>Number(x.dataset.sourceLine)));
  assert.deepEqual(lines,[14,15,16]);
}
async function leanStyle(locator) {
  return locator.evaluate(async node => {
    const doc=node.ownerDocument;
    const css=doc.defaultView.getComputedStyle(node);
    await doc.fonts.ready;
    const result={family:css.fontFamily,size:css.fontSize,lineHeight:css.lineHeight,wrap:css.whiteSpace,
      overflowWrap:css.overflowWrap,wordBreak:css.wordBreak,ligatures:css.fontVariantLigatures,tabSize:css.tabSize};
    if(!result.family.includes("Atlas Lean Mono") || ![...doc.fonts].some(font=>font.family.includes("Atlas Lean Mono") && font.status==="loaded"))
      throw Error("The source's own document did not load Atlas Lean Mono: "+JSON.stringify(result));
    return result;
  });
}
try {
  await run('J1',async p=>{
    await cold(p);await choose(p.locator('#whatIsProved'));await view(p,'statement');
    assert.equal(await p.locator('[data-endpoint]').count(),5);
    await choose(p.locator('[data-endpoint="main-rh"] a').first());await view(p,'endpoint');
    await choose(p.locator('[data-component="cohomology"]'));await view(p,'component');
    const prose=p.locator('[data-reader-view="component"] .intro');
    assert.equal(await prose.locator('math').count(),2);
    assert.equal(await prose.locator('math msqrt msup').count(),1);
    assert.equal(await prose.evaluate(n=>[...n.childNodes].filter(x=>x.nodeType===Node.TEXT_NODE).some(x=>x.textContent.includes("$"))),false);
    await choose(p.locator('[data-card="chapters"] a').first());await view(p,'chapter');
    await choose(p.locator('[data-card="reading"] a').first());
    await p.locator('#item option[value="l:cokdual"]').waitFor({state:'attached'});await p.locator('#item').selectOption('l:cokdual');
    await p.locator('#decl option').filter({hasText:'cokerDual'}).waitFor({state:'attached'});await p.locator('#decl').selectOption(coker);
    await p.locator('#step option[value="g-14-3"]').waitFor({state:'attached'});await p.locator('#step').selectOption('g-14-3');
    const f=p.frameLocator('#viewer');const source=f.locator('#key-list pre.lean.is-numbered[aria-label="Lines 14–16"] .ln[data-line]');
    await source.first().waitFor();assert.deepEqual(await source.evaluateAll(a=>a.map(x=>Number(x.dataset.line))),[14,15,16]);
    assert.ok(await f.locator('#key-list a.source-link[href$="CokerDual.lean#L14-L16"]').count());
    const evidence=f.locator('#coverage-note');
    if(!await evidence.isVisible())await f.locator('#note-toggle').click();
    const fact=evidence.locator('[data-field="fact"] > code');
    await fact.waitFor();
    const readerStyle=await leanStyle(f.locator('#key-list pre.lean.is-numbered[aria-label="Lines 14–16"]'));
    assert.deepEqual(await leanStyle(fact),readerStyle);
    assert.equal(readerStyle.wrap,"pre");assert.equal(readerStyle.overflowWrap,"normal");
    assert.equal(readerStyle.ligatures,"none");assert.ok(Math.abs(parseFloat(readerStyle.size)-14)<0.0001);assert.equal(readerStyle.tabSize,"4");
    const numbered=f.locator('#key-list pre.lean.is-numbered[aria-label="Lines 14–16"]');
    const sourcePanel=f.locator('#key-list pre[aria-label="Lines 14–16"] + .lean-actions');
    const factPanel=evidence.locator('[data-field="fact"] .lean-actions');
    for(const [block,actions,label] of [[numbered,sourcePanel,'Copy lines'],[fact,factPanel,'Copy fact']]){
      const before=await block.textContent();
      const wrap=actions.getByRole('button',{name:'Wrap lines'});
      await wrap.click();assert.equal(await wrap.getAttribute('aria-pressed'),'true');
      assert.equal(await block.evaluate(n=>n.ownerDocument.defaultView.getComputedStyle(n).whiteSpace),'pre-wrap');
      assert.equal(await block.textContent(),before);
      await wrap.click();assert.equal(await wrap.getAttribute('aria-pressed'),'false');
      // Verify exact clipboard payload and the selectable fallback in an isolated test tab.
      await block.evaluate(n=>Object.defineProperty(n.ownerDocument.defaultView.navigator,'clipboard',{
        configurable:true,value:{writeText:async text=>{n.ownerDocument.defaultView.atlasCopied=text;}}}));
      await actions.getByRole('button',{name:label}).click();
      assert.equal(await block.evaluate(n=>n.ownerDocument.defaultView.atlasCopied),before);
      await block.evaluate(n=>Object.defineProperty(n.ownerDocument.defaultView.navigator,'clipboard',{
        configurable:true,value:{writeText:async()=>{throw Error('Clipboard unavailable in this test');}}}));
      await actions.getByRole('button',{name:label}).click();const fallback=actions.getByRole('textbox');
      assert.equal(await fallback.inputValue(),before);
      assert.equal(await fallback.evaluate(n=>n.value.substring(n.selectionStart,n.selectionEnd)),before);
    }
    if(dest)await p.screenshot({path:path.join(dest,'companion.png')});
    await choose(p.locator('#structured'));await view(p,'step');await marked(p);
    const inspector=p.locator('[data-card="step"] pre.reader-code').first();
    assert.deepEqual(await leanStyle(inspector),readerStyle);
    return {choicesToNumberedLines:8,lines:[14,15,16],note:'Lemma 8.2',componentFormulas:2,matchingSourceStyles:readerStyle,sourceAndFactActions:true};
  });
  await run('J2',async p=>{
    await cold(p,'#theorem=412256');const card=p.locator('[data-card="membership"]');await card.waitFor();
    assert.match(await card.innerText(),/Lemma 8\.2.*page 12/s);assert.ok(await p.locator(`a[href$="${sourceEnd}"]`).count());
    await choose(card.locator('a[href^="#proof="]'));await view(p,'proof');await choose(p.locator('[data-step="g-14-3"]'));await view(p,'step');await marked(p);
    await p.goBack();await view(p,'proof');await p.goForward();await view(p,'step');assert.ok(await p.locator('.reader-trail a').count()>=4);return {atlasRow:412256,fullRange:[8,19],history:true};
  });
  await run('J3',async p=>{
    await cold(p,'#chapter=tower-bound');await view(p,'chapter');const imports=p.locator('[data-card="imports"] [data-import]');assert.equal(await imports.count(),110);
    const importFold=p.locator('[data-card="imports"] details').first();
    await importFold.locator('summary').click();
    const note=imports.filter({hasText:'Kum.dinfNil'}).getByRole('link',{name:'Read Theorem A · page 1 in the published note'});
    const noteUrl=await note.getAttribute('href');assert.ok(noteUrl.endsWith('local-nilpotence-0d6916877cbe.pdf#nameddest=section%2A.1'));
    const desc=imports.filter({hasText:'Tower.desc'}).first();assert.match(await desc.innerText(),/6879/);await choose(desc.locator('a').first());await view(p,'outside');
    assert.match(await p.locator('[data-reader-view="outside"]').innerText(),/6879/);await choose(p.locator('[data-reader-view="outside"] a').filter({hasText:'Return to'}).first());await view(p,'chapter');
    return {imports:110,outsideOwner:'1.6879',return:true,publishedImport:noteUrl};
  });
  await run('J5',async p=>{
    await cold(p,'#chapter=1.5992');await view(p,'chapter');const group=p.locator('svg [data-outline-node]');await group.first().waitFor({state:'visible'});assert.equal(await group.count(),13);
    const descent=p.locator('svg [data-outline-node="descent"]');await descent.hover();await p.waitForFunction(()=>!!document.querySelector('svg [data-member-line]'));
    if(dest)await p.screenshot({path:path.join(dest,'map.png')});await choose(descent);await p.locator('[data-selected-node="descent"]').waitFor();
    const stub=p.locator('svg [data-map-import]').first();await choose(stub);await view(p,'outside');await p.goBack();await view(p,'chapter');return {outline:13,memberLinesOnHover:true,outsideStub:true};
  });
  await run('mobile-proof',async(p,traffic)=>{
    await cold(p,'#proof='+encodeURIComponent(coker)+'&step=g-14-3');await view(p,'step');await marked(p);
    const requested=traffic.map(x=>new URL(x.url).pathname).filter(x=>/\/(chapters|proofs)\//.test(x));assert.ok(!requested.some(s=>s.endsWith('/chapters/1.5992.json')));assert.ok(requested.some(s=>s.endsWith('/proofs/412256.json')));
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1));if(dest)await p.screenshot({path:path.join(dest,'mobile.png')});
    return {width:390,sourceLines:[14,15,16],chapterResources:requested.map(x=>x.split('/').slice(-2).join('/'))};
  },true);
  await run('unknown-address',async p=>{await cold(p,'#chapter=6.missing');await view(p,'missing');assert.match(await p.locator('[data-reader-view="missing"]').innerText(),/6\.missing/);return {recovery:true};});
  assert.deepEqual(errors,[]);
  const report={base:root,engine,version:browser.version(),journeys:reports,errors};if(dest){await mkdir(dest,{recursive:true});await writeFile(path.join(dest,'journeys.json'),JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify(report));
}finally{await browser.close();}
