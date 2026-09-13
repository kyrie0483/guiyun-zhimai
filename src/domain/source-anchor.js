const CONTEXT_LENGTH = 120;

function allOccurrences(source, needle) {
  const matches = [];
  if (!needle) return matches;
  let cursor = 0;
  while ((cursor = source.indexOf(needle, cursor)) >= 0) {
    matches.push(cursor);
    cursor += Math.max(1, needle.length);
  }
  return matches;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createTextSourceAnchor({ sourceText, sourceRevision = 1, start, end }) {
  const selectedText = sourceText.slice(start, end).trim();
  if (!selectedText || selectedText.length > 10_000) return null;
  const selectedStart = sourceText.indexOf(selectedText, start);
  const selectedEnd = selectedStart + selectedText.length;
  const prefixContext = sourceText.slice(Math.max(0, selectedStart - CONTEXT_LENGTH), selectedStart);
  const suffixContext = sourceText.slice(selectedEnd, selectedEnd + CONTEXT_LENGTH);
  return {
    contextHash: await sha256(`${prefixContext}\u0000${selectedText}\u0000${suffixContext}`),
    end: selectedEnd,
    prefixContext,
    selectedText,
    sourceRevision,
    start: selectedStart,
    suffixContext,
    version: 1
  };
}

export function resolveTextSourceAnchor(sourceText, currentRevision, anchor) {
  if (currentRevision === anchor.sourceRevision && sourceText.slice(anchor.start, anchor.end) === anchor.selectedText) {
    return { end: anchor.end, exact: true, start: anchor.start };
  }
  const nearbyStart = Math.max(0, anchor.start - 2_000);
  const nearbyEnd = Math.min(sourceText.length, anchor.end + 2_000);
  const nearby = allOccurrences(sourceText.slice(nearbyStart, nearbyEnd), anchor.selectedText).map((offset) => offset + nearbyStart);
  const sourceMatches = nearby.length === 1 ? nearby : allOccurrences(sourceText, anchor.selectedText);
  const contextual = sourceMatches.filter((start) => {
    const end = start + anchor.selectedText.length;
    return sourceText.slice(Math.max(0, start - anchor.prefixContext.length), start) === anchor.prefixContext &&
      sourceText.slice(end, end + anchor.suffixContext.length) === anchor.suffixContext;
  });
  const matches = contextual.length === 1 ? contextual : sourceMatches;
  if (matches.length !== 1) return null;
  return { end: matches[0] + anchor.selectedText.length, exact: true, start: matches[0] };
}

export function createTextFragmentUrl(canonicalUrl, selectedText) {
  const normalized = selectedText.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!normalized) return canonicalUrl;
  const url = new URL(canonicalUrl);
  url.hash = `:~:text=${encodeURIComponent(normalized)}`;
  return url.toString();
}
