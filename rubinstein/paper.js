const $ = (id) => document.getElementById(id);
const fileURL = "../companion/pdf-overlay/vendor/pdfjs/";

export class Paper {
  constructor(data, choose) {
    this.data = data;
    this.choose = choose;
    this.page = null;
    this.epoch = 0;
    this.part = null;
    this.useFrame = navigator.pdfViewerEnabled === true;
    this.externalMode = false;
    this.zoom = window.matchMedia("(max-width:800px)").matches ? 1.6 : 1;
    $("pdfZoom").value = String(this.zoom);
    this.scroll = $("paperScroll");
    this.sheet = $("sheet");
    this.width = 0;
    this.observer = new ResizeObserver(() => {
      if (this.doc && this.width !== this.scroll.clientWidth) this.render();
    });
    this.observer.observe(this.scroll);
    $("toggleEmbed").onclick = () => {
      this.useFrame = !this.useFrame;
      this.external();
    };
    $("pdfZoom").onchange = () => {
      this.zoom = Number($("pdfZoom").value);
      this.render();
    };
    $("file").onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        await this.openBytes(await file.arrayBuffer());
      } catch (err) {
        this.error(err.message);
      }
    };
  }

  async init() {
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(
      location.hostname,
    );
    if (local && location.pathname === "/rubinstein.html") {
      try {
        const response = await fetch(
          new URL("rubinstein-local.pdf", document.baseURI),
        );
        if (
          response.ok &&
          response.headers.get("content-type")?.includes("application/pdf")
        ) {
          await this.openBytes(await response.arrayBuffer());
          return;
        }
      } catch (err) {
        this.error(err.message);
      }
    }
    if (!this.doc) this.external();
  }

  error(message) {
    $("pdfError").textContent = message;
    $("pdfError").hidden = !message;
  }

  async openBytes(bytes) {
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (n) => n.toString(16).padStart(2, "0"),
    ).join("");
    if (digest !== this.data.paper.sha256)
      throw Error(
        "This file is a different edition. Choose Rubinstein’s Waterloo v2 PDF, dated 22 November 2026.",
      );
    const pdfjs = await import(
      new URL(fileURL + "pdf.min.mjs", import.meta.url)
    );
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      fileURL + "pdf.worker.min.mjs",
      import.meta.url,
    ).href;
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
    }).promise;
    if (doc.numPages !== this.data.pages.length)
      throw Error("The PDF page count differs from the page index.");
    const old = this.doc;
    this.doc = doc;
    this.TextLayer = pdfjs.TextLayer;
    if (old) await old.destroy();
    this.externalMode = false;
    this.hideFrame();
    this.scroll.dataset.source = "local";
    $("remoteFallback").hidden = true;
    $("remoteCitationBar").hidden = true;
    $("paperOptions").hidden = true;
    $("localZoom").hidden = false;
    $("pdfZoom").disabled = false;
    this.error("");
    await this.render();
  }

  external() {
    this.externalMode = true;
    $("paperLoad").hidden = true;
    this.sheet.hidden = true;
    $("remoteCitationBar").hidden = false;
    $("paperOptions").hidden = false;
    $("localZoom").hidden = true;
    $("pdfZoom").disabled = true;
    $("remoteFallback").hidden = this.useFrame;
    $("toggleEmbed").textContent = this.useFrame ? "Hide embedded PDF" : "Show embedded PDF";
    $("toggleEmbed").setAttribute("aria-expanded", String(this.useFrame));
    $("toggleEmbed").hidden = navigator.pdfViewerEnabled === false;
    this.scroll.dataset.source = this.useFrame ? "waterloo" : "page-link";
    if (this.useFrame) this.showFrame();
    else this.hideFrame();
    this.citations();
  }

  showFrame() {
    const frame = $("remotePdf");
    const src = this.originalLink();
    if (!frame.hidden && frame.getAttribute("src") === src) return;
    // Some native PDF viewers ignore a fragment change on an existing iframe.
    // Give each requested page a fresh viewer without adding a frame history entry.
    const next = frame.cloneNode(false);
    next.hidden = false;
    next.title = "Page " + this.page + " of Rubinstein’s original Waterloo PDF";
    next.src = src;
    frame.replaceWith(next);
  }

  hideFrame() {
    const frame = $("remotePdf");
    if (!frame.hasAttribute("src")) return;
    const empty = frame.cloneNode(false);
    empty.hidden = true;
    empty.removeAttribute("src");
    frame.replaceWith(empty);
  }

  citations() {
    const list = $("remoteCitations");
    if (list.dataset.page !== String(this.page)) {
      const mentions = this.stops.flatMap((stop) =>
        stop.boxes.map(([x, y], index) => ({ stop, index, x, y })),
      );
      mentions.sort((a, b) => a.y - b.y || a.x - b.x);
      const buttons = mentions.map(({stop, index}) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "paper-citation";
        b.dataset.citation = stop.id;
        b.dataset.occurrence = String(index + 1);
        b.textContent = stop.id;
        if (stop.boxes.length > 1) {
          const n = document.createElement("span");
          n.textContent = (index + 1) + "/" + stop.boxes.length;
          b.append(" ", n);
        }
        b.setAttribute("aria-label", stop.id + ", occurrence " + (index + 1) + " of " + stop.boxes.length);
        b.onclick = () => this.choose(stop, index);
        return b;
      });
      list.replaceChildren(...buttons);
      list.dataset.page = String(this.page);
      $("remoteEmpty").hidden = Boolean(buttons.length);
      $("remoteCitationLabel").hidden = !buttons.length;
      list.hidden = !buttons.length;
    }
    for (const button of list.children) {
      const active = button.dataset.citation === this.part?.id &&
        Number(button.dataset.occurrence) === this.boxIndex + 1;
      button.setAttribute("aria-pressed", String(active));
      if (active) {
        const b = button.getBoundingClientRect(), box = list.getBoundingClientRect();
        if (b.left < box.left || b.right > box.right)
          list.scrollLeft += b.left - box.left - (box.width - b.width) / 2;
      }
    }
  }

  originalLink() {
    return this.data.paper.url + "#page=" + (this.page || 1);
  }

  show(page, stops, selected, boxIndex = 0) {
    const changed = this.page !== page;
    if (changed && this.doc) this.error("");
    this.page = page;
    this.stops = stops;
    this.part = selected;
    this.boxIndex = boxIndex;
    const original = this.originalLink();
    $("original").href = original;
    $("original").setAttribute("aria-label", "Author’s PDF, page " + page + " at Waterloo");
    $("remotePageLink").href = original;
    $("remotePageLink").textContent = "Open page " + page + " at Waterloo";
    if (this.doc && (changed || this.sheet.hidden)) this.render();
    else if (this.doc && this.renderedPage === page) this.highlights(true);
    else if (this.externalMode) {
      if (changed && this.useFrame) this.showFrame();
      this.citations();
    }
  }

  async render() {
    if (!this.doc || !this.page) return;
    const epoch = ++this.epoch,
      num = this.page;
    this.width = this.scroll.clientWidth;
    this.task?.cancel();
    this.textTask?.cancel();
    $("paperLoad").hidden = false;
    this.sheet.hidden = true;
    this.renderedPage = null;
    try {
      const page = await this.doc.getPage(num);
      if (epoch !== this.epoch) return;
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: (Math.max(100, this.width - 24) * this.zoom) / natural.width,
      });
      const pixel = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width * pixel);
      canvas.height = Math.ceil(viewport.height * pixel);
      const task = page.render({
        canvasContext: canvas.getContext("2d", { alpha: false }),
        viewport,
        transform: [pixel, 0, 0, pixel, 0, 0],
      });
      this.task = task;
      await task.promise;
      if (epoch !== this.epoch) return;
      const visible = $("pdfCanvas");
      visible.width = canvas.width;
      visible.height = canvas.height;
      visible.getContext("2d", { alpha: false }).drawImage(canvas, 0, 0);
      this.sheet.style.width = viewport.width + "px";
      this.sheet.style.height = viewport.height + "px";
      this.sheet.hidden = false;
      $("paperLoad").hidden = true;
      this.renderedPage = num;
      this.sheet.dataset.page = String(num);
      this.scroll.scrollTop = 0;
      this.scroll.scrollLeft = 0;
      this.highlights(true);
      const layer = $("pdfText");
      layer.removeAttribute("data-page");
      layer.replaceChildren();
      layer.style.setProperty(
        "--total-scale-factor",
        String(viewport.scale * (viewport.userUnit || 1)),
      );
      this.textTask = new this.TextLayer({
        textContentSource: page.streamTextContent({
          includeMarkedContent: true,
          disableNormalization: true,
        }),
        container: layer,
        viewport,
      });
      await this.textTask.render();
      if (epoch === this.epoch) layer.dataset.page = String(num);
    } catch (err) {
      if (
        epoch === this.epoch &&
        err.name !== "RenderingCancelledException" &&
        err.name !== "AbortException"
      )
        this.error("The page could not be rendered. " + err.message);
    }
  }

  highlights(reveal) {
    const marks = $("marks"),
      oldFocus = document.activeElement,
      focused = marks.contains(oldFocus) ? oldFocus.dataset.key : null;
    const buttons = document.createDocumentFragment();
    let selected;
    for (const stop of this.stops) {
      stop.boxes.forEach(([left, top, right, bottom], i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cite-mark";
        b.dataset.key = stop.id + "-" + i;
        b.dataset.citation = stop.id;
        const label = `Stop ${stop.index + 1}, ${stop.id}, occurrence ${i + 1} of ${stop.boxes.length}`;
        b.setAttribute("aria-label", label);
        const active = stop === this.part && i === this.boxIndex;
        b.title = label;
        b.setAttribute("aria-pressed", String(active));
        b.style.left = left / 100 + "%";
        b.style.top = top / 100 + "%";
        b.style.width = (right - left) / 100 + "%";
        b.style.height = (bottom - top) / 100 + "%";
        b.onclick = () => this.choose(stop, i);
        if (stop === this.part) b.classList.add("selected");
        if (active) {
          b.classList.add("active-occurrence");
          selected = b;
        }
        buttons.append(b);
      });
    }
    marks.replaceChildren(buttons);
    if (focused)
      [...marks.children]
        .find((b) => b.dataset.key === focused)
        ?.focus({ preventScroll: true });
    if (reveal && selected) {
      const view = this.scroll.getBoundingClientRect(),
        r = selected.getBoundingClientRect();
      if (r.top < view.top + 22 || r.bottom > view.bottom - 22)
        this.scroll.scrollTop += r.top - view.top - view.height * 0.34;
      if (r.left < view.left || r.right > view.right)
        this.scroll.scrollLeft += r.left - view.left - 16;
    }
  }
}
