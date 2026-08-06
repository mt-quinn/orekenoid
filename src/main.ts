import { OrekenoidGame } from "./game";
import { runRenderDiagnostics } from "./renderDiagnostics";
import { registerServiceWorker } from "./platform";

// Before the game, so a failed boot still leaves an installable, offline-capable shell.
registerServiceWorker();

async function boot(): Promise<void> {
  const host = document.querySelector<HTMLElement>("#gameHost");
  if (!host) throw new Error("Missing #gameHost");
  const query = new URLSearchParams(window.location.search);
  // Geology is a pure function of the seed, so restoring a save from a different
  // world means generating that world first. `?seed=` is how a save's seed reaches
  // the generator, and it doubles as a way to hand someone a specific mine.
  const seed = query.get("seed");
  const game = seed ? new OrekenoidGame(seed) : new OrekenoidGame();
  await game.init(host);
  if (query.has("render-diagnostics")) {
    await runRenderDiagnostics(game);
  }
}

void boot().catch((error: unknown) => {
  console.error("Orekenoid renderer failed to initialize", error);
  const briefing = document.querySelector<HTMLElement>("#briefing");
  const loader = document.querySelector<HTMLElement>("#deploymentLoader b");
  briefing?.classList.remove("loading");
  briefing?.classList.add("failed");
  briefing?.setAttribute("aria-busy", "false");
  briefing?.setAttribute("data-render-state", "failed");
  if (loader) loader.textContent = "PADDLE RENDERER FAILED · RELOAD";
});
