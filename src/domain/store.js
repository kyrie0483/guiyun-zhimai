const STORAGE_KEY = "zhihu-reading-network:v2";
const LEGACY_STORAGE_KEY = "zhihu-reading-network:v1";

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
  return { version: 2, activeNetworkId: network.id, networks: [network], sources: [], highlights: [] };
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
  return { version: 2, activeNetworkId: network.id, networks: [network], sources: [], highlights: [] };
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
}

export function resetState(storage = localStorage) {
  storage.removeItem(STORAGE_KEY);
  storage.removeItem(LEGACY_STORAGE_KEY);
}
