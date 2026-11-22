// The same controls work in native fullscreen and in a viewport-sized reader.
export function mountScreen(button, inspectorButton, panel) {
  const root = document.documentElement;
  const nativeElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  let active = false;
  let native = false;
  let returnScroll = 0;

  function inspector(open) {
    panel.hidden = active && !open;
    document.body.classList.toggle("inspector-open", active && open);
    inspectorButton.setAttribute("aria-expanded", String(active && open));
  }
  function setMode(value) {
    if (value === active) return;
    if (value) returnScroll = window.scrollY;
    active = value;
    document.body.classList.toggle("immersive", value);
    inspectorButton.hidden = !value;
    inspector(false);
    const label = value ? "Exit fullscreen" : "Enter fullscreen";
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(value));
    button.title = label + " (F)";
    if (!value) {
      button.focus({ preventScroll: true });
      window.scrollTo(0, returnScroll);
    }
  }
  async function toggle() {
    if (active) {
      if (nativeElement()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        try { await exit.call(document); } catch { /* The browser may already have exited. */ }
      }
      setMode(false);
      return;
    }
    setMode(true);
    const enter = root.requestFullscreen || root.webkitRequestFullscreen;
    if (enter) {
      try { await enter.call(root); } catch { /* The viewport layout also works in embedded browsers. */ }
    }
  }
  function changed() {
    const now = nativeElement() === root;
    if (native && !now) setMode(false);
    native = now;
  }
  document.addEventListener("fullscreenchange", changed);
  document.addEventListener("webkitfullscreenchange", changed);
  button.onclick = toggle;
  inspectorButton.onclick = () => inspector(panel.hidden);
  return {
    get active() { return active; },
    toggle,
    openInspector() { if (active) inspector(true); },
    home() { returnScroll = 0; if (active) inspector(false); },
  };
}
