// Adapted from F:/GY/gy-913/src/features/library/private-markdown.ts and
// src/components/knowledge/markdown-reader.tsx.
export const MAX_PRIVATE_MARKDOWN_BYTES = 2 * 1024 * 1024;

export function normalizeImportedMarkdown(markdown) {
  return String(markdown ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function isPrivateMarkdownFile(file) {
  return Boolean(file && file.size > 0 && file.size <= MAX_PRIVATE_MARKDOWN_BYTES && file.name.toLocaleLowerCase().endsWith(".md"));
}

export function safeReadingUrl(url) {
  const value = String(url ?? "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

function inlineMarkdown(value) {
  let output = escapeHtml(value);
  output = output.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_, label, url) => {
    const safe = safeReadingUrl(url);
    return safe ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  });
  output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  output = output.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return output;
}

export function markdownToSafeHtml(markdown) {
  const lines = normalizeImportedMarkdown(markdown).split("\n");
  const html = [];
  let inCode = false;
  let code = [];
  let list = null;
  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      closeList();
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (unordered || ordered) {
      const nextList = unordered ? "ul" : "ol";
      if (list !== nextList) {
        closeList();
        list = nextList;
        html.push(`<${list}>`);
      }
      html.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
    } else {
      closeList();
      if (/^\s*>\s?/.test(line)) html.push(`<blockquote>${inlineMarkdown(line.replace(/^\s*>\s?/, ""))}</blockquote>`);
      else if (/^\s*---+\s*$/.test(line)) html.push("<hr>");
      else if (line.trim()) html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeList();
  if (inCode || code.length) html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return html.join("");
}
