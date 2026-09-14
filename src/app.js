import {
  createTextSourceAnchor,
  resolveTextSourceAnchor,
} from "./domain/source-anchor.js";
import { loadState, saveState } from "./domain/store.js";
import { connectUserState } from "./cloud-state.js";
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
let readingAiConfig = { providers: [], trial: { available: false, loginRequired: true } };
let pendingReadingAiAction = null;
const AI_PREFERENCES_KEY = "guiyun-zhimai:ai-preferences:v1";
const AI_SECRETS_KEY = "guiyun-zhimai:ai-session-secrets:v1";
const READING_CHAT_PREFIX = "reading:";
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

function readJsonStorage(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) || "{}") ?? {};
  } catch {
    return {};
  }
}

function readReadingAiSettings() {
  const preferences = readJsonStorage(localStorage, AI_PREFERENCES_KEY);
  const secrets = readJsonStorage(sessionStorage, AI_SECRETS_KEY);
  const fallbackProvider = readingAiConfig.providers.some((item) => item.id === "openai-next")
    ? "openai-next"
    : readingAiConfig.providers[0]?.id || "deepseek";
  const provider = readingAiConfig.providers.some((item) => item.id === preferences.provider)
    ? preferences.provider
    : fallbackProvider;
  const definition = readingAiConfig.providers.find((item) => item.id === provider);
  const preferredModel = preferences.models?.[provider];
  const model = definition?.models.includes(preferredModel)
    ? preferredModel
    : definition?.models[0] || "";
  return {
    mode: preferences.mode === "own" ? "own" : "trial",
    provider,
    model,
    apiKey: String(secrets.apiKeys?.[provider] || ""),
  };
}

function saveReadingAiSettings(settings) {
  const preferences = readJsonStorage(localStorage, AI_PREFERENCES_KEY);
  const secrets = readJsonStorage(sessionStorage, AI_SECRETS_KEY);
  const models = { ...(preferences.models || {}), [settings.provider]: settings.model };
  const apiKeys = { ...(secrets.apiKeys || {}), [settings.provider]: settings.apiKey.trim() };
  localStorage.setItem(AI_PREFERENCES_KEY, JSON.stringify({ mode: settings.mode, provider: settings.provider, models }));
  sessionStorage.setItem(AI_SECRETS_KEY, JSON.stringify({ apiKeys }));
}

function readingAiSelection() {
  const settings = readReadingAiSettings();
  return settings.mode === "own"
    ? { mode: "own", provider: settings.provider, model: settings.model, apiKey: settings.apiKey }
    : { mode: "trial" };
}

