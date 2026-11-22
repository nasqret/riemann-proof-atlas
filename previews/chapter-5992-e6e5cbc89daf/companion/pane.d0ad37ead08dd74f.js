// Build the additional fields from the same proof shard used by the chapter selector.
function field(doc, key, label) {
  const row = doc.createElement("span");
  row.className = "proof-field";
  row.dataset.field = key;
  const heading = doc.createElement("strong");
  heading.textContent = label;
  row.append(heading);
  return row;
}

export function proofFields(doc, step, steps) {
  const rows = [];
  const numbers = new Map(steps.map(s => [s.id, s.number]));
  const names = [...step.uses.map(use => use.name), ...step.refs.map(id => numbers.get(id))];
  if (names.length) {
    const uses = field(doc, "uses", "Uses");
    names.forEach((name, i) => {
      const nameNode = doc.createElement("code");
      name.split(".").forEach((part, j) => {
        if (j) nameNode.append(".", doc.createElement("wbr"));
        nameNode.append(part);
      });
      if (i) uses.append(", ");
      uses.append(nameNode);
    });
    rows.push(uses);
  }
  if (step.typedFact) {
    const fact = field(doc, "fact", "Exact Lean fact");
    const code = doc.createElement("code");
    code.textContent = step.typedFact;
    fact.append(code);
    rows.push(fact);
  }
  const reader = field(doc, "reader", "Second reading");
  reader.append(step.secondRead ? "Compared with the source by a second reader." : "This step awaits a second reading.");
  rows.push(reader);
  return rows;
}

export function observeProofPane(frame) {
  let doc, observer, selection, lastChoice;
  function update() {
    if (!doc) return;
    const list = doc.getElementById("item-choices");
    const selected = list.querySelector("[aria-pressed=true]");
    if (selected && selected !== lastChoice) {
      const box = selected.getBoundingClientRect(), viewport = list.getBoundingClientRect();
      if (box.bottom > viewport.bottom) list.scrollTop += box.bottom - viewport.bottom;
      if (box.top < viewport.top) list.scrollTop += box.top - viewport.top;
      lastChoice = selected;
    }
    if (!selection || selection.key !== selected?.dataset.itemId) return;
    const note = doc.getElementById("coverage-note");
    if (note.firstElementChild?.dataset.forStep === selection.key) return;
    const rows = proofFields(doc, selection.step, selection.steps);
    rows[0].dataset.forStep = selection.key;
    note.replaceChildren(...rows);
  }
  function attach() {
    observer?.disconnect();
    doc = frame.contentDocument;
    lastChoice = null;
    if (!doc?.getElementById("coverage-note")) { doc = null; return; }
    // The parent and vendor themes use some of the same words for different colors.
    // The reader iframe shares the atlas font scale and pane geometry.
    const host = getComputedStyle(frame.ownerDocument.documentElement);
    for (const name of ["--text-sm", "--space-2", "--space-3", "--radius-md", "--pane-choice-min", "--pane-list-max"]) {
      doc.documentElement.style.setProperty(name, host.getPropertyValue(name));
    }
    for (const path of [new URL("../fonts.606fe45d6671852a.css", import.meta.url), new URL("./pane.3343db107ba1a8da.css", import.meta.url)]) {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = path.href;
      link.addEventListener("load", () => { lastChoice = null; update(); }, {once:true});
      doc.head.append(link);
    }
    observer = new MutationObserver(update);
    observer.observe(doc.getElementById("coverage-note"), {childList:true});
    observer.observe(doc.getElementById("item-choices"), {
      childList:true, subtree:true, attributes:true, attributeFilter:["aria-pressed"],
    });
    update();
  }
  frame.addEventListener("load", attach);
  if (frame.contentDocument?.getElementById("coverage-note")) attach();
  return (proof, step, steps) => {
    selection = step ? {key:proof + "#" + step.id, step, steps} : null;
    update();
  };
}
