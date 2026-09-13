// Ported from F:/GY/gy-913/src/features/library/markdown-source-anchor.ts.
const CONTEXT_LENGTH = 500;

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function renderedOffset(root, container, offset) {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(container, offset);
  return range.cloneContents().textContent?.length ?? 0;
}

function markdownOffsetForRenderedOffset(markdown, rendered, target) {
  if (target <= 0) return 0;
  let markdownIndex = 0, renderedIndex = 0;
  while (markdownIndex < markdown.length && renderedIndex < target) {
    const found = markdown.indexOf(rendered[renderedIndex], markdownIndex);
    if (found < 0) return null;
    markdownIndex = found + 1;
    renderedIndex += 1;
  }
  return renderedIndex === target ? markdownIndex : null;
}

export async function createMarkdownSourceAnchor({markdown, revision, root, selection}) {
  if (selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const raw = selection.toString();
  const selectedText = raw.trim();
  if (!selectedText || [...selectedText].length > 10_000) return null;
  const rendered = root.textContent ?? "";
  const leadingTrim = raw.length - raw.trimStart().length;
  const trailingTrim = raw.length - raw.trimEnd().length;
  const renderedStart = renderedOffset(root, range.startContainer, range.startOffset) + leadingTrim;
  const renderedEnd = renderedOffset(root, range.endContainer, range.endOffset) - trailingTrim;
  let start = markdownOffsetForRenderedOffset(markdown, rendered, renderedStart);
  let end = markdownOffsetForRenderedOffset(markdown, rendered, renderedEnd);
  if (start === null || end === null || end <= start) {
    const matches = allOccurrences(markdown, selectedText);
    if (matches.length !== 1) return null;
    start = matches[0];
    end = start + selectedText.length;
  }
  for (const delimiter of ["**", "__", "*", "_", "`"]) {
    if (!markdown.startsWith(delimiter, start)) continue;
    if (markdown.startsWith(delimiter, end)) end += delimiter.length;
    else start += delimiter.length;
    break;
  }
  if (markdown.startsWith("[", start) && markdown.startsWith("](", end)) {
    const linkEnd = markdown.indexOf(")", end + 2);
    if (linkEnd >= 0) end = linkEnd + 1;
  }
  const selectedMarkdown = markdown.slice(start, end);
  if (!selectedMarkdown || [...selectedMarkdown].length > 10_000) return null;
  const prefixContext = markdown.slice(Math.max(0, start - CONTEXT_LENGTH), start);
  const suffixContext = markdown.slice(end, end + CONTEXT_LENGTH);
  return {
    contextHash: await sha256(`${prefixContext}\0${selectedMarkdown}\0${suffixContext}`),
    end, prefixContext, selectedMarkdown, selectedText, sourceFragment: selectedMarkdown,
    sourceRevision: revision, start, suffixContext, version: 1,
  };
}

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

export function resolveMarkdownSourceAnchor(markdown, currentRevision, anchor) {
  const fragment = anchor.sourceFragment ?? anchor.selectedMarkdown;
  if (currentRevision === anchor.sourceRevision && markdown.slice(anchor.start, anchor.end) === fragment) return {end: anchor.end, exact: true, start: anchor.start};
  const nearbyStart = Math.max(0, anchor.start - 2_000);
  const nearbyEnd = Math.min(markdown.length, anchor.end + 2_000);
  const nearby = allOccurrences(markdown.slice(nearbyStart, nearbyEnd), fragment).map(offset => offset + nearbyStart);
  const sourceMatches = nearby.length === 1 ? nearby : allOccurrences(markdown, fragment);
  const contextual = sourceMatches.filter(start => {
    const end = start + fragment.length;
    return markdown.slice(Math.max(0, start - anchor.prefixContext.length), start) === anchor.prefixContext &&
      markdown.slice(end, end + anchor.suffixContext.length) === anchor.suffixContext;
  });
  const matches = contextual.length === 1 ? contextual : sourceMatches;
  if (matches.length === 1) return {end: matches[0] + fragment.length, exact: true, start: matches[0]};
  const textMatches = allOccurrences(markdown, anchor.selectedText);
  if (textMatches.length === 1) return {end: textMatches[0] + anchor.selectedText.length, exact: false, start: textMatches[0]};
  return null;
}

export function findMarkdownRenderedTarget(root, markdown, sourceStart) {
  const rendered = root.textContent ?? "";
  let markdownIndex = 0, renderedIndex = 0;
  while (renderedIndex < rendered.length) {
    const found = markdown.indexOf(rendered[renderedIndex], markdownIndex);
    if (found < 0 || found >= sourceStart) break;
    markdownIndex = found + 1;
    renderedIndex += 1;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0, node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (consumed + length > renderedIndex) return node.parentElement;
    consumed += length;
    node = walker.nextNode();
  }
  return null;
}