function renderReadingAiModels(preferred = "") {
  const provider = readingAiConfig.providers.find((item) => item.id === $("#ai-provider").value);
  const models = provider?.models || [];
  $("#ai-model").innerHTML = models
    .map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`)
    .join("");
  $("#ai-model").value = models.includes(preferred) ? preferred : models[0] || "";
}

function renderReadingTrialStatus() {
  const trial = readingAiConfig.trial;
  if (trial.available && Number.isFinite(trial.remaining)) {
    $("#ai-trial-status").textContent = `剩余 ${Number(trial.remaining).toLocaleString()} / ${Number(trial.limit).toLocaleString()} Token`;
  } else if (trial.available && trial.loginRequired) {
    $("#ai-trial-status").textContent = "登录知乎后可使用";
  } else {
    $("#ai-trial-status").textContent = "站点暂未开放试用，请使用自己的 Key";
  }
}

function syncReadingAiModeFields(mode) {
  $("#ai-own-settings").hidden = mode !== "own";
  $("#ai-trial-status").hidden = mode !== "trial";
}

function openReadingAiSettings() {
  const settings = readReadingAiSettings();
  $("#ai-provider").innerHTML = readingAiConfig.providers
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join("");
  $("#ai-provider").value = settings.provider;
  renderReadingAiModels(settings.model);
  $("#ai-api-key").value = settings.apiKey;
  document.querySelector(`input[name="ai-mode"][value="${settings.mode}"]`).checked = true;
  syncReadingAiModeFields(settings.mode);
  renderReadingTrialStatus();
  $("#ai-settings-dialog").hidden = false;
}

function ensureReadingAiConfigured(resume) {
  const settings = readReadingAiSettings();
  const trialReady = settings.mode === "trial" && readingAiConfig.trial.available && !readingAiConfig.trial.loginRequired;
  const ownReady = settings.mode === "own" && Boolean(settings.apiKey.trim()) && Boolean(settings.model);
  if (trialReady || ownReady) return true;
  pendingReadingAiAction = resume;
  openReadingAiSettings();
  document.querySelector('input[name="ai-mode"][value="own"]').checked = true;
  syncReadingAiModeFields("own");
  if (readingAiConfig.providers.some((item) => item.id === "openai-next")) {
    const currentSettings = readReadingAiSettings();
    $("#ai-provider").value = "openai-next";
    renderReadingAiModels(currentSettings.provider === "openai-next" ? currentSettings.model : "");
  }
  $("#ai-api-key").focus();
  toast("请输入 API Key，保存后将自动继续");
  return false;
}

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
  updateReadingAiContext();
  if (!$("#reading-ai-chat-panel").hidden) renderReadingChat();
  activateMobilePanel("reader");
  $("#reader-view").scrollIntoView({ behavior: "smooth", block: "start" });
}

function readingChatKey(item = current) {
  return `${READING_CHAT_PREFIX}${String(item?.id || "general")}`;
}

function readingChatSessions() {
  state.chats ??= {};
  const key = readingChatKey();
  if (!Array.isArray(state.chats[key]) || !state.chats[key].length) {
    state.chats[key] = [{
      id: crypto.randomUUID(),
      title: "新对话",
      messages: [],
      updatedAt: new Date().toISOString(),
    }];
  }
  return state.chats[key];
}

function activeReadingChat() {
  const sessions = readingChatSessions();
  const id = $("#reading-ai-chat-conversation").value;
  return sessions.find((item) => item.id === id) ?? sessions[0];
}

function saveReadingChats() {
  for (const key of Object.keys(state.chats ?? {})) {
    if (Array.isArray(state.chats[key])) state.chats[key] = state.chats[key].slice(0, 20);
  }
  saveState(state);
}

function updateReadingAiContext() {
  const label = $("#reading-ai-source-label");
  if (label) label.textContent = current ? `当前阅读 · ${current.title}` : "当前阅读";
}

function findReadingSource(sourceId) {
  return state.sources.find((source) => String(source.id) === String(sourceId)) ??
    (String(current?.id) === String(sourceId) ? current : null);
}

function renderReadingChat() {
  const sessions = readingChatSessions();
  const select = $("#reading-ai-chat-conversation");
  const preferred = select.value;
  select.innerHTML = sessions
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title || "新对话")}</option>`)
    .join("");
  select.value = sessions.some((item) => item.id === preferred) ? preferred : sessions[0].id;
  const messages = activeReadingChat().messages ?? [];
  const root = $("#reading-ai-chat-messages");
  root.innerHTML = messages.length
    ? messages.map((item) => `<article class="ai-chat-message ${item.role}"><span>${item.role === "user" ? "你" : "归云助手"}</span><div class="ai-chat-markdown">${markdownToSafeHtml(item.content)}</div>${item.citations?.length ? `<div class="ai-chat-citations">${item.citations.map((source) => `<button type="button" data-chat-source="${escapeHtml(source.nodeId)}">[${escapeHtml(source.id)}] ${escapeHtml(source.title)}</button>`).join("")}</div>` : ""}</article>`).join("")
    : `<div class="ai-chat-empty"><img src="/assets/guiyun-mark.svg" alt=""><b>${current ? "和当前原文聊一聊" : "先打开一篇阅读内容"}</b><p>${current ? "可直接问答、检索阅读资料或翻译；回答不会修改原文。" : "打开左侧内容后，归云助手会围绕原文回答。"}</p></div>`;
  root.querySelectorAll("[data-chat-source]").forEach((button) => {
    button.onclick = () => {
      const source = findReadingSource(button.dataset.chatSource);
      if (!source) return toast("该阅读来源已不存在");
      openItem(source);
      if (innerWidth <= 1050) closeReadingAiChat();
      toast(`已打开「${source.title}」`);
    };
  });
  root.scrollTop = root.scrollHeight;
  updateReadingAiContext();
}

