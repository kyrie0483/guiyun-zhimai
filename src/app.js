import {
  createTextSourceAnchor,
  resolveTextSourceAnchor,
} from "./domain/source-anchor.js";
import { loadState, saveState } from "./domain/store.js";
import {
  markdownToSafeHtml,
  safeReadingUrl,
} from "./domain/personal-reading.js";
import {
  createMarkdownSourceAnchor,
  findMarkdownRenderedTarget,
  resolveMarkdownSourceAnchor,
} from "./domain/markdown-source-anchor.js";
import { auditGuiyunState } from "./domain/product-guardrails.js";

let state = loadState();
let current = null;
let pending = null;
let pendingSelectionRange = null;
let latestSearchRequest = 0;
const HIGHLIGHT_COLORS = {
  yellow: "#FFFF55",
  red: "#EA3323",
  orange: "#EF8733",
  green: "#75FB4C",
  purple: "#9536F6",
};
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const safeAvatarUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
};

function renderAccountLink(user) {
  const avatar = safeAvatarUrl(user.avatar);
  const initial = escapeHtml(String(user.name || "知").slice(0, 1));
  $("#login").innerHTML = `<span class="account-avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="" referrerpolicy="no-referrer">` : initial}</span><span>${escapeHtml(user.name || "知乎用户")}</span>`;
  $("#login").href = "/profile";
  $("#login").title = "查看我的知乎资料";
  $("#login").classList.add("account-link");
}
const activeNetwork = () =>
  state.networks.find((item) => item.id === state.activeNetworkId) ??
  state.networks[0];

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.className = "show";
  setTimeout(() => (element.className = ""), 2600);
}

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "请求失败");
  return payload;
}

function updateNetworkEntry(networkId = activeNetwork().id) {
  const target = state.networks.find((item) => item.id === networkId) ?? activeNetwork();
  const link = $("#network-link");
  link.href = `/network?network=${encodeURIComponent(target.id)}`;
  link.querySelector("span").textContent = `${target.nodes.length} 节点`;
}

function activateMobilePanel(panel) {
  if (innerWidth <= 760)
    document.querySelector(`.mobile-tabs [data-panel="${panel}"]`)?.click();
}

function renderPersonalSources() {
  const root = $("#personal-sources");
  root.innerHTML = state.sources.length
    ? state.sources
        .map(
          (source) =>
            `<article class="result personal-source"><span>${source.origin === "zhihu" ? "已加入 · 知乎内容" : `个人阅读 · ${source.format === "markdown" ? "Markdown" : "文章"}`}</span><h3>${escapeHtml(source.title)}</h3><p>${escapeHtml((source.content || source.excerpt || "").slice(0, 180))}</p><button data-source="${escapeHtml(source.id)}">打开阅读</button></article>`,
        )
        .join("")
    : "";
  root.querySelectorAll("[data-source]").forEach((button) => {
    button.onclick = () => {
      const source = state.sources.find((item) => item.id === button.dataset.source);
      if (source) openItem(source);
    };
  });
}

function saveSearchResult(item) {
  const sourceKey = String(item.id || item.url || item.title);
  const existing = state.sources.find(
    (source) => String(source.externalId || source.url || source.title) === sourceKey,
  );
  if (existing) {
    openItem(existing);
    toast("这篇内容已经在左侧阅读来源中");
    return existing;
  }
  const source = {
    id: crypto.randomUUID(),
    externalId: sourceKey,
    origin: "zhihu",
    format: "text",
    type: item.type || "知乎内容",
    title: item.title,
    author: item.author || "知乎用户",
    url: safeReadingUrl(item.url) || "",
    canonicalUrl: safeReadingUrl(item.url) || "",
    content: item.excerpt || "该条目没有可用摘要。",
    excerpt: item.excerpt || "",
    editedAt: item.editedAt || 1,
    createdAt: new Date().toISOString(),
  };
  state.sources.unshift(source);
  saveState(state);
  renderPersonalSources();
  openItem(source);
  toast("已加入左侧阅读来源");
  return source;
}

function sourceHighlightKey(item = current) {
  return String(item?.id ?? item?.canonicalUrl ?? item?.url ?? item?.title ?? "");
}

function applySavedHighlights(root, item) {
  const key = sourceHighlightKey(item);
  const highlights = state.highlights
    .filter((highlight) => highlight.sourceKey === key)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  if (!highlights.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);
  let offset = 0;
  for (const textNode of textNodes) {
    const value = textNode.textContent ?? "";
    const nodeStart = offset;
    const nodeEnd = nodeStart + value.length;
    offset = nodeEnd;
    const matches = highlights.filter(
      (highlight) => highlight.start < nodeEnd && highlight.end > nodeStart,
    );
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const highlight of matches) {
      const start = Math.max(cursor, Math.max(0, highlight.start - nodeStart));
      const end = Math.min(value.length, highlight.end - nodeStart);
      if (end <= start) continue;
      if (start > cursor) fragment.append(value.slice(cursor, start));
      const mark = document.createElement("mark");
      mark.className = "guiyun-text-highlight";
      mark.dataset.highlightId = highlight.id;
      mark.dataset.color = highlight.color;
      mark.style.setProperty("--highlight-color", HIGHLIGHT_COLORS[highlight.color]);
      mark.title = "高亮内容；双击可删除高亮";
      mark.textContent = value.slice(start, end);
      fragment.append(mark);
      cursor = end;
    }
    if (cursor < value.length) fragment.append(value.slice(cursor));
    textNode.replaceWith(fragment);
  }
}

function renderArticleContent(item) {
  const personal = item.origin === "personal";
  $("#article-content").innerHTML = personal
    ? markdownToSafeHtml(item.content)
    : item.excerpt
        .split(/\n+/)
        .filter(Boolean)
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join("") || "<p>该条目没有可用摘要，请在知乎查看原文。</p>";
  applySavedHighlights($("#article-content"), item);
}

function openItem(item) {
  hideSelectionMenu(true);
  current = item;
  $("#reader-empty").hidden = true;
  $("#reader-view").hidden = false;
  $("#article-title").textContent = item.title;
  const personal = item.origin === "personal";
  $("#source-badge").textContent = personal ? "个人阅读" : item.type === "归档快照" ? "归档快照" : "知乎来源";
  $("#article-meta").textContent = personal
    ? `${item.author} · ${item.format === "markdown" ? "Markdown" : "文章"}`
    : `${item.author} · ${item.type === "归档快照" ? "归档快照" : `知乎${item.type || "内容"}`}`;
  renderArticleContent(item);
  const safeUrl = safeReadingUrl(item.url);
  $("#open-original").hidden = !safeUrl;
  $("#open-original").href = safeUrl || "#";
  activateMobilePanel("reader");
  $("#reader-view").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function search(query, hot = false) {
  const requestId = ++latestSearchRequest;
  $("#results").innerHTML = '<p class="empty">正在连接知乎…</p>';
  try {
    const data = await request(
      hot
        ? "/api/zhihu/hot?limit=10"
        : `/api/zhihu/search?q=${encodeURIComponent(query)}&count=8`,
    );
    if (requestId !== latestSearchRequest) return;
    const statusMessage = data.demo
      ? "知乎接口暂时不可用，当前显示演示结果。"
      : data.limited
        ? data.fallbackReason === "quota"
          ? "本次知乎搜索额度已用完，现显示赛事公开内容；额度恢复后自动切回全站搜索。"
          : "当前显示知乎赛事公开内容。"
        : "";
    $("#search-message").textContent = statusMessage;
    $("#search-message").hidden = !statusMessage;
    $("#results").innerHTML = data.items.length
      ? data.items
          .map(
            (item, index) =>
              `<article class="result"><span>${escapeHtml(item.type || "内容")} · ${item.votes || 0} 赞同</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.excerpt)}</p><small>${escapeHtml(item.author)} · ${item.comments || 0} 评论</small><div class="result-actions"><button data-open="${index}">立即阅读</button><button class="primary" data-save="${index}">加入左侧</button></div></article>`,
          )
          .join("")
      : '<p class="empty">没有找到结果，请换个关键词。</p>';
    $("#results")
      .querySelectorAll("[data-open]")
      .forEach((button) => (button.onclick = () => openItem(data.items[Number(button.dataset.open)])));
    $("#results")
      .querySelectorAll("[data-save]")
      .forEach((button) => {
        button.onclick = () => {
          saveSearchResult(data.items[Number(button.dataset.save)]);
          button.textContent = "已加入";
          button.disabled = true;
        };
      });
  } catch (error) {
    if (requestId !== latestSearchRequest) return;
    $("#results").innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

function openArchive(data) {
  pending = { ...pending, ...data };
  const preview =
    data.type === "article"
      ? `文档：${current?.title ?? ""}`
      : `选中内容：${pending.text ?? data.anchor?.selectedText ?? ""}`;
  $("#archive-source-summary").innerHTML = `<span>${data.type === "article" ? "整篇文档" : "所选文段"}</span><p>${escapeHtml(preview)}</p>`;
  $("#archive-targets").innerHTML = state.networks
    .map(
      (item) =>
        `<button type="button" role="listitem" data-archive-network="${escapeHtml(item.id)}"><span class="archive-network-icon">归</span><span><b>${escapeHtml(item.name)}</b><small>${item.nodes.length} 个节点 · ${item.edges.length} 条关系</small></span><i>›</i></button>`,
    )
    .join("");
  $("#archive-targets")
    .querySelectorAll("[data-archive-network]")
    .forEach((button) => (button.onclick = () => archiveToNetwork(button.dataset.archiveNetwork)));
  $("#archive-dialog").hidden = false;
  $("#selection-popover").hidden = true;
}

async function archiveToNetwork(networkId) {
  if (!current || !pending) return;
  const target = state.networks.find((item) => item.id === networkId);
  if (!target) return;
  const snapshot = current.content ?? current.excerpt ?? "";
  const selectedText = (
    pending.anchor?.selectedMarkdown ??
    pending.anchor?.selectedText ??
    pending.text ??
    ""
  ).trim();
  let unnamedIndex = 1;
  while (target.nodes.some((node) => node.title === `未命名节点${unnamedIndex}`))
    unnamedIndex += 1;
  const title =
    pending.type === "article"
      ? current.title
      : selectedText.length > 0 && selectedText.length <= 20
        ? selectedText
        : `未命名节点${unnamedIndex}`;
  const node = {
    id: crypto.randomUUID(),
    title,
    note: "",
    type: pending.type,
    anchor: pending.anchor,
    integrationStatus: "new",
    createdAt: new Date().toISOString(),
    source: {
      contentId: current.id,
      sourceType: current.origin === "personal" ? "personal-markdown" : current.type,
      title: current.title,
      author: current.author,
      canonicalUrl: current.url || "",
      excerpt: snapshot,
      snapshot,
      sourceRevision: current.editedAt || 1,
    },
  };
  target.nodes.push(node);
  state.activeNetworkId = target.id;
  saveState(state);
  updateNetworkEntry(target.id);
  $("#archive-dialog").hidden = true;
  getSelection()?.removeAllRanges();
  pending = null;
  $("#archive-success").hidden = false;
  $("#archive-success-message").textContent = `已归档到「${target.name}」`;
  $("#archive-success-link").href = `/network?network=${encodeURIComponent(target.id)}&node=${encodeURIComponent(node.id)}`;
  toast(`已归档到「${target.name}」`);
}

function findRequestedNode() {
  const parameters = new URLSearchParams(location.search);
  const networkId = parameters.get("network");
  const nodeId = parameters.get("node");
  const targetNetwork =
    state.networks.find((item) => item.id === networkId) ?? activeNetwork();
  const node = targetNetwork?.nodes.find((item) => item.id === nodeId);
  return node ? { network: targetNetwork, node } : null;
}

function openRequestedNode() {
  const requested = findRequestedNode();
  if (!requested) return false;
  state.activeNetworkId = requested.network.id;
  saveState(state);
  updateNetworkEntry(requested.network.id);
  const node = requested.node;
  const saved = state.sources.find((source) => source.id === node.source.contentId);
  const fallback = {
    id: node.source.contentId,
    origin: node.source.sourceType === "personal-markdown" ? "personal" : undefined,
    format: "markdown",
    type: "归档快照",
    title: `${node.source.title}${saved ? "" : "（归档快照）"}`,
    author: node.source.author,
    url: node.source.canonicalUrl,
    content: node.source.snapshot,
    excerpt: node.source.snapshot,
    editedAt: node.source.sourceRevision,
  };
  const source = saved ?? fallback;
  openItem(source);
  requestAnimationFrame(() => {
    if (!node.anchor) return;
    if (node.source.sourceType === "personal-markdown") {
      const markdown = source.content ?? node.source.snapshot;
      const result = resolveMarkdownSourceAnchor(markdown, source.editedAt || 1, node.anchor);
      const target = result
        ? findMarkdownRenderedTarget($("#article-content"), markdown, result.start)
        : null;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("flash");
        setTimeout(() => target.classList.remove("flash"), 1800);
      } else toast("来源内容已变化，当前显示归档快照。");
      return;
    }
    const result = resolveTextSourceAnchor(
      $("#article-content").innerText,
      source.editedAt || node.source.sourceRevision || 1,
      node.anchor,
    );
    if (!result) return toast("原文已变化，当前显示归档快照。");
    for (const paragraph of $("#article-content").querySelectorAll("p")) {
      if (!paragraph.textContent.includes(node.anchor.selectedText)) continue;
      paragraph.scrollIntoView({ behavior: "smooth", block: "center" });
      paragraph.classList.add("flash");
      setTimeout(() => paragraph.classList.remove("flash"), 1800);
      break;
    }
  });
  return true;
}

async function init() {
  $("#toast").setAttribute("role", "status");
  $("#toast").setAttribute("aria-live", "polite");
  $(".workspace").dataset.mobilePanel = "sources";
  document.querySelectorAll(".mobile-tabs [data-panel]").forEach((button) => {
    button.onclick = () => {
      $(".workspace").dataset.mobilePanel = button.dataset.panel;
      document
        .querySelectorAll(".mobile-tabs [data-panel]")
        .forEach((item) => item.classList.toggle("active", item === button));
    };
  });
  renderPersonalSources();
  updateNetworkEntry();
  try {
    const health = await request("/api/health");
    $("#api-state").textContent = health.zhihuConfigured ? "知乎接口已连接" : "演示模式";
    $("#api-state").classList.toggle("ok", health.zhihuConfigured);
    if (!health.oauthConfigured) {
      $("#login").textContent = "知乎登录";
      $("#login").href = "/api/auth/zhihu/start";
      $("#login").title = "使用知乎账号登录";
    }
  } catch {
    $("#api-state").textContent = "服务异常";
  }
  try {
    const session = await request("/api/auth/session");
    if (session.user) {
      renderAccountLink(session.user);
    }
  } catch {}
  const issues = auditGuiyunState(state);
  if (issues.length) console.warn("归云数据约束检查发现问题", issues);
  if (!openRequestedNode()) {
    $("#results").innerHTML = "";
  }
}

$("#search-form").onsubmit = (event) => {
  event.preventDefault();
  const query = $("#search-input").value.trim();
  if (query) search(query);
};
$("#hot").onclick = () => search("", true);
$("#archive-article").onclick = () =>
  current &&
  openArchive({ anchor: null, type: "article", title: current.title, text: current.title });
$("#archive-cancel").onclick = () => {
  $("#archive-dialog").hidden = true;
  pending = null;
};
function hideSelectionMenu(clearPending = false) {
  $("#selection-popover").hidden = true;
  $("#selection-actions").hidden = false;
  $("#highlight-colors").hidden = true;
  if (clearPending) {
    pendingSelectionRange = null;
    pending = null;
  }
}
function captureReadingSelection(position) {
  const selection = getSelection();
  if (!current || !selection || selection.isCollapsed || selection.rangeCount !== 1) {
    hideSelectionMenu();
    return false;
  }
  const range = selection.getRangeAt(0);
  const root = $("#article-content");
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    hideSelectionMenu();
    return false;
  }
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const raw = range.toString();
  const text = raw.trim();
  if (!text || [...text].length > 10_000) {
    hideSelectionMenu();
    return false;
  }
  const start = before.toString().length + raw.length - raw.trimStart().length;
  pending = { start, end: start + text.length, text };
  pendingSelectionRange = range.cloneRange();
  const box = range.getBoundingClientRect();
  const popover = $("#selection-popover");
  $("#selection-actions").hidden = false;
  $("#highlight-colors").hidden = true;
  popover.style.left = `${Math.max(8, Math.min(innerWidth - 78, position?.left ?? box.left))}px`;
  popover.style.top = `${Math.max(8, Math.min(innerHeight - 48, position?.top ?? box.top - 44))}px`;
  popover.hidden = false;
  return true;
}
function restoreReadingSelection() {
  if (!pendingSelectionRange) return getSelection();
  const selection = getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
    selection?.removeAllRanges();
    selection?.addRange(pendingSelectionRange.cloneRange());
  }
  return selection;
}
const articleContent = $("#article-content");
articleContent.addEventListener("mouseup", (event) => {
  if (event.button === 0) queueMicrotask(() => captureReadingSelection());
});
articleContent.addEventListener("contextmenu", (event) => {
  if (!getSelection()?.toString().trim()) return;
  event.preventDefault();
  captureReadingSelection({ left: event.clientX + 8, top: event.clientY + 8 });
});
articleContent.addEventListener("keyup", (event) => {
  if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End")
    captureReadingSelection();
});
articleContent.addEventListener("click", (event) => {
  const mark = event.target.closest?.("[data-highlight-id]");
  if (!mark) return;
  const highlight = state.highlights.find((item) => item.id === mark.dataset.highlightId);
  if (!highlight) return;
  const range = document.createRange();
  range.selectNodeContents(mark);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  pendingSelectionRange = range.cloneRange();
  pending = { start: highlight.start, end: highlight.end, text: highlight.text };
  const box = mark.getBoundingClientRect();
  openHighlightPalette({ left: box.left, top: box.top - 44 });
});
articleContent.addEventListener("dblclick", (event) => {
  const mark = event.target.closest?.("[data-highlight-id]");
  if (!mark) return;
  state.highlights = state.highlights.filter(
    (highlight) => highlight.id !== mark.dataset.highlightId,
  );
  saveState(state);
  renderArticleContent(current);
  hideSelectionMenu(true);
  getSelection()?.removeAllRanges();
  toast("已删除高亮");
});
document.addEventListener("selectionchange", () => {
  const selection = getSelection();
  if (!selection || selection.isCollapsed) hideSelectionMenu();
});
$("#selection-popover").addEventListener("mousedown", (event) => event.preventDefault());
$("#selection-popover").addEventListener("contextmenu", (event) => event.preventDefault());
function openHighlightPalette(position) {
  if (!pending?.text) return;
  $("#selection-actions").hidden = true;
  $("#highlight-colors").hidden = false;
  const popover = $("#selection-popover");
  const left = position?.left ?? (Number.parseFloat(popover.style.left) || 8);
  const top = position?.top ?? (Number.parseFloat(popover.style.top) || 8);
  popover.style.left = `${Math.max(8, Math.min(innerWidth - 196, left))}px`;
  popover.style.top = `${Math.max(8, Math.min(innerHeight - 48, top))}px`;
  popover.hidden = false;
}
$("#highlight-selection").onclick = () => openHighlightPalette();
$("#remove-highlight").onclick = () => {
  if (!pending || !current) return;
  const sourceKey = sourceHighlightKey();
  const removed = state.highlights.filter(
    (highlight) =>
      highlight.sourceKey === sourceKey &&
      pending.start < highlight.end &&
      pending.end > highlight.start,
  );
  if (!removed.length) return toast("所选文字没有高亮");
  const removedIds = new Set(removed.map((highlight) => highlight.id));
  state.highlights = state.highlights.filter((highlight) => !removedIds.has(highlight.id));
  saveState(state);
  renderArticleContent(current);
  getSelection()?.removeAllRanges();
  hideSelectionMenu(true);
  toast(removed.length > 1 ? `已取消 ${removed.length} 处高亮` : "已取消高亮");
};
document.querySelectorAll("[data-highlight-color]").forEach((button) => {
  button.onclick = () => {
    if (!pending || !current || !HIGHLIGHT_COLORS[button.dataset.highlightColor]) return;
    const sourceKey = sourceHighlightKey();
    const sameSource = state.highlights.filter((highlight) => highlight.sourceKey === sourceKey);
    const exact = sameSource.find(
      (highlight) => highlight.start === pending.start && highlight.end === pending.end,
    );
    const overlaps = sameSource.some(
      (highlight) => highlight !== exact && pending.start < highlight.end && pending.end > highlight.start,
    );
    if (overlaps) return toast("所选文字与已有高亮重叠，请调整选区");
    if (exact) exact.color = button.dataset.highlightColor;
    else
      state.highlights.push({
        id: crypto.randomUUID(),
        sourceKey,
        start: pending.start,
        end: pending.end,
        text: pending.text,
        color: button.dataset.highlightColor,
        createdAt: new Date().toISOString(),
      });
    saveState(state);
    renderArticleContent(current);
    getSelection()?.removeAllRanges();
    hideSelectionMenu(true);
    toast(exact ? "已更新高亮颜色" : "已添加高亮");
  };
});
$("#copy-selection").onclick = async () => {
  if (!pending?.text) return;
  try {
    await navigator.clipboard.writeText(pending.text);
    toast("已复制所选文字");
  } catch {
    toast("复制失败，请使用系统复制快捷键");
  }
  hideSelectionMenu();
};
$("#archive-selection").onclick = async () => {
  if (!pending || !current) return;
  const anchor =
    current.origin === "personal"
      ? await createMarkdownSourceAnchor({
          markdown: current.content,
          revision: current.editedAt || 1,
          root: $("#article-content"),
          selection: restoreReadingSelection(),
        })
      : await createTextSourceAnchor({
          sourceText: $("#article-content").innerText,
          sourceRevision: current.editedAt || 1,
          start: pending.start,
          end: pending.end,
        });
  if (!anchor) return toast("无法建立稳定来源锚点，请重新选择一段连续文字");
  openArchive({ anchor, type: "excerpt", title: pending.text.slice(0, 40) });
};
$("#archive-success-close").onclick = () => ($("#archive-success").hidden = true);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const open = [...document.querySelectorAll(".modal:not([hidden])")].at(-1);
  if (open) {
    open.hidden = true;
    event.preventDefault();
  }
});

init();
