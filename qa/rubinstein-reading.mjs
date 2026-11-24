/** Exercise a Pages installation in a clean browser. The optional local PDF stays on the test machine. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const { positionals, values: options } = parseArgs({
  allowPositionals: true,
  options: { pdf: { type: 'string' }, receipt: { type: 'string' } },
});
const [address, engine = 'chromium'] = positionals;
if (!address || positionals.length > 2 || !['chromium', 'firefox', 'webkit'].includes(engine)) {
  throw Error('Usage: node check_public.mjs BASE [chromium|firefox|webkit] [--receipt FILE] [--pdf WATERLOO_V2_PDF]');
}
const base = new URL(address.endsWith('/') ? address : address + '/');
const require = createRequire(import.meta.url);
const runner = require(process.env.ATLAS_PLAYWRIGHT || 'playwright')[engine];
const browser = await runner.launch({
  headless: true,
  ...(engine === 'chromium' ? { executablePath: runner.executablePath() } : {}),
});
const destinations = {
  explorer: 'index.html', rubinstein: 'rubinstein.html', statement: 'index.html#statement',
  chapters: 'index.html#chapter', proofs: 'companion/index.html', history: 'daily.html',
  editions: 'editions.html', method: 'notes.html',
};
const groupFor = { statement: 'proof', chapters: 'proof', proofs: 'proof', history: 'atlas', editions: 'atlas', method: 'atlas' };
const originalPDF = 'https://www.math.uwaterloo.ca/~mrubinst/alpoge_claude_grh/zeta-paper_v2.pdf';
const absolute = (path) => new URL(path, base).href;
const nav = (page) => page.getByRole('navigation', { name: 'Atlas navigation', exact: true });
const link = (page, key) => nav(page).locator(`a[data-destination="${key}"]`);
const group = (page, key) => nav(page).locator(`details[data-group="${key}"]`);

async function checkShell(page, active) {
  const bar = nav(page);
  await bar.waitFor();
  await bar.locator(`a[data-destination="${active}"][aria-current="page"]`).waitFor({ state: 'attached' });
  assert.equal(await bar.locator('a[aria-current="page"]').count(), 1, 'One current destination');
  const links = await bar.locator('a[data-destination]').evaluateAll((elements) =>
    Object.fromEntries(elements.map((a) => [a.dataset.destination, a.href])));
  assert.deepEqual(links, Object.fromEntries(Object.entries(destinations).map(([key, path]) => [key, absolute(path)])));
  assert.equal(await link(page, 'rubinstein').isVisible(), true, 'A direct guide link is visible');
  assert.equal(await link(page, 'explorer').isVisible(), true, 'A direct Explorer link is visible');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Horizontal overflow');
  for (const name of ['proof', 'atlas']) {
    assert.equal(await group(page, name).locator('summary').isVisible(), true);
    assert.equal(await group(page, name).evaluate((e) => e.hasAttribute('data-current')), groupFor[active] === name);
  }
}

async function keyboardMenus(page) {
  for (const [name, first] of [['proof', 'statement'], ['atlas', 'history']]) {
    const details = group(page, name);
    const summary = details.locator('summary');
    await summary.focus();
    await summary.press('Enter');
    await link(page, first).waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await link(page, first).evaluate((e) => e === document.activeElement), true, `Tab enters ${name}`);
    await page.keyboard.press('Escape');
    assert.equal(await details.evaluate((e) => e.open), false, `Escape closes ${name}`);
    assert.equal(await summary.evaluate((e) => e === document.activeElement), true, `Escape restores focus in ${name}`);
  }
}

async function chooseNav(page, key) {
  if (groupFor[key]) await group(page, groupFor[key]).locator('summary').click();
  await link(page, key).click();
}

async function checkRetainedDestinations(page) {
  for (const [key, ready] of [
    ['statement', '[data-reader-view="statement"]'], ['chapters', '[data-reader-view="chapters"]'],
    ['proofs', '#viewer'], ['history', '#contents h2'], ['editions', 'body[data-ready="true"]'],
    ['method', 'section#method'],
  ]) {
    await chooseNav(page, key);
    await page.locator(ready).first().waitFor({ state: 'attached' });
    await checkShell(page, key);
  }
  await page.goto(absolute('index.html#chapter=1.5992'), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-reader-view="chapter"]').waitFor({ state: 'attached' });
  await checkShell(page, 'chapters');
}

async function atPage(page, number, citation = '') {
  await page.waitForFunction(({ number, citation }) =>
    document.querySelector('#pageNo')?.value === String(number) &&
    document.querySelector('#citations')?.value === citation,
    { number, citation });
  assert.equal(await page.locator('#original').getAttribute('href'), `${originalPDF}#page=${number}`);
}

async function turnPage(page, number) {
  const input = page.locator('#pageNo');
  await input.fill(String(number));
  await input.press('Enter');
}

async function runReader(page, data, placements, width) {
  const mobile = width < 800;
  const next = page.locator(mobile ? '#mobileNext' : '#next');
  await atPage(page, 61, 'QH.thinH');
  await page.locator('body[data-map-ready="true"][data-context-ready="true"]').waitFor({ state: 'attached' });
  await checkShell(page, 'rubinstein');
  const pane = await page.locator('#paper-pane').boundingBox();
  const map = await page.locator('#map-pane').boundingBox();
  assert.ok(mobile ? pane.y >= map.y + map.height - 1 : pane.x >= map.x + map.width - 1, 'Readable two-pane layout');
  await page.locator('#remoteCitations .paper-citation').first().waitFor();
  assert.equal(await page.locator('#sheet').isVisible(), false, 'A fresh visitor has no local copy');
  const mode = await page.locator('#remotePdf').isVisible() ? 'Waterloo frame' : 'external PDF link';
  if (mode === 'Waterloo frame') {
    assert.equal(await page.locator('#remotePdf').getAttribute('src'), `${originalPDF}#page=61`);
  } else {
    await page.locator('#remoteFallback').waitFor();
    assert.equal(await page.locator('#remoteFallback a').first().getAttribute('href'), `${originalPDF}#page=61`);
  }
  await next.click();
  await atPage(page, 61, 'meanSqK');
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await atPage(page, 61, 'QH.thinH');
  await page.goForward({ waitUntil: 'domcontentloaded' });
  await atPage(page, 61, 'meanSqK');
  await page.locator('#citations').selectOption('hostThickExists');
  await atPage(page, 61, 'hostThickExists');
  const cite = data.declarations.hostThickExists;
  assert.equal(await page.locator('#leanSource').getAttribute('href'),
    `${data.sourceBase}${cite.file}#L${cite.lines[0]}-L${cite.lines[1]}`);
  assert.equal(await page.locator('#explore').evaluate((a) => a.href), absolute(`index.html#theorem=${cite.atlas}`));
  const scale = await page.locator('#scale').innerText();
  await page.locator('#zoomIn').click();
  await page.waitForFunction((old) => document.querySelector('#scale').textContent !== old, scale);
  await page.locator('#fit').click();
  await page.waitForFunction((fit) => document.querySelector('#scale').textContent === fit, scale);

  await turnPage(page, 1);
  await atPage(page, 1);
  assert.equal(await page.locator('#leanSource').isVisible(), false);
  assert.equal(await page.locator('#citations').isDisabled(), true);
  if (mode === 'Waterloo frame') assert.equal(await page.locator('#remotePdf').getAttribute('src'), `${originalPDF}#page=1`);
  await next.click();
  await atPage(page, 61, 'QH.thinH');
  await turnPage(page, 77);
  await page.locator('#citations').selectOption('originRow');
  await atPage(page, 77, 'originRow');
  assert.equal(await page.locator('#placementEvidence').isVisible(), true);
  assert.equal(await page.locator('#focus').isVisible(), true);
  const { anchor, row } = placements.declarations.originRow;
  assert.equal(await page.locator('#anchorLink').evaluate((a) => a.href), absolute(`index.html#theorem=${anchor}`));
  assert.equal(await page.locator('#explore').evaluate((a) => a.href), absolute(`index.html#context=${row}`));
  await page.locator('#dependencies').check();
  await page.locator('#neighborList summary').click();
  assert.ok(await page.locator('#neighborLinks a').count() > 0);
  const originSource = await page.locator('#leanSource').getAttribute('href');
  await page.locator('#explore').click();
  await page.waitForURL((url) => url.hash === `#context=${row}`);
  const record = page.locator('#content');
  const source = record.getByRole('link', { name: 'Open Lean source', exact: true });
  await source.waitFor({ state: 'attached' });
  assert.equal(await source.getAttribute('href'), originSource);
  const openAnchor = record.getByRole('link', { name: 'Open map anchor', exact: true });
  assert.equal(new URL(await openAnchor.getAttribute('href'), page.url()).hash, `#theorem=${anchor}`);
  await openAnchor.click();
  await page.waitForURL((url) => url.hash === `#theorem=${anchor}`);
  await page.locator('#content a').filter({ hasText: 'Open Lean source' }).first().waitFor({ state: 'attached' });
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForURL((url) => url.hash === `#context=${row}`);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await atPage(page, 77, 'originRow');

  await page.goto(absolute('rubinstein.html#page=220&cite=slopesN_at_of&occ=2'), { waitUntil: 'domcontentloaded' });
  await atPage(page, 220, 'slopesN_at_of');
  const sameName = page.locator('#remoteCitations .paper-citation').filter({ hasText: 'slopesN_at_of' });
  assert.equal(await sameName.count(), 2);
  await sameName.first().click();
  await page.waitForURL((url) => new URLSearchParams(url.hash.slice(1)).get('occ') === null);
  await sameName.nth(1).click();
  await page.waitForURL((url) => new URLSearchParams(url.hash.slice(1)).get('occ') === '2');
  if (options.pdf) {
    await page.locator('#file').setInputFiles(options.pdf);
    await page.locator('#pdfText[data-page="220"]').waitFor({ state: 'attached' });
    const marks = page.locator('#marks button[data-citation="slopesN_at_of"]');
    assert.equal(await marks.count(), 2);
    assert.equal(await marks.nth(1).getAttribute('aria-pressed'), 'true');
    await page.locator('#marks button[data-citation="claimHigh_valid"]').first().click();
    await atPage(page, 220, 'claimHigh_valid');
  }
  assert.equal(await page.locator('#error').innerText(), '');
  return { mode, localHighlights: Boolean(options.pdf) };
}

async function run(width, height, data, placements) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === base.origin && response.status() >= 400 &&
        ['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(response.request().resourceType()) &&
        !(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && url.pathname === new URL('rubinstein-local.pdf', base).pathname)) {
      failures.push(`${response.status()} ${url.pathname}`);
    }
  });
  try {
    await page.goto(base.href, { waitUntil: 'domcontentloaded' });
    await page.locator('body[data-ready="true"]').waitFor({ state: 'attached' });
    await checkShell(page, 'explorer');
    await keyboardMenus(page);
    await chooseNav(page, 'rubinstein');
    const reader = await runReader(page, data, placements, width);
    await checkRetainedDestinations(page);
    assert.deepEqual(failures, []);
    return { width, height, destinations: Object.keys(destinations).length, ...reader };
  } catch (error) {
    throw Error(`${engine} ${width} ${page.url()} | ${error.message} | ${failures.join(', ')}`, { cause: error });
  } finally {
    await ctx.close();
  }
}

async function withoutPDFViewer() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await context.addInitScript(() => Object.defineProperty(navigator, 'pdfViewerEnabled', { get: () => false }));
    const page = await context.newPage();
    await page.goto(absolute('rubinstein.html#page=77&cite=originRow'), { waitUntil: 'domcontentloaded' });
    await atPage(page, 77, 'originRow');
    const outside = page.locator('#remoteFallback a');
    await outside.waitFor();
    assert.equal(await outside.getAttribute('href'), `${originalPDF}#page=77`);
    assert.equal(await page.locator('#remotePdf').isVisible(), false);
    await turnPage(page, 1);
    await atPage(page, 1);
    assert.equal(await outside.getAttribute('href'), `${originalPDF}#page=1`);
    return true;
  } finally {
    await context.close();
  }
}

try {
  const requests = await browser.newContext();
  const json = async (path) => {
    const response = await requests.request.get(absolute(path));
    assert.equal(response.status(), 200, path);
    return response.json();
  };
  const [data, placements] = await Promise.all([json('rubinstein/path.json'), json('data/context/paper.json')]);
  assert.equal(data.sourcePin, placements.sourcePin);
  assert.equal(data.paper.url, originalPDF);
  const upstream = await requests.request.get(originalPDF, { headers: { Range: 'bytes=0-31' }, timeout: 45000 });
  assert.ok(upstream.ok(), `Waterloo PDF HTTP ${upstream.status()}`);
  assert.match(upstream.headers()['content-type'], /application\/pdf/i);
  assert.equal((await upstream.body()).subarray(0, 5).toString(), '%PDF-');
  const proxyIds = Object.keys(data.declarations).filter((id) => !data.declarations[id].point);
  assert.deepEqual(Object.keys(placements.declarations).sort(), proxyIds.sort());
  await requests.close();
  const viewports = [];
  for (const [width, height] of [[1440, 960], [390, 844]]) viewports.push(await run(width, height, data, placements));
  const fallback = await withoutPDFViewer();
  const result = { base: base.href, engine, version: browser.version(), viewports, sourcePin: data.sourcePin,
    upstreamStatus: upstream.status(), withoutPDFViewer: fallback,
    pages: data.pages.length, stops: data.pages.flat().length, declarations: Object.keys(data.declarations).length, contextual: proxyIds.length };
  if (options.receipt) await writeFile(options.receipt, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
