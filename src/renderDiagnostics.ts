import type { Application, Container } from "pixi.js";
import type { OrekenoidGame } from "./game";

type PixelSummary = { sampled: number; colored: number; brightest: number; first: string };

const summarize = (data: ArrayLike<number>): PixelSummary => {
  let sampled = 0;
  let colored = 0;
  let brightest = 0;
  let first = "—";
  const stride = Math.max(4, Math.ceil(data.length / 500_000) * 4);
  for (let index = 0; index < data.length; index += stride) {
    const r = data[index] ?? 0;
    const g = data[index + 1] ?? 0;
    const b = data[index + 2] ?? 0;
    const a = data[index + 3] ?? 0;
    sampled++;
    const light = Math.max(r, g, b);
    if (a > 8 && light > 42) {
      colored++;
      brightest = Math.max(brightest, light);
      if (first === "—") first = `${r},${g},${b},${a}`;
    }
  }
  return { sampled, colored, brightest, first };
};

const summaryText = (value: PixelSummary | null) => value
  ? `${value.colored}/${value.sampled} COLORED · MAX ${value.brightest} · FIRST ${value.first}`
  : "UNAVAILABLE";

const addReferenceTests = (host: HTMLElement) => {
  const twoD = document.createElement("canvas");
  twoD.width = 180;
  twoD.height = 72;
  const context = twoD.getContext("2d", { willReadFrequently: true });
  if (context) {
    context.fillStyle = "#f0783f";
    context.fillRect(0, 0, 90, 72);
    context.fillStyle = "#eee6d6";
    context.fillRect(90, 0, 90, 72);
    context.fillStyle = "#17130f";
    context.fillRect(77, 24, 26, 24);
  }
  const twoDPixel = context?.getImageData(20, 20, 1, 1).data ?? null;

  const add = (title: string, canvas: HTMLCanvasElement, detail: string) => {
    const figure = document.createElement("figure");
    figure.append(canvas);
    const caption = document.createElement("figcaption");
    caption.innerHTML = `<b>${title}</b><span>${detail}</span>`;
    figure.append(caption);
    host.append(figure);
  };
  add("2D CANVAS", twoD, twoDPixel ? `READ ${Array.from(twoDPixel).join(",")}` : "CONTEXT FAILED");
  return {
    twoD: twoDPixel ? Array.from(twoDPixel) : null,
  };
};

const inspect = (app: Application, stage: Container, label: string) => {
  const canvas = app.canvas as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  const style = getComputedStyle(canvas);
  let framebuffer: PixelSummary | null = null;
  let framebufferState = "NO WEBGL CONTEXT";
  let extracted: PixelSummary | null = null;
  let extractError = "";
  let extractedCanvas: HTMLCanvasElement | null = null;

  try {
    app.renderer.render(stage);
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl) {
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      framebuffer = summarize(pixels);
      framebufferState = `ERROR ${gl.getError()} · LOST ${gl.isContextLost() ? "YES" : "NO"}`;
    }
  } catch (error) {
    framebufferState = `THREW ${error instanceof Error ? error.message : String(error)}`;
  }

  try {
    const output = app.renderer.extract.pixels({ target: stage });
    extracted = summarize(output.pixels);
    extractedCanvas = app.renderer.extract.canvas({ target: stage }) as HTMLCanvasElement;
  } catch (error) {
    extractError = error instanceof Error ? error.message : String(error);
  }

  const bounds = stage.getBounds();
  return {
    label,
    canvas,
    extractedCanvas,
    report: {
      label,
      renderer: app.renderer.constructor.name,
      backing: `${canvas.width}×${canvas.height}`,
      css: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
      presentation: `${style.display} · ${style.visibility} · opacity ${style.opacity} · connected ${canvas.isConnected}`,
      scene: `${stage.children.length} children · visible ${stage.visible} · renderable ${stage.renderable}`,
      bounds: `${Math.round(bounds.x)},${Math.round(bounds.y)} ${Math.round(bounds.width)}×${Math.round(bounds.height)}`,
      framebuffer,
      framebufferState,
      extracted,
      extractError,
    },
  };
};

export const runRenderDiagnostics = async (game: OrekenoidGame): Promise<void> => {
  const panel = document.createElement("aside");
  panel.className = "render-diagnostics";
  panel.innerHTML = `
    <header><div><small>OREKENOID</small><h1>RENDER DIAGNOSTICS</h1></div><strong id="diagnosticStatus">RUNNING TESTS…</strong></header>
    <section class="diagnostic-reference" id="diagnosticReference"></section>
    <section class="diagnostic-results" id="diagnosticResults"></section>
    <footer><button id="copyDiagnostics" type="button">COPY REPORT</button><span>Reload without <b>?render-diagnostics=1</b> to return.</span></footer>`;
  document.body.append(panel);

  const references = addReferenceTests(panel.querySelector<HTMLElement>("#diagnosticReference")!);
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const inspections = [inspect(game.app, game.app.stage, "MAIN GAME")];
  const results = panel.querySelector<HTMLElement>("#diagnosticResults")!;

  for (const inspection of inspections) {
    const value = inspection.report;
    const article = document.createElement("article");
    article.innerHTML = `
      <h2>${value.label}<small>${value.renderer}</small></h2>
      <dl>
        <div><dt>CANVAS</dt><dd>${value.backing} backing · ${value.css} CSS</dd></div>
        <div><dt>PRESENTATION</dt><dd>${value.presentation}</dd></div>
        <div><dt>SCENE</dt><dd>${value.scene}</dd></div>
        <div><dt>BOUNDS</dt><dd>${value.bounds}</dd></div>
        <div><dt>FRAMEBUFFER</dt><dd>${summaryText(value.framebuffer)} · ${value.framebufferState}</dd></div>
        <div><dt>PIXI EXTRACT</dt><dd>${summaryText(value.extracted)}${value.extractError ? ` · ${value.extractError}` : ""}</dd></div>
      </dl>
      <div class="diagnostic-images"><figure class="live"><figcaption>LIVE CANVAS</figcaption></figure><figure class="extract"><figcaption>PIXI EXTRACT</figcaption></figure></div>`;
    article.querySelector(".live")!.prepend(inspection.canvas);
    if (inspection.extractedCanvas) article.querySelector(".extract")!.prepend(inspection.extractedCanvas);
    results.append(article);
  }

  const report = { userAgent: navigator.userAgent, platform: navigator.platform, devicePixelRatio: window.devicePixelRatio, references, applications: inspections.map(({ report: value }) => value) };
  const status = panel.querySelector<HTMLElement>("#diagnosticStatus")!;
  const sceneFailed = inspections.some(({ report: value }) => !value.extracted?.colored);
  const framebufferFailed = inspections.some(({ report: value }) => !value.framebuffer?.colored);
  status.textContent = sceneFailed ? "PIXI EXTRACTION FAILED" : framebufferFailed ? "FRAMEBUFFER FAILED" : "BACKING TESTS PASSED";
  status.dataset.state = sceneFailed || framebufferFailed ? "fail" : "pass";
  panel.querySelector<HTMLButtonElement>("#copyDiagnostics")?.addEventListener("click", async (event) => {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    (event.currentTarget as HTMLButtonElement).textContent = "COPIED";
  });
  (window as unknown as { __OREKENOID_RENDER_REPORT__: unknown }).__OREKENOID_RENDER_REPORT__ = report;
};
