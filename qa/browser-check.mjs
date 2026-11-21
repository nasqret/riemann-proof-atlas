/** Black-box checks against the running atlas. Import this file in a browser
 * running the local reading server and call checkAtlas() after the page loads.
 * Each test drives documented controls and inspects the rendered result.
 */
const sel = (s) => document.querySelector(s);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (ok, msg) => {
  if (!ok) throw Error(msg);
};
async function wait(test, msg, ms = 35000) {
  const start = performance.now();
  while (performance.now() - start < ms) {
    if (test()) return;
    await pause(50);
  }
  throw Error(
    "Timed out: " +
      msg +
      " | " +
      (sel("#content")?.innerText || "").slice(0, 150),
  );
}
const button = (name, container = document) =>
  Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent.trim() === name,
  );
const choose = (id, value) => {
  const e = sel("#" + id);
  e.value = value;
  e.dispatchEvent(new Event("change", { bubbles: true }));
};
const check = (id, value) => {
  const e = sel("#" + id);
  if (e.checked !== value) e.click();
};
const count = () => sel(".stats strong")?.textContent;
const head = () => sel("#content h2")?.textContent;
function query(s) {
  const e = sel("#search");
  e.value = s;
  e.dispatchEvent(new Event("input", { bubbles: true }));
}
function marker(match) {
  const v = sel("#viewport"),
    r = v.getBoundingClientRect(),
    tip = sel("#tip");
  const top = Math.max(0, r.top),
    bottom = Math.min(innerHeight, r.bottom);
  const range = (s, n) =>
    Array.from(
      { length: Math.max(0, Math.floor(n / 6)) },
      (_, i) => Math.floor(s) + i * 6,
    );
  for (const y of range(top + 70, bottom - top - 85)) {
    for (const x of range(r.left + 5, Math.min(r.width, innerWidth) - 10)) {
      if (!v.contains(document.elementFromPoint(x, y))) continue;
      v.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          pointerType: "mouse",
          clientX: x,
          clientY: y,
        }),
      );
      if (!tip.hidden && tip.textContent.includes(match)) return [x, y];
    }
  }
  return null;
}
export async function checkAtlas({ extra = true } = {}) {
  const out = {};
  await wait(() => document.body.dataset.ready === "true", "full site ready");
  sel("#home").click();
  await wait(() => count() === "818,755", "whole project");
  out.whole = sel(".stats").innerText;
  await pause(150);
  window.scrollTo(0, 0);
  out.overviewMapHit = marker("bundle");
  assert(out.overviewMapHit, "The overview has a real clickable Lean mark");
  choose("scope", "1");
  await wait(() => count() === "647,906", "classical closure");
  choose("evidence", "valueMask");
  await wait(() => count() === "647,905", "value-only closure");
  choose("subject", "math.AC");
  await wait(() => count() === "140,147", "RH commutative-algebra count");
  out.rhValue = { all: 647905, commutativeAlgebra: 140147 };
  sel("#home").click();
  button("Explore classical RH").click();
  await wait(
    () =>
      head() === "riemannHypothesis" &&
      sel("#content a.extlink")?.href.endsWith("/src/Main.lean#L4"),
    "Main source link",
  );
  out.source = sel("#content a.extlink").href;
  await wait(
    () =>
      Array.from(sel("#content").querySelectorAll(".listItem")).some(
        (b) => b.querySelector("strong")?.textContent === "rhOfAll",
      ),
    "direct uses",
  );
  Array.from(sel("#content").querySelectorAll(".listItem"))
    .find((b) => b.querySelector("strong")?.textContent === "rhOfAll")
    .click();
  await wait(
    () => head() === "rhOfAll" && button("Trace full graph path"),
    "direct theorem navigation",
  );
  button("Trace full graph path").click();
  await wait(
    () => sel("#dialog[open] .routeList li") !== null,
    "computed shortest path",
  );
  out.witness = Array.from(document.querySelectorAll(".routeList li")).map(
    (n) => n.textContent,
  );
  assert(
    out.witness[0].startsWith("riemannHypothesis") &&
      out.witness.at(-1).startsWith("rhOfAll"),
    "Correct path endpoints",
  );
  sel("#closeDialog").click();
  const bundleTitle = Array.from(sel("#content").querySelectorAll("h3")).find(
    (h) => h.textContent === "Proof bundle",
  );
  bundleTitle.nextElementSibling.click();
  await wait(
    () =>
      Array.from(sel("#content").querySelectorAll("h3")).some(
        (h) => h.textContent === "Member theorems",
      ),
    "bundle detail",
  );
  out.bundle = head();
  const w = Array.from(sel("#content").querySelectorAll("button")).find((b) =>
    b.textContent.startsWith("Inspect witness"),
  );
  assert(w, "Cross-bundle witness button");
  w.click();
  await wait(
    () => sel("#dialog[open] h2")?.textContent === "Direct declaration edge",
    "named edge pair",
  );
  out.bundleWitness = Array.from(
    sel("#dialog").querySelectorAll(".listItem strong"),
  ).map((e) => e.textContent);
  sel("#closeDialog").click();
  sel("#home").click();
  query("e'e'_assoc");
  await wait(
    () =>
      head() === "Theorem search" &&
      sel("#content .listItem strong")?.textContent.includes("e'e'_assoc"),
    "full-text search of quoted identifier",
  );
  sel("#content .listItem").click();
  await wait(
    () =>
      head()?.includes("e'e'_assoc") &&
      sel("#content a.extlink")?.href.includes(
        "ThetaRestrictionDownWittTowerSurjective.lean#L31",
      ),
    "pinned apostrophe source",
  );
  out.apostrophe = sel("#content a.extlink").href;
  sel("#home").click();
  choose("subject", "unresolved");
  await wait(() => count() === "16,393", "unplaced view");
  assert(
    sel("#scene").textContent === "Source-section index",
    "Separate index space",
  );
  out.unplaced = 16393;
  sel("#home").click();
  sel("#method").click();
  assert(
    sel("#dialog[open] h2").textContent === "Reading the map",
    "method modal",
  );
  sel("#closeDialog").click();
  button("Count repeated names").click();
  await wait(
    () => sel("#dialog[open]")?.innerText.includes("648,016"),
    "classical RH distinct-name count",
  );
  const prefixButton = (container, name) =>
    Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent.startsWith(name),
    );
  prefixButton(sel("#dialog"), "Inspect a compared proof").click();
  await wait(
    () => sel("#content")?.innerText.includes("Only this physical proof"),
    "single compatible physical proof",
  );
  const firstSource = sel("#content a.extlink").href;
  const comparedName = head();
  prefixButton(sel("#content"), "Compare the other source occurrence").click();
  await wait(
    () => sel("#content")?.innerText.includes("rules out this physical proof"),
    "excluded physical proof",
  );
  const secondSource = sel("#content a.extlink").href;
  assert(firstSource !== secondSource && head() === comparedName, "two physical proofs of the same name");
  out.sourceCopies = { name: comparedName, compatible: firstSource, excluded: secondSource };
  sel("#home").click();
  if (extra) {
    button("Compiled theorem directory").click();
    await wait(
      () => sel('#content input[type="search"]') !== null,
      "native search form",
    );
    const q = sel('#content input[type="search"]');
    q.value = "riemannHypothesis";
    q.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(
      () =>
        Array.from(sel("#content").querySelectorAll(".listItem")).some(
          (b) => b.textContent === "riemannHypothesis",
        ),
      "native full-name search",
    );
    Array.from(sel("#content").querySelectorAll(".listItem"))
      .find((b) => b.textContent === "riemannHypothesis")
      .click();
    await wait(
      () =>
        head() === "riemannHypothesis" &&
        Array.from(sel("#content").querySelectorAll("a")).some((a) =>
          a.href.includes("/src/Main.lean#L4"),
        ),
      "native source position",
    );
    out.native = true;
    sel("#home").click();
    check("generated", true);
    await wait(
      () => !sel("#generated").disabled,
      "native position load",
      90000,
    );
    await pause(200);
    check("lean", false);
    await pause(160);
    window.scrollTo(0, 0);
    out.nativeMapHit = marker("native theorem");
    assert(out.nativeMapHit, "native map marks drawn");
    check("generated", false);
    check("lean", true);
    sel("#home").click();
  }
  out.horizontalOverflow = document.documentElement.scrollWidth > innerWidth;
  assert(!out.horizontalOverflow, "Viewport overflow");
  assert(sel("#mapMessage").hidden, "Map error surfaced");
  return out;
}
export { marker };
