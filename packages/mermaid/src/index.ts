import DOMPurify from 'dompurify'
import mermaid from 'mermaid'
import { createMermaidRendererWith } from './renderer.js'

export type { MermaidHydrationResult, MermaidRenderer } from './renderer.js'

/**
 * Create the Phase B Mermaid hydrator. It intentionally preserves Mermaid's
 * own KaTeX support: mermaid 11.16.1 depends on KaTeX ^0.16.45, while prose
 * math uses MathJax. SPEC §15 records that known engine inconsistency; disabling
 * Mermaid math would make those diagrams fail rather than make them consistent.
 */
export function createMermaidRenderer(): import('./renderer.js').MermaidRenderer {
  return createMermaidRendererWith(mermaid, DOMPurify)
}