function openReadingAiChat() {
  $("#reading-ai-chat-panel").hidden = false;
  $("#reading-ai-chat-scrim").hidden = false;
  $("#reading-ai-chat-panel").setAttribute("aria-hidden", "false");
  $("#reading-ai-chat-toggle").setAttribute("aria-expanded", "true");
  $("#reading-ai-chat-mobile").setAttribute("aria-expanded", "true");
  renderReadingChat();
  setTimeout(() => $("#reading-ai-chat-input").focus(), 0);
}

function closeReadingAiChat() {
  $("#reading-ai-chat-panel").hidden = true;
  $("#reading-ai-chat-scrim").hidden = true;
  $("#reading-ai-chat-panel").setAttribute("aria-hidden", "true");
  $("#reading-ai-chat-toggle").setAttribute("aria-expanded", "false");
  $("#reading-ai-chat-mobile").setAttribute("aria-expanded", "false");
}

function readingSourcesForIntent(intent) {
  if (intent === "note_answer") return current ? [current] : [];
  if (intent !== "note_search") return [];
  const sources = current && !state.sources.some((item) => item.id === current.id)
    ? [current, ...state.sources]
    : state.sources;
  return sources.slice(0, 24);
}

function toReadingAiSource(source) {
  return {
    id: String(source.id || source.url || source.title),
    title: String(source.title || "未命名阅读资料"),
    content: String(source.content || source.excerpt || ""),
  };
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
  const synced = await connectUserState(state, {
    onState(next) {
      state = next;
      renderPersonalSources();
      updateNetworkEntry();
      if (current) renderArticleContent(current);
      if (!$("#reading-ai-chat-panel").hidden) renderReadingChat();
    },
    onStatus(status) { document.body.dataset.syncStatus = status; },
  });
  state = synced.state;
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
    readingAiConfig = await request("/api/ai/config");
  } catch {}
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

$("#reading-ai-chat-toggle").onclick = () =>
  $("#reading-ai-chat-panel").hidden ? openReadingAiChat() : closeReadingAiChat();
$("#reading-ai-chat-mobile").onclick = () =>
  $("#reading-ai-chat-panel").hidden ? openReadingAiChat() : closeReadingAiChat();
