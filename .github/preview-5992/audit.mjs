import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { settle } from "./settle.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
export const profile = {latency: 80, downloadThroughput: 1_000_000, uploadThroughput: 350_000, cpuSlowdown: 4};
export const budgets = {largestPaintMs: 2500, layoutShift: 0.02, tabToNextPaintMs: 100, scriptGzipBytes: 150000};

function observeVitals() {
  const values = window.atlasVisualMeasurements = {};
  const types = PerformanceObserver.supportedEntryTypes;
  if (types.includes("largest-contentful-paint")) {
    new PerformanceObserver(list => {
      values.largestPaintMs = list.getEntries().at(-1).startTime;
    }).observe({type: "largest-contentful-paint", buffered: true});
  }
  if (types.includes("layout-shift")) {
    values.layoutShift = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) values.layoutShift += entry.value;
      }
    }).observe({type: "layout-shift", buffered: true});
  }
  document.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      values.tabToNextPaintMs = performance.now() - event.timeStamp;
    }));
  }, {capture: true});
}

export async function audit(browser, engine, options, url, entry) {
  const context = await browser.newContext(options);
  try {
    await context.route("https://raw.githubusercontent.com/nasqret/riemann-proof-atlas/atlas-daily/**", route => route.abort());
    await context.addInitScript(observeVitals);
    const page = await context.newPage();
    if (engine === "chromium") {
      const client = await context.newCDPSession(page);
      await client.send("Network.enable");
      await client.send("Network.emulateNetworkConditions", {offline: false, latency: profile.latency,
        downloadThroughput: profile.downloadThroughput, uploadThroughput: profile.uploadThroughput});
      await client.send("Emulation.setCPUThrottlingRate", {rate: profile.cpuSlowdown});
    }
    const scripts = new Map();
    page.on("response", response => {
      if (response.ok() && response.request().resourceType() === "script") scripts.set(response.url(), response);
    });
    await page.goto(url, {waitUntil: "domcontentloaded", timeout: 150000});
    await page.waitForLoadState("networkidle", {timeout: 150000});
    await page.evaluate(settle, entry);
    // A verified companion may give its PDF iframe the initial focus.
    // Start the timed keyboard action in the top document that owns this observation.
    const start=page.locator(".site-skip, .skip-reader, a[href], button:enabled").first();
    await start.focus();
    await start.press("Tab");
    await page.waitForFunction(() => Number.isFinite(window.atlasVisualMeasurements.tabToNextPaintMs));
    const values = await page.evaluate(() => window.atlasVisualMeasurements);
    values.scriptGzipBytes = 0;
    for (const response of scripts.values()) values.scriptGzipBytes += gzipSync(await response.body(), {level: 9}).length;
    for (const frame of page.frames()) {
      // Playwright's browser-side evaluation avoids adding an inline script element
      // to the PDF reader. Collect the timing observations before running axe.
      await frame.evaluate(axeSource);
      if (!await frame.evaluate(() => typeof window.axe?.run === "function")) throw Error("Accessibility instrumentation unavailable in "+frame.url());
    }
    const violations = await page.evaluate(async tags => {
      const result = await window.axe.run(document, {runOnly: {type: "tag", values: tags}});
      return result.violations.map(v => ({id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map(n => n.target)}));
    }, tags);
    const exceeded = engine === "chromium"
      ? Object.keys(budgets).filter(k => !Number.isFinite(values[k]) || values[k] >= budgets[k]) : [];
    return {profile: engine === "chromium" ? profile : "native; no CDP throttling", values, violations, exceeded};
  } finally {
    await context.close();
  }
}
