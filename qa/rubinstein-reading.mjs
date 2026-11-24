/** Exercise a Pages installation in a clean browser. The optional local PDF stays on the test machine. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const authorRevision = '278761172565a762b1e5642003b3b97547f71a57';
const pdfDigest = 'b49de5037af55c6df66843db710332a358c4eb1d2799581c673cd2ea17e8ea40';
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
    // A delayed reader update can announce its current URL while a menu is in use.
    await page.evaluate(() => window.dispatchEvent(new Event('atlas-address-change')));
    assert.equal(await details.evaluate((e) => e.open), true, 'An update within the same section preserves the open menu');
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
    ['proofs', '#viewer'], ['history', 'body[data-ready="official"]'], ['editions', 'body[data-ready="true"]'],
    ['method', 'section#method'],
  ]) {
    await chooseNav(page, key);
    await page.locator(ready).first().waitFor({ state: 'attached' });
    if (key === 'history') {
      // The history page renders its bundled index first, then the daily remote feed.
      // Finish the refresh before leaving this page and cancelling its ledger fetch.
      await page.waitForLoadState('networkidle');
      await page.locator('body[data-ready="official"] #contents h2').first().waitFor();
      assert.equal(await page.locator('#contents [role="alert"]').count(), 0);
    }
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

async function renderedPDF(page, number, source = 'author') {
  await page.waitForFunction(({ number, source }) => {
    const sheet = document.querySelector('#sheet');
    const text = document.querySelector('#pdfText');
    return document.querySelector('#paperScroll')?.dataset.source === source && sheet && !sheet.hidden &&
      sheet.dataset.page === String(number) && text?.dataset.page === String(number) &&
      text.textContent.trim().length > 0 && document.querySelector('#pdfCanvas')?.width > 200;
  }, { number, source }, { timeout: 45000 });
  assert.equal(await page.locator('#pdfZoom').isEnabled(), true);
  assert.equal(await page.locator('#remotePdf').isVisible(), false);
}

// Compare overlay geometry with the selectable text that PDF.js obtained from the document.
// The text layer may split one Lean name across several spans.
async function checkPrintedName(page, id, occurrences) {
  const marks = page.locator(`#marks button[data-citation="${id}"]`);
  assert.equal(await marks.count(), occurrences, `Printed occurrences of ${id}`);
  const aligned = await marks.evaluateAll((buttons, id) => {
    const walker = document.createTreeWalker(document.querySelector('#pdfText'), NodeFilter.SHOW_TEXT);
    let text = '';
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      nodes.push({ node, start: text.length, end: text.length + node.length });
      text += node.textContent;
    }
    const printed = [];
    for (let i = text.indexOf(id); i >= 0; i = text.indexOf(id, i + id.length)) {
      const first = nodes.find((n) => n.start <= i && i < n.end);
      const last = nodes.find((n) => n.start < i + id.length && i + id.length <= n.end);
      const range = document.createRange();
      range.setStart(first.node, i - first.start);
      range.setEnd(last.node, i + id.length - last.start);
      printed.push([...range.getClientRects()]);
    }
    const assigned = new Set();
    return buttons.every((button) => {
      const a = button.getBoundingClientRect();
      const match = printed.findIndex((rects, index) => !assigned.has(index) && rects.some((b) => {
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return w > 0 && h > 0 && w * h > 0.38 * Math.min(a.width * a.height, b.width * b.height);
      }));
      assigned.add(match);
      return match >= 0;
    });
  }, id);
  assert.ok(aligned, `Each ${id} hotspot overlaps its own printed occurrence`);
  return marks;
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
  await renderedPDF(page, 61);
  assert.equal(await page.locator('#marks button').count(), data.pages[60].reduce((n, s) => n + s.boxes.length, 0));
  await checkPrintedName(page, 'QH.thinH', 1);
  await next.click();
  await atPage(page, 61, 'meanSqK');
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await atPage(page, 61, 'QH.thinH');
  await page.goForward({ waitUntil: 'domcontentloaded' });
  await atPage(page, 61, 'meanSqK');
  const host = await checkPrintedName(page, 'hostThickExists', 1);
  await host.click();
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
  await renderedPDF(page, 1);
  assert.equal(await page.locator('#marks button').count(), 0, 'The title page has no citation hotspots');
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
  await renderedPDF(page, 220);
  const sameName = await checkPrintedName(page, 'slopesN_at_of', 2);
  assert.equal(await sameName.nth(1).getAttribute('aria-pressed'), 'true');
  await sameName.first().click();
  await page.waitForURL((url) => new URLSearchParams(url.hash.slice(1)).get('occ') === null);
  assert.equal(await sameName.first().getAttribute('aria-pressed'), 'true');
  await sameName.nth(1).click();
  await page.waitForURL((url) => new URLSearchParams(url.hash.slice(1)).get('occ') === '2');
  assert.equal(await sameName.nth(1).getAttribute('aria-pressed'), 'true');
  const widthBefore = await page.locator('#sheet').evaluate((s) => s.clientWidth);
  await page.locator('#pdfZoom').selectOption('2');
  await page.waitForFunction((width) => document.querySelector('#sheet').clientWidth > 1.15 * width, widthBefore);
  await renderedPDF(page, 220);
  await checkPrintedName(page, 'slopesN_at_of', 2);
  const distinct = await checkPrintedName(page, 'claimHigh_valid', 2);
  await distinct.first().click();
  await atPage(page, 220, 'claimHigh_valid');
  assert.equal(await page.locator('#citationTitle').innerText(), 'claimHigh_valid');
  assert.equal(await page.locator('#error').innerText(), '');
  return { onlineHighlights: true, repeatedOccurrences: 2, zoomedPDF: true, uncitedTitlePage: true };
}

async function run(width, height, data, placements) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const failures = [];
  const authorResponses = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.href === data.paper.readerUrl) authorResponses.push(response.status());
    if (url.origin === base.origin && response.status() >= 400 &&
        ['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(response.request().resourceType())) {
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
    assert.ok(authorResponses.some((code) => code >= 200 && code < 300), 'Fresh visit fetched the pinned PDF from its author');
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
    await renderedPDF(page, 77);
    const other = page.locator('#marks button[data-citation="blockBound_of_fockJet"]').first();
    await other.click();
    await atPage(page, 77, 'blockBound_of_fockJet');
    return true;
  } finally {
    await context.close();
  }
}

async function failedAuthorPDF(data, fault) {
  const context = await browser.newContext({ viewport: { width: 900, height: 850 } });
  try {
    if (fault === 'blocked') {
      await context.addInitScript(() => Object.defineProperty(navigator, 'pdfViewerEnabled', { get: () => false }));
    }
    let attempts = 0;
    await context.route(data.paper.readerUrl, async (route) => {
      attempts++;
      if (fault === 'blocked') return route.abort('failed');
      const upstream = await route.fetch();
      assert.ok(upstream.ok(), 'Fetch the genuine PDF for the digest test');
      const edition = await upstream.body();
      assert.equal(createHash('sha256').update(edition).digest('hex'), pdfDigest);
      // A trailing PDF comment leaves every page and hotspot intact. Only the SHA changes.
      const changed = Buffer.concat([edition, Buffer.from('\n% Local browser test edition\n')]);
      await route.fulfill({ status: 200, body: changed, headers: {
        'content-type': 'application/pdf', 'access-control-allow-origin': '*', 'cache-control': 'no-store',
      } });
    });
    const page = await context.newPage();
    await page.goto(absolute('rubinstein.html#page=220&cite=slopesN_at_of&occ=2'), { waitUntil: 'domcontentloaded' });
    await atPage(page, 220, 'slopesN_at_of');
    const retry = page.locator('#retryHighlights');
    await retry.waitFor({ timeout: 45000 });
    assert.ok(attempts > 0, `Injected ${fault} response reached the browser`);
    if (fault === 'changed PDF') assert.match(await page.locator('#pdfError').innerText(), /different edition/i);
    assert.equal(await page.locator('#sheet').isVisible(), false, 'Unverified bytes have no interactive page');
    const fallback = (await page.locator('#paperScroll').getAttribute('data-source'));
    assert.ok(['waterloo', 'page-link'].includes(fallback), `Visible fallback after ${fault}`);
    if (fallback === 'page-link') {
      const outside = page.locator('#remoteFallback a');
      await outside.waitFor();
      assert.equal(await outside.getAttribute('href'), `${originalPDF}#page=220`);
    } else {
      assert.equal(await page.locator('#remotePdf').getAttribute('src'), `${originalPDF}#page=220`);
    }
    const mentions = page.locator('#remoteCitations .paper-citation[data-citation="slopesN_at_of"]');
    assert.equal(await mentions.count(), 2);
    await mentions.first().click();
    await page.waitForURL((url) => !new URLSearchParams(url.hash.slice(1)).has('occ'));
    await page.locator('#remoteCitations [data-citation="claimHigh_valid"]').first().click();
    await atPage(page, 220, 'claimHigh_valid');
    let rescuedWithFile = false;
    if (fault === 'blocked' && options.pdf) {
      await page.locator('#file').setInputFiles(options.pdf);
      await renderedPDF(page, 220, 'local');
      const marks = await checkPrintedName(page, 'slopesN_at_of', 2);
      await marks.nth(1).click();
      await atPage(page, 220, 'slopesN_at_of');
      assert.equal(await marks.nth(1).getAttribute('aria-pressed'), 'true');
      rescuedWithFile = true;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await retry.waitFor();
    }
    await context.unroute(data.paper.readerUrl);
    const actualResponse = page.waitForResponse((response) => response.url() === data.paper.readerUrl && response.ok());
    await retry.click();
    await actualResponse;
    await renderedPDF(page, 220);
    await checkPrintedName(page, 'slopesN_at_of', 2);
    return { fault, fallback, rescuedWithFile, retriedFromAuthor: true };
  } finally {
    await context.close();
  }
}

async function menuDuringStartup() {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  let release;
  const resumeMenu = new Promise(resolve => { release = resolve; });
  try {
    const page = await context.newPage();
    await page.route('**/navigation/menus.*.js', async route => {
      await resumeMenu;
      await route.continue();
    });
    await page.goto(absolute('companion/index.html'), { waitUntil: 'commit' });
    const atlas = group(page, 'atlas');
    await atlas.locator('summary').click();
    await link(page, 'history').waitFor();
    release();
    await page.waitForLoadState('domcontentloaded');
    assert.equal(await atlas.evaluate(e => e.open), true, 'Loading the shared navigation preserves a native open menu');
    await link(page, 'history').click();
    assert.equal(new URL(page.url()).pathname, new URL('daily.html', base).pathname);
    return true;
  } finally {
    release();
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
  const authorUrl = new URL(data.paper.readerUrl);
  assert.equal(authorUrl.origin, 'https://raw.githubusercontent.com');
  assert.ok(authorUrl.pathname.startsWith(`/mrubinst/alpoge-claude-rh-explained/${authorRevision}/`));
  assert.equal(data.paper.sha256, pdfDigest);
  const upstream = await requests.request.get(originalPDF, { headers: { Range: 'bytes=0-31' }, timeout: 45000 });
  assert.ok(upstream.ok(), `Waterloo PDF HTTP ${upstream.status()}`);
  assert.match(upstream.headers()['content-type'], /application\/pdf/i);
  assert.equal((await upstream.body()).subarray(0, 5).toString(), '%PDF-');
  const proxyIds = Object.keys(data.declarations).filter((id) => !data.declarations[id].point);
  assert.deepEqual(Object.keys(placements.declarations).sort(), proxyIds.sort());
  await requests.close();
  const viewports = [];
  for (const [width, height] of [[1440, 960], [390, 844]]) viewports.push(await run(width, height, data, placements));
  const noNativeViewer = await withoutPDFViewer();
  const failureRecovery = [];
  for (const fault of ['blocked', 'changed PDF']) failureRecovery.push(await failedAuthorPDF(data, fault));
  const earlyMenu = await menuDuringStartup();
  const result = { base: base.href, engine, version: browser.version(), viewports, sourcePin: data.sourcePin,
    upstreamStatus: upstream.status(), authorPDF: data.paper.readerUrl, sha256: pdfDigest,
    withoutPDFViewer: noNativeViewer, failureRecovery, menuDuringStartup: earlyMenu,
    pages: data.pages.length, stops: data.pages.flat().length, declarations: Object.keys(data.declarations).length, contextual: proxyIds.length };
  if (options.receipt) await writeFile(options.receipt, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
