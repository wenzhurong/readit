// Baseline: no heavy dependency, just what every entry point pays for
// (Tauri's JS API bridge), so per-dependency numbers can be reported net
// of this shared overhead.
import { invoke } from "@tauri-apps/api/core";

export function boot() {
  invoke("probe_log", { stage: "baseline" }).catch(() => {});
}
