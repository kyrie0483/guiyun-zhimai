const STORAGE_KEY = "zhihu-reading-network:v2";
const LEGACY_STORAGE_KEY = "zhihu-reading-network:v1";
let saveListener = null;

export function createNetwork({ id, name = "未命名网络", now = new Date().toISOString() } = {}) {
  return {
    id: id ?? crypto.randomUUID(),
    name: String(name).trim() || "未命名网络",
    nodes: [],
    edges: [],
    proposals: [],
    summary: "",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function createInitialState(options = {}) {
  const network = createNetwork({ ...options, name: options.name ?? "默认网络" });
  return { version: 2, activeNetworkId: network.id, networks: [network], trash: [], sources: [], highlights: [], chats: {} };
}

export function migrateLegacyState(legacy, options = {}) {
  if (!legacy || legacy.version !== 1) return createInitialState(options);
  const now = options.now ?? new Date().toISOString();
  const network = {
    ...createNetwork({ id: options.id, name: "默认网络", now }),
    nodes: Array.isArray(legacy.nodes) ? legacy.nodes : [],
    edges: Array.isArray(legacy.edges) ? legacy.edges : [],
    proposals: Array.isArray(legacy.proposals) ? legacy.proposals : [],
    summary: typeof legacy.summary === "string" ? legacy.summary : "",
  };
  return { version: 2, activeNetworkId: network.id, networks: [network], trash: [], sources: [], highlights: [], chats: {} };
}

function isValidState(state) {
  return state?.version === 2 && Array.isArray(state.networks) && state.networks.length > 0;
}

export function loadState(storage = localStorage) {
  try {
    const state = JSON.parse(storage.getItem(STORAGE_KEY));
    if (isValidState(state)) {
      if (!Array.isArray(state.sources)) state.sources = [];
      if (!Array.isArray(state.highlights)) state.highlights = [];
      if (!Array.isArray(state.trash)) state.trash = [];
      if (!state.chats || typeof state.chats !== "object" || Array.isArray(state.chats)) state.chats = {};
      for (const network of state.networks) if (!Number.isInteger(network.revision)) network.revision = 1;
      if (!state.networks.some((network) => network.id === state.activeNetworkId)) state.activeNetworkId = state.networks[0].id;
      return state;
    }
  } catch {}
  try {
    const legacy = JSON.parse(storage.getItem(LEGACY_STORAGE_KEY));
    if (legacy?.version === 1) return migrateLegacyState(legacy);
  } catch {}
  return createInitialState();
}

export function saveState(state, storage = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (storage === globalThis.localStorage) saveListener?.(structuredClone(state));
}

export function setStateSaveListener(listener) {
  saveListener = typeof listener === "function" ? listener : null;
}

export function renameNetwork(state, networkId, name) {
  const network = state.networks.find((item) => item.id === networkId);
  if (!network) throw new Error("知识网络不存在。");
  const normalized = String(name ?? "").trim();
  if (!normalized) throw new Error("请输入网络名称。");
  if (state.networks.some((item) => item.id !== networkId && item.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) throw new Error("已经存在同名知识网络。");
  network.name = normalized.slice(0, 60);
  network.revision = (Number(network.revision) || 0) + 1;
  network.updatedAt = new Date().toISOString();
  return network;
}

export function trashNetwork(state, networkId, now = new Date().toISOString()) {
  if (state.networks.length <= 1) throw new Error("至少需要保留一个知识网络。");
  const index = state.networks.findIndex((item) => item.id === networkId);
  if (index < 0) throw new Error("知识网络不存在。");
  const [network] = state.networks.splice(index, 1);
  if (!Array.isArray(state.trash)) state.trash = [];
  state.trash.unshift({ ...network, deletedAt: now });
  if (state.activeNetworkId === networkId) state.activeNetworkId = state.networks[Math.min(index, state.networks.length - 1)].id;
  return network;
}

export function restoreNetwork(state, networkId) {
  const index = (state.trash ?? []).findIndex((item) => item.id === networkId);
  if (index < 0) throw new Error("回收站中没有这个网络。");
  const [stored] = state.trash.splice(index, 1);
  const names = new Set(state.networks.map((item) => item.name.toLocaleLowerCase()));
  let name = stored.name || "恢复的网络";
  let suffix = 2;
  while (names.has(name.toLocaleLowerCase())) name = `${stored.name || "恢复的网络"} (${suffix++})`;
  const network = { ...stored, name, deletedAt: undefined, updatedAt: new Date().toISOString() };
  state.networks.push(network);
  state.activeNetworkId = network.id;
  return network;
}

export function deleteTrashedNetwork(state, networkId) {
  const index = (state.trash ?? []).findIndex((item) => item.id === networkId);
  if (index < 0) throw new Error("回收站中没有这个网络。");
  return state.trash.splice(index, 1)[0];
}

export function resetState(storage = localStorage) {
  storage.removeItem(STORAGE_KEY);
  storage.removeItem(LEGACY_STORAGE_KEY);
}