$("#reading-ai-settings").onclick = $("#reading-ai-settings-inline").onclick = () => {
  pendingReadingAiAction = null;
  openReadingAiSettings();
};
$("#ai-settings-close").onclick = $("#ai-settings-cancel").onclick = () => {
  pendingReadingAiAction = null;
  $("#ai-settings-dialog").hidden = true;
};
document.querySelectorAll('input[name="ai-mode"]').forEach((input) => {
  input.onchange = () => syncReadingAiModeFields(input.value);
});
$("#ai-provider").onchange = () => {
  const settings = readReadingAiSettings();
  renderReadingAiModels(settings.provider === $("#ai-provider").value ? settings.model : "");
  $("#ai-api-key").value = readJsonStorage(sessionStorage, AI_SECRETS_KEY).apiKeys?.[$("#ai-provider").value] || "";
};
$("#ai-settings-form").onsubmit = (event) => {
  event.preventDefault();
  const mode = document.querySelector('input[name="ai-mode"]:checked')?.value || "trial";
  const settings = {
    mode,
    provider: $("#ai-provider").value,
    model: $("#ai-model").value,
    apiKey: $("#ai-api-key").value,
  };
  if (mode === "own" && (!settings.apiKey.trim() || !settings.model)) return toast("请完整填写当前供应商的模型和 API Key");
  if (mode === "trial" && (!readingAiConfig.trial.available || readingAiConfig.trial.loginRequired)) {
    return toast(readingAiConfig.trial.loginRequired ? "请先登录知乎，或使用自己的 API Key" : "站点试用暂未开放，请使用自己的 API Key");
  }
  saveReadingAiSettings(settings);
  $("#ai-settings-dialog").hidden = true;
  const resume = pendingReadingAiAction;
  pendingReadingAiAction = null;
  toast(mode === "own" ? "已保存当前标签页的 AI 设置" : "已切换到站点试用");
  if (resume) queueMicrotask(resume);
};
$("#reading-ai-chat-close").onclick = closeReadingAiChat;
$("#reading-ai-chat-scrim").onclick = closeReadingAiChat;
$("#reading-ai-chat-new").onclick = () => {
  const session = {
    id: crypto.randomUUID(),
    title: "新对话",
    messages: [],
    updatedAt: new Date().toISOString(),
  };
  readingChatSessions().unshift(session);
  saveReadingChats();
  renderReadingChat();
  $("#reading-ai-chat-conversation").value = session.id;
  renderReadingChat();
  $("#reading-ai-chat-input").focus();
};
$("#reading-ai-chat-conversation").onchange = renderReadingChat;
$("#reading-ai-chat-intent").onchange = () => {
  const intent = $("#reading-ai-chat-intent").value;
  $("#reading-ai-chat-input").placeholder = intent === "note_search"
    ? "检索已加入的阅读资料，Enter 发送"
    : intent === "translate"
      ? "粘贴或输入要翻译的内容"
      : "围绕当前原文提问，Enter 发送，Shift+Enter 换行";
};
$("#reading-ai-chat-input").onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("#reading-ai-chat-form").requestSubmit();
  }
};
$("#reading-ai-chat-form").onsubmit = async (event) => {
  event.preventDefault();
  const input = $("#reading-ai-chat-input");
  const message = input.value.trim();
  if (!message) return;
  const intent = $("#reading-ai-chat-intent").value;
  if ((intent === "note_answer" || intent === "note_search") && !readingSourcesForIntent(intent).length) {
    return toast(intent === "note_answer" ? "请先打开一篇阅读内容" : "请先加入至少一篇阅读资料");
  }
  if (!ensureReadingAiConfigured(() => $("#reading-ai-chat-form").requestSubmit())) return;
  const selection = readingAiSelection();
  const session = activeReadingChat();
  const button = $("#reading-ai-chat-send");
  const history = session.messages.slice(-12).map((item) => ({ role: item.role, content: item.content }));
  session.messages.push({ role: "user", content: message });
  if (session.title === "新对话") session.title = Array.from(message).slice(0, 18).join("");
  session.updatedAt = new Date().toISOString();
  input.value = "";
  saveReadingChats();
  renderReadingChat();
  button.disabled = true;
  button.textContent = "思考中";
  $("#reading-ai-chat-status").textContent = intent === "note_search" ? "正在检索阅读资料…" : "正在阅读当前内容…";
  try {
    const nodes = readingSourcesForIntent(intent).map(toReadingAiSource);
    const data = await request("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent, message, history, nodes, existingEdges: [], ai: selection }),
    });
    session.messages.push({ role: "assistant", content: data.message, citations: data.citations ?? [], ai: data.ai });
    session.updatedAt = new Date().toISOString();
    if (data.ai?.quota) readingAiConfig.trial = { ...readingAiConfig.trial, ...data.ai.quota };
    saveReadingChats();
    renderReadingChat();
    $("#reading-ai-chat-status").textContent = `${data.ai?.provider || "AI"} · 回答不会修改原文`;
  } catch (error) {
    session.messages.push({ role: "assistant", content: `请求失败：${error.message}`, error: true });
    saveReadingChats();
    renderReadingChat();
    $("#reading-ai-chat-status").textContent = "发送失败，请检查 AI 设置";
  } finally {
    button.disabled = false;
    button.textContent = "发送";
  }
};

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
$("#ask-ai-selection").onclick = () => {
  if (!pending?.text) return;
  const selectedText = pending.text;
  hideSelectionMenu();
  getSelection()?.removeAllRanges();
  $("#reading-ai-chat-intent").value = "note_answer";
  $("#reading-ai-chat-input").value = `请结合原文解释这段内容：\n\n> ${selectedText.replaceAll("\n", "\n> ")}`;
  openReadingAiChat();
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
    pendingReadingAiAction = null;
    event.preventDefault();
    return;
  }
  if (!$("#reading-ai-chat-panel").hidden) {
    closeReadingAiChat();
    $("#reading-ai-chat-toggle").focus();
    event.preventDefault();
    return;
  }
});

init();
