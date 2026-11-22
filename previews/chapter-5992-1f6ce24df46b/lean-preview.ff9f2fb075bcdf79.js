// Static source slices keep their original indentation, Unicode and line numbers.
export function signatureStart(record) {
  const text = record.signature;
  let i = /^(?:theorem|lemma)\b/u.exec(text)?.[0].length || 0;
  // The atlas records the position of the name, which can follow the keyword
  // on a later line. Lean permits nested comments between those two tokens.
  let depth = 0;
  while (i < text.length) {
    if (text.startsWith("/-", i)) { depth++; i += 2; }
    else if (depth && text.startsWith("-/", i)) { depth--; i += 2; }
    else if (depth || /\s/u.test(text[i])) i++;
    else if (text.startsWith("--", i)) {
      const newline = text.indexOf("\n", i + 2);
      i = newline < 0 ? text.length : newline;
    } else break;
  }
  return record.line - (text.slice(0, i).split("\n").length - 1);
}
function make(tag, cls, text) {
  const value = document.createElement(tag);
  value.className = cls;
  if (text !== undefined) value.textContent = text;
  return value;
}
export function leanControls(source, getText, toggleWrap, copyLabel) {
  const doc = source.ownerDocument;
  const controls = doc.createElement("div");
  controls.className = "preview-controls lean-actions";
  const button = (label, action) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "preview-action";
    b.textContent = label;
    b.addEventListener("click", action);
    controls.append(b);
    return b;
  };
  const status = doc.createElement("span");
  status.className = "preview-status";
  status.setAttribute("role", "status");
  button(copyLabel, async () => {
    const text = getText();
    try {
      await doc.defaultView.navigator.clipboard.writeText(text);
      status.textContent = "Copied.";
    } catch {
      let field = controls.querySelector("textarea");
      if (!field) {
        field = doc.createElement("textarea");
        field.readOnly = true;
        field.setAttribute("aria-label", "Lean source to copy");
        controls.append(field);
      }
      field.value = text;
      field.focus();
      field.select();
      status.textContent = "Source selected. Use your browser’s Copy command.";
    }
  });
  const wrap = button("Wrap lines", () => wrap.setAttribute("aria-pressed", String(toggleWrap())));
  wrap.setAttribute("aria-pressed", "false");
  controls.append(status);
  return controls;
}
export function leanPreview({ name, label, lines, first, marked, complete = false, copyLabel = "Copy lines" }) {
  const wrapper = make("section", "lean-preview");
  const last = first + lines.length - 1;
  const bounds = first === last ? "line " + first : "lines " + first + "–" + last + " · " + lines.length + " lines";
  const caption = make("div", "preview-caption", label + " · " + bounds);
  const pre = make("pre", "reader-code"), body = make("code", "lean-lines");
  pre.tabIndex = 0;
  pre.setAttribute("role", "region");
  pre.setAttribute("aria-label", label + " of " + name + ", " + bounds);
  body.style.setProperty("--gutter-width", Math.max(2, String(last).length) + 1 + "ch");
  for (const [i, text] of lines.entries()) {
    const n = first + i;
    const line = make("span", "lean-line");
    line.dataset[complete ? "declarationLine" : "sourceLine"] = n;
    if (marked && n >= marked[0] && n <= marked[1]) line.dataset.marked = "true";
    const gutter = make("span", "line-number", n);
    gutter.setAttribute("aria-hidden", "true");
    const source = make("span", "line-source", text);
    source.style.setProperty("--continuation-indent", (text.match(/^\s*/u)[0].replaceAll("\t", "    ").length + 2) + "ch");
    line.append(gutter, source);
    body.append(line);
  }
  pre.append(body);
  const controls = leanControls(pre, () => lines.join("\n"), () => wrapper.classList.toggle("soft-wrap"), copyLabel);
  wrapper.append(caption, pre, controls);
  return wrapper;
}
