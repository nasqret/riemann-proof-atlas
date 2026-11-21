/** Black-box checks for the layout, camera reset, and fullscreen inspector. */
export async function checkLayout() {
  const el = (s) => document.querySelector(s);
  const wait = async (test) => {
    const until = performance.now() + 18000;
    while (!test()) {
      if (performance.now() > until) throw Error("Atlas control did not settle");
      await new Promise((r) => setTimeout(r, 55));
    }
  };
  const expect = (condition, message) => { if (!condition) throw Error(message); };
  const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const timer = performance.now();
  await wait(() => document.body.dataset.ready === "true");
  const reset = el("#origin"), full = el("#fullScreen"), inspector = el("#inspectToggle");
  const size = [innerWidth, innerHeight];
  reset.click();
  await paint();
  const scale = el("#scale").textContent;
  function layout() {
    expect(document.documentElement.scrollWidth <= innerWidth + 1, "Horizontal overflow");
    const field = el(".mapbar").getBoundingClientRect();
    const viewport = el("#viewport").getBoundingClientRect();
    const toolbar = el(".maptools").getBoundingClientRect();
    expect(viewport.width > 0 && viewport.height > 0, "The map must keep a visible drawing area");
    expect(field.left >= viewport.left && field.right <= viewport.right + 1, "Filter overflow");
    expect(toolbar.top >= field.bottom - 1 && toolbar.bottom <= viewport.bottom + 1, "Map controls overlap filters");
    expect(full.getBoundingClientRect().width >= 44 && reset.getBoundingClientRect().width >= 44, "Small touch target");
  }
  layout();
  el("#zoomIn").click(); el("#zoomIn").click();
  el("#scope").value = "1"; el("#scope").dispatchEvent(new Event("change"));
  el("#layersBtn").click(); el("#papers").click();
  reset.click();
  await wait(() => el(".stats strong")?.textContent === "818,755" && el("#scale").textContent === scale);
  expect(!location.hash && el("#subject").value === "" && el("#papers").checked &&
    el("#layersPanel").hidden && !el("#generated").checked, "Incomplete zeta reset");
  full.click();
  await wait(() => document.body.classList.contains("immersive") && el("#panel").hidden);
  await paint(); layout();
  inspector.click();
  await wait(() => !el("#panel").hidden);
  await paint(); layout();
  reset.click();
  expect(el("#panel").hidden && full.getAttribute("aria-pressed") === "true", "Immersive home");
  full.click();
  await wait(() => !document.body.classList.contains("immersive") && !el("#panel").hidden);
  reset.click();
  await paint();
  return { viewport: size, initialScale: scale, reset: true, fullscreen: true,
    inspector: true, elapsedMs: Math.round(performance.now() - timer) };
}
