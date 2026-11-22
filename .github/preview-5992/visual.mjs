// Run baseline and candidate in the same engine, OS and font environment.
import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { settle } from "./settle.mjs";
import { audit, budgets } from "./audit.mjs";
const directory=path.dirname(fileURLToPath(import.meta.url));
const defaults=JSON.parse(await readFile(path.join(directory,"routes.json")));
const args=parseArgs({options:{
  engine:{type:"string",default:"all"},scope:{type:"string",default:"all"},
  reference:{type:"string",default:defaults.chapter},"reference-inherited":{type:"string",default:defaults.inherited},
  candidate:{type:"string"},"candidate-inherited":{type:"string"},
  sheet:{type:"string"},"candidate-sheet":{type:"string"},"fixture-set":{type:"string",default:"chapter"},
  out:{type:"string",default:"visual-results"},"record-only":{type:"boolean",default:false},
  "report-diffs":{type:"boolean",default:false},goldens:{type:"string"},
  width:{type:"string",default:"all"},only:{type:"string"},help:{type:"boolean"},
  audit:{type:"boolean"},"enforce-audits":{type:"boolean"},
}}).values;
if(args.help){console.log(`node visual.mjs --candidate URL --sheet URL --candidate-sheet URL --out DIRECTORY
  --engine all|chromium|firefox|webkit   --width all|1440|390   --scope all|routes|sheet
  --fixture-set submission|chapter      --reference URL        --reference-inherited URL
  --candidate-inherited URL defaults to the candidate root. Supply the public root when pages are inherited.
  --record-only writes references. --goldens DIR compares to an existing record-only run.
  --report-diffs collects before/after differences without approving them.
  --audit reports axe WCAG 2.2 AA and observed speed budgets on all twelve routes and the component gallery.
  --enforce-audits also fails on existing audit findings.
  --only <view-id> runs one case. A missing view, source fixture, engine, HTTP page or screenshot always fails.`);process.exit();}
const suite=["all","routes","sheet"].includes(args.scope) && args["fixture-set"]==="chapter";
if(!suite || (!args["record-only"]&&!args.candidate) || (args.scope!=="routes" && ((!args.goldens&&!args.sheet) || (!args["record-only"]&&!args["candidate-sheet"]))))throw Error("Missing or invalid visual suite configuration; use --help");
if(args["record-only"] && args.goldens)throw Error("Choose record-only mode or a saved baseline");
const engines=args.engine==="all"?["chromium","firefox","webkit"]:[args.engine];
if(!engines.every(e=>["chromium","firefox","webkit"].includes(e)))throw Error("Unknown browser engine");
const sizes=defaults.widths.filter(([w])=>args.width==="all" || String(w)===args.width);
if(!sizes.length)throw Error("Width must be all, 1440 or 390");
const pw=createRequire(import.meta.url)(process.env.ATLAS_PLAYWRIGHT || "playwright");
const out=path.resolve(args.out);await mkdir(out,{recursive:true});
const publicSheet=new URL("interface/baseline/sheet/",defaults.chapter);
const settingsResponse=await fetch(new URL("settings.json",publicSheet));
if(!settingsResponse.ok)throw Error("Chapter component settings unavailable");
const settings=await settingsResponse.json();
const sourceURL=new URL(settings.fixtures,publicSheet);
if(sourceURL.origin!==publicSheet.origin || sourceURL.href!==new URL("chapter.json",publicSheet).href)throw Error("Unexpected public case file");
const response=await fetch(sourceURL);
if(!response.ok)throw Error("The chapter examples are unavailable");
const fixtures=await response.json();
if(fixtures.scope!=="chapter 1.5992" || fixtures.fixtures.length!==30)throw Error("Expected thirty released chapter examples");
const sheetRoutes=[{id:"sheet-states",base:"sheet",path:"index.html#states",ready:"body[data-ready=reference] .states",position:"top"},
  ...fixtures.fixtures.map(f=>({id:"fixture-"+f.key,base:"sheet",path:"index.html#fixture="+encodeURIComponent(f.key),
    ready:'body[data-ready=reference] [data-fixture="'+f.key+'"]',position:"top",fixture:f.key,first:f.first,last:f.last}))];
const productionRoutes=[
  {id:"production-explorer",base:"production",path:"index.html",ready:"body[data-ready=true] .stats",position:"top"},
  {id:"production-theorem",base:"production",path:"index.html#theorem=385692",ready:"body[data-ready=true] #panel .bigcode",position:"inspector"}
];
const cases=[...(args.scope!=="sheet"?[...defaults.routes,...productionRoutes]:[]),...(args.scope!=="routes"?sheetRoutes:[])].filter(v=>!args.only||v.id===args.only);
if(!cases.length)throw Error("No matching cases");
const bases={reference:{production:defaults.inherited,chapter:args.reference,inherited:args["reference-inherited"],sheet:args.sheet},
  candidate:{production:defaults.inherited,chapter:args.candidate,inherited:args["candidate-inherited"]||args.candidate,sheet:args["candidate-sheet"]}};
const report={schema:1,release:defaults.release,platform:os.platform(),architecture:os.arch(),mode:args["record-only"]?"record":"compare",
  fixedDailyFeed:"bundled",widths:sizes,engines:{},caseCount:cases.length,results:[],failures:[]};
