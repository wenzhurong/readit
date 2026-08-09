/**
 * Masks the three per-request salts GitHub stamps into fixture HTML, so a fixture
 * refresh can be compared for REAL drift.
 *
 * ## Why this exists
 *
 * `oracle-drift.yml` refreshes every fixture nightly and then asked
 * `git diff --exit-code` whether anything changed. That check was non-empty on
 * **every single run**, by construction: GitHub re-rolls `data-run-id` and
 * `data-identity` per request (SPEC §16 records the measurement — three identical
 * requests, three different values), and the footnote `-<32hex>` suffix likewise.
 * Eight fixtures carry at least one of them. So the nightly alarm fired
 * unconditionally, and a genuine renderer change would have arrived as *more*
 * changed files inside a `--stat` that was never empty.
 *
 * An alarm that fires every night is worse than no alarm: it trains its readers to
 * close the PR without looking. This restores the signal.
 *
 * ## Why masking rather than `normalize()`
 *
 * The obvious fix is to compare `normalize()`d fixtures. That would be **too** lossy
 * for this job. Normalization deliberately erases `pl-*` highlight spans, the mermaid
 * enrichment wrapper and octicon path geometry, because readit is not expected to
 * reproduce those. But a GitHub-side change *in exactly those regions* is real drift
 * that this workflow exists to surface — Linguist regrading a language, or the mermaid
 * enrichment markup changing shape, are precisely the events worth waking up for.
 *
 * Masking only the three salts is strictly less lossy than normalization and was
 * sufficient on the 2026-08-09 refresh: 8 fixtures changed raw bytes, all 8 were
 * mask-equal, and byte lengths were unchanged on every one.
 *
 * Keep committing the refreshed RAW bytes either way — the mask is a comparison
 * device, never a transform applied to what is stored.
 */

/** `data-run-id="<32 hex>"` — re-rolled per render. */
const RUN_ID = /data-run-id="[0-9a-f]{32}"/g

/** `data-identity="<uuid>"` — an RFC 4122 v4 UUID, CSPRNG-generated per render. */
const IDENTITY = /data-identity="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/g

/**
 * Footnote id/href salt: `-<32 hex>` immediately before a quote or `#`.
 *
 * Anchored to an attribute boundary rather than end-of-string (normalize.ts can use
 * `$` because it walks parsed nodes; here we are on raw text). Without the boundary
 * this would also eat a legitimate 32-hex run sitting mid-attribute.
 */
const FOOTNOTE_SALT = /-[0-9a-f]{32}(?=["#])/g

export function maskSalts(html: string): string {
  return html
    .replace(RUN_ID, 'data-run-id="<SALT>"')
    .replace(IDENTITY, 'data-identity="<SALT>"')
    .replace(FOOTNOTE_SALT, '-<SALT>')
}
