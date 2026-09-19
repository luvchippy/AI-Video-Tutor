/**
 * Shared builder for the flat "selector -> value" map that the platform modules'
 * `pickCreator` consumes. Pure: no DOM, no fetch, no Node APIs.
 *
 * The per-platform key lists stay private to `youtube.ts` / `bilibili.ts`; each
 * of them exports a thin wrapper around `readCreatorMeta`, so the selector
 * contract lives next to the `pickCreator` that reads it, while the
 * content-vs-text-vs-href rule below is written once.
 */

/** The candidate values one element can offer. */
export interface CreatorMetaValue {
  /** `content` attribute (what `<meta>` and `<link>` carry). */
  content?: string;
  /** Trimmed `textContent`. */
  text?: string;
  /** `href` attribute, raw — `pickCreator` normalizes it. */
  href?: string;
}

/**
 * Build the map `pickCreator` expects by asking `read` for each selector.
 *
 * Which value a key wants is decided here, not by the caller:
 *   - name keys take `content` first and fall back to `text` (a `<meta>` has
 *     only the former, an `<a>` only the latter, and a `<link itemprop=name>`
 *     carries `content`);
 *   - url keys take `href` only.
 *
 * A key whose selector matches nothing is stored as `undefined` rather than
 * omitted, so the map has exactly the same shape on every page.
 */
export function readCreatorMeta(
  nameKeys: readonly string[],
  urlKeys: readonly string[],
  read: (selector: string) => CreatorMetaValue | undefined,
): Record<string, string | undefined> {
  const meta: Record<string, string | undefined> = {};
  for (const key of nameKeys) {
    const value = read(key);
    meta[key] = value?.content ?? value?.text;
  }
  for (const key of urlKeys) {
    meta[key] = read(key)?.href;
  }
  return meta;
}