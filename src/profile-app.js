const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const state = { active: "followees", followees: { items: [], nextOffset: "0", isEnd: false, loaded: false }, contents: { items: [], nextOffset: "0", isEnd: false, loaded: false }, loading: false };

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "请求失败，请稍后重试。");
  return data;
}

function safeHttps(value) { try { const url = new URL(value); return url.protocol === "https:" ? url.href : ""; } catch { return ""; } }
function toast(message) { $("#toast").textContent = message; $("#toast").classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 2200); }

function renderProfile(user) {
  $("#profile-name").textContent = user.name || "知乎用户";
  $("#profile-headline").textContent = user.headline || "在知乎，分享知识、经验和见解。";
  const avatar = safeHttps(user.avatar);
  const node = $("#profile-avatar");
  if (avatar) node.innerHTML = `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(user.name || "知乎用户")}" referrerpolicy="no-referrer" />`;
  else node.textContent = String(user.name || "知").slice(0, 1);
}

function renderList(kind) {
  const page = state[kind];
  const panel = $(`#${kind}-panel`);
  panel.innerHTML = page.items.length ? page.items.map((item) => {
    if (kind === "followees") {
      const avatar = safeHttps(item.avatar);
      const body = `<span class="profile-list-avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="" referrerpolicy="no-referrer" />` : escapeHtml(String(item.name || "知").slice(0, 1))}</span><span class="profile-list-main"><b>${escapeHtml(item.name || "知乎用户")}</b><small>${escapeHtml(item.headline || "知乎用户")}</small></span><span class="profile-list-meta">${Number(item.followerCount || 0).toLocaleString("zh-CN")} 关注者</span>`;
      return item.url ? `<a class="profile-list-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${body}<i>↗</i></a>` : `<article class="profile-list-item">${body}</article>`;
    }
    const body = `<span class="profile-list-type">${escapeHtml(item.type || "创作")}</span><span class="profile-list-main"><b>${escapeHtml(item.title || "未命名创作")}</b><small>${escapeHtml(item.summary || "暂无摘要")}</small></span><span class="profile-list-meta">${Number(item.likeCount || 0).toLocaleString("zh-CN")} 赞同</span>`;
    return item.url ? `<a class="profile-list-item content-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${body}<i>↗</i></a>` : `<article class="profile-list-item content-item">${body}</article>`;
  }).join("") : '<p class="profile-empty">暂时没有可展示的公开信息。</p>';
  $("#load-more").hidden = page.isEnd || !page.nextOffset;
}

async function load(kind, append = false) {
  if (state.loading) return;
  state.loading = true;
  $("#load-more").disabled = true;
  $("#profile-message").textContent = append ? "正在加载更多…" : "正在连接知乎…";
  try {
    const page = state[kind];
    const data = await request(`/api/zhihu/me/${kind}?limit=12&offset=${encodeURIComponent(append ? page.nextOffset : "0")}`);
    page.items = append ? [...page.items, ...data.items] : data.items;
    page.nextOffset = String(data.paging?.NextOffset ?? data.paging?.next_offset ?? "");
    page.isEnd = Boolean(data.paging?.IsEnd ?? data.paging?.is_end ?? !page.nextOffset);
    page.loaded = true;
    $("#profile-message").textContent = "";
    renderList(kind);
  } catch (error) { $("#profile-message").textContent = error.message; }
  finally { state.loading = false; $("#load-more").disabled = false; }
}

async function activate(kind) {
  state.active = kind;
  document.querySelectorAll("[data-tab]").forEach((button) => { const active = button.dataset.tab === kind; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); });
  $("#followees-panel").hidden = kind !== "followees";
  $("#contents-panel").hidden = kind !== "contents";
  if (!state[kind].loaded) await load(kind);
  else renderList(kind);
}

async function init() {
  try {
    const session = await request("/api/auth/session");
    if (!session.user) return location.replace("/?login=required");
    renderProfile(session.user);
    await activate("followees");
  } catch { location.replace("/?login=required"); }
}

document.querySelectorAll("[data-tab]").forEach((button) => button.onclick = () => activate(button.dataset.tab));
$("#load-more").onclick = () => load(state.active, true);
$("#logout").onclick = async () => { try { await request("/api/auth/logout", { method: "POST" }); location.replace("/"); } catch (error) { toast(error.message); } };
init();
