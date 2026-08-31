/**
 * Robust Server-Sent Events line parser for `text/event-stream` responses.
 * Yields the payload of each `data:` line. Empty lines and non-`data:` lines
 * (comments, `event:`, `id:`, `retry:`) are ignored. The `[DONE]` sentinel is
 * yielded verbatim so callers can break on it.
 */

const DATA_LINE = /^\s*data:\s*(.*)$/;

function parseDataLine(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  const match = DATA_LINE.exec(trimmed);
  if (!match) return null;
  return match[1] ?? '';
}

export async function* iterateSse(
  response: Response,
): AsyncGenerator<string> {
  const body = response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const payload = parseDataLine(line);
        if (payload !== null) yield payload;
        newline = buffer.indexOf('\n');
      }
    }

    buffer += decoder.decode();
    const payload = parseDataLine(buffer);
    if (payload !== null) yield payload;
  } finally {
    reader.releaseLock();
  }
}

/** True when an error is an AbortError (from fetch or reader.abort). */
export function isAbortError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  return 'name' in e && (e as { name: unknown }).name === 'AbortError';
}
