import { createStarryNight, common } from "@wooorm/starry-night";
import { toHtml } from "hast-util-to-html";
import onigWasmUrl from "vscode-oniguruma/release/onig.wasm";

export async function boot() {
  const starryNight = await createStarryNight(common, {
    getOnigurumaUrlFetch: async () => new URL(onigWasmUrl, "http://localhost/"),
  });
  const scope = starryNight.flagToScope("js");
  const target = document.querySelector("#highlight");
  if (!scope || !target) return;
  const tree = starryNight.highlight("const x = 1;", scope);
  target.innerHTML = toHtml(tree);
}
