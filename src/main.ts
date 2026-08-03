import { OrekenoidGame } from "./game";
import { runRenderDiagnostics } from "./renderDiagnostics";

async function boot(): Promise<void> {
  const host = document.querySelector<HTMLElement>("#gameHost");
  if (!host) throw new Error("Missing #gameHost");
  const game = new OrekenoidGame();
  await game.init(host);
  if (new URLSearchParams(window.location.search).has("render-diagnostics")) {
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
