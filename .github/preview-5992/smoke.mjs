/** Functional interface checks against the URL of an assembled candidate. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {checkShell} from './check_shell.mjs';
const pw=createRequire(import.meta.url)(process.env.ATLAS_PLAYWRIGHT||'playwright');
const [address,engine='chromium',receipt]=process.argv.slice(2);
const base=new URL(address), browser=await pw[engine].launch({headless:true});
const pages=[['index.html#chapter=1.5992','[data-reader-view="chapter"]','Chapters'],['index.html#chapter','[data-reader-view="chapters"]','Chapters'],['daily.html','#contents h2','History'],['editions.html','body[data-ready="true"]','Editions'],['structured.html#reflection','article#reflection','Structured proofs'],['notes.html#method','section#method','Method and sources']];
const rows=[];
try{
  const chapter=await (await fetch(new URL('chapters/1.5992.json',base))).json();
  for(const [width,height] of [[1440,900],[390,844]]){
    const c=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}), p=await c.newPage();
    p.setDefaultTimeout(30000);
    const errors=[];p.on('pageerror',e=>errors.push(e.message));
    for(const [path,ready,current] of pages){
      await p.goto(new URL(path,base).href,{waitUntil:'domcontentloaded'});await p.locator(ready).first().waitFor({state:'attached'});
      const result=await p.evaluate(checkShell);assert.equal(result.current,current);assert.equal(result.menu,width===390);
      if(path.endsWith('1.5992')){
        const labels=await p.locator('svg .outline-node text').evaluateAll(list=>list.map(e=>({text:[...e.querySelectorAll('tspan')].map(t=>t.textContent).join(' '),
          fits:e.getBBox().width<=e.parentNode.querySelector('rect').width.baseVal.value&&e.getBBox().height<=e.parentNode.querySelector('rect').height.baseVal.value})));
        assert.deepEqual(labels.map(n=>n.text),chapter.outline.nodes.filter(n=>n.id!=='setting').map(n=>n.title));assert.ok(labels.every(n=>n.fits));
        const lead=await p.locator('[data-card="exports"] a').allTextContents();assert.ok(lead[0].includes('Theorem D'));assert.ok(lead[1].includes('Theorem D'));result.fullOutlineLabels=labels.length;result.firstExports=2;
      }
      if(width===390){const menu=p.locator('.site-menu');await menu.focus();await menu.press('Enter');assert.equal(await menu.getAttribute('aria-expanded'),'true');await menu.press('Escape');assert.equal(await menu.getAttribute('aria-expanded'),'false');assert.equal(await menu.evaluate(e=>e===document.activeElement),true);}
      rows.push(result);
    }
    assert.deepEqual(errors,[]);await c.close();
  }
  const result={url:base.href,engine,version:browser.version(),pages:rows};if(receipt)await writeFile(receipt,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}