if(args.audit || args["enforce-audits"])report.budgets=budgets;
const temporary=await mkdtemp(path.join(os.tmpdir(),"atlas-visual-"));
function imageTool(command,...options){
  return execFileSync(process.env.PYTHON || "python3",[path.join(directory,"images.py"),command,...options],{encoding:"utf8",maxBuffer:1024*1024});
}
function pixelResult(reference,candidate,diff,exact=false){
  try{return JSON.parse(imageTool("compare",reference,candidate,"--diff",diff,...(exact?["--exact"]:[])));}
  catch(e){if(e.status!==1 || !e.stdout)throw e;return JSON.parse(e.stdout);}
}
async function capture(page,side,engine,size,entry){
  const base=bases[side][entry.base];if(!base)throw Error("Missing "+side+" base for "+entry.id);
  const url=new URL(entry.path,base.endsWith("/")?base:base+"/").href;
  const response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:90000});
  if(response && !response.ok())throw Error("HTTP "+response.status()+" for "+url);
  await page.waitForLoadState("networkidle", {timeout:90000});
  const rendered=await page.evaluate(settle,entry);
  if(entry.fixture){
    const expected=fixtures.fixtures.find(f=>f.key===entry.fixture);
    const lines=await page.locator("[data-fixture] .lean-line").evaluateAll(rows=>rows.map(row=>[Number(row.dataset.declarationLine),row.querySelector(".line-source").textContent]));
    if(lines.length!==entry.last-entry.first+1 || lines.length!==expected.source.length ||
       lines.some(([number,source],i)=>number!==entry.first+i || source!==expected.source[i])) throw Error("Incorrect Lean text or range for "+entry.fixture);
  }
  const prefix=path.join(out,engine,size.join("x"),side);await mkdir(prefix,{recursive:true});
  const file=path.join(prefix,entry.id+".webp"),png=path.join(temporary,"capture.png");
  await page.screenshot({path:png,fullPage:false,animations:"disabled",caret:"hide",scale:"css",timeout:60000});
  const result={url,...rendered,file:path.relative(out,file),sha256:imageTool("pack",png,file).trim(),bytes:(await stat(file)).size};
  if(entry.fixture){
    const crop=path.join(prefix,entry.id+"-code.webp");
    await page.locator("[data-fixture] .reader-code").screenshot({path:png,animations:"disabled",caret:"hide",scale:"css"});
    result.code={file:path.relative(out,crop),sha256:imageTool("pack",png,crop).trim()};
  }
  return result;
}
try{
  for(const engine of engines){
    let browser;
    try{
      browser=await pw[engine].launch({headless:true});
      report.engines[engine]=browser.version();
      for(const size of sizes){
        const options={viewport:{width:size[0],height:size[1]},deviceScaleFactor:1,locale:"en-US",timezoneId:"UTC",colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block"};
        const context=await browser.newContext(options);
        // The daily route targets a closed day and the captured, bundled archive. Other
        // network requests include the genuine SHA-checked remote note and its Lean data.
        await context.route("https://raw.githubusercontent.com/nasqret/riemann-proof-atlas/atlas-daily/**",route=>route.abort());
        const pages={reference:await context.newPage(),candidate:await context.newPage()};
        for(const entry of cases){
          const result={engine,size,id:entry.id};
          try{
            if(args.goldens){
              const file=path.resolve(args.goldens,engine,size.join("x"),"reference",entry.id+".webp");
              await stat(file);
              result.reference={file:path.relative(out,file),saved:true};
              if(entry.fixture){
                const crop=path.resolve(args.goldens,engine,size.join("x"),"reference",entry.id+"-code.webp");
                await stat(crop);result.reference.code={file:path.relative(out,crop),saved:true};
              }
            } else {
              result.reference=await capture(pages.reference,"reference",engine,size,entry);
            }
            if(!args["record-only"]){
              const sameAddress = result.reference.url === new URL(entry.path,bases.candidate[entry.base]).href;
              const replay = sameAddress && entry.position==="anchor" ? {...entry,replayScroll:result.reference.scroll} : entry;
              result.candidate=await capture(pages.candidate,"candidate",engine,size,replay);
              const differences=path.join(out,engine,size.join("x"),"differences");
              result.pixels=pixelResult(path.resolve(out,result.reference.file),path.resolve(out,result.candidate.file),path.join(differences,entry.id+".webp"));
              if(!result.pixels.passed)report.failures.push({engine,size,id:entry.id,type:"pixels"});
              if(entry.fixture){
                result.codePixels=pixelResult(path.resolve(out,result.reference.code.file),path.resolve(out,result.candidate.code.file),path.join(differences,entry.id+"-code.webp"),true);
                if(!result.codePixels.passed)report.failures.push({engine,size,id:entry.id,type:"pixels",region:"code"});
              }
            }
            if(report.budgets && !entry.fixture){
              result.audit=await audit(browser,engine,options,(result.candidate||result.reference).url,entry);
              if(args["enforce-audits"] && (result.audit.violations.length || result.audit.exceeded.length))
                report.failures.push({engine,size,id:entry.id,type:"audit"});
            }
          }catch(error){result.error=error.message;report.failures.push({engine,size,id:entry.id,type:"capture",message:error.message});}
          report.results.push(result);
          await writeFile(path.join(out,"report.json"),JSON.stringify(report,null,2)+"\n");
        }
        await context.close();
      }
    }catch(error){report.failures.push({engine,type:"engine",message:error.message});}
    finally{await browser?.close();}
  }
}finally{await rm(temporary,{recursive:true,force:true});await writeFile(path.join(out,"report.json"),JSON.stringify(report,null,2)+"\n");}
const failed=report.failures.filter(f=>f.type!=="pixels" || !args["report-diffs"]);
console.log(report.results.length+" rendered comparisons or captures; "+report.failures.length+" recorded differences or errors. "+path.join(out,"report.json"));
if(failed.length)process.exitCode=1;
