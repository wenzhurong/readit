import mermaid from "mermaid";

export async function boot() {
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
  const target = document.querySelector("#diagram");
  const { svg } = await mermaid.render(
    "probe-diagram",
    "flowchart TD\n  A[Start] --> B{Decision}\n  B -- yes --> C[Done]\n  B -- no --> A\n",
  );
  if (target) target.innerHTML = svg;
}
