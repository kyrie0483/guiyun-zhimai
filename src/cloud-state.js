import { saveState, setStateSaveListener } from "./domain/store.js";

function newer(left, right) {
  return String(left?.deletedAt ?? left?.updatedAt ?? left?.createdAt ?? "") >= String(right?.deletedAt ?? right?.updatedAt ?? right?.createdAt ?? "") ? left : right;
}

function mergeById(local = [], remote = []) {
  const values = new Map(remote.filter(Boolean).map((item) => [item.id, item]));
  for (const item of local.filter(Boolean)) values.set(item.id, values.has(item.id) ? newer(item, values.get(item.id)) : item);
  return [...values.values()];
}

function mergeChats(local = {}, remote = {}) {
  const output = {};
  for (const networkId of new Set([...Object.keys(remote), ...Object.keys(local)])) {
    output[networkId] = mergeById(local[networkId], remote[networkId]).slice(0, 20);
  }
  return output;
}

export function mergeUserStates(local, remote) {
  if (!remote?.networks?.length) return structuredClone(local);
  if (!local?.networks?.length) return structuredClone(remote);
  const mergedNetworks = mergeById(local.networks, remote.networks);
  const mergedTrash = mergeById(local.trash, remote.trash);
  const trashById = new Map(mergedTrash.map((item) => [item.id, item]));
  const networkById = new Map(mergedNetworks.map((item) => [item.id, item]));
  const networks = mergedNetworks.filter((item) => {
    const deleted = trashById.get(item.id);
    return !deleted || String(item.updatedAt ?? item.createdAt ?? "") > String(deleted.deletedAt ?? deleted.updatedAt ?? "");
  });
  const trash = mergedTrash.filter((item) => {
    const restored = networkById.get(item.id);
    return !restored || String(item.deletedAt ?? item.updatedAt ?? "") >= String(restored.updatedAt ?? restored.createdAt ?? "");
  });
  if (!networks.length) return structuredClone(local.networks?.length ? local : remote);
  const activeNetworkId = networks.some((item) => item.id === local.activeNetworkId)
    ? local.activeNetworkId
    : networks.some((item) => item.id === remote.activeNetworkId) ? remote.activeNetworkId : networks[0].id;
  return {
    version: 2,
    activeNetworkId,
    networks,
    trash,
    sources: mergeById(local.sources, remote.sources),
    highlights: mergeById(local.highlights, remote.highlights),
    chats: mergeChats(local.chats, remote.chats),
  };
}

export async function connectUserState(localState, { fetchImpl = fetch, onState = () => {}, onStatus = () => {} } = {}) {
  setStateSaveListener(null);
  let revision = 0;
  let active = false;
  let timer;
  let pending;

  async function api(url, options) {
    const response = await fetchImpl(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error?.message ?? "云端同步失败。"), { status: response.status, code: payload.error?.code });
    return payload;
  }

  async function push(snapshot, retry = true) {
    if (!active) return;
    try {
      const saved = await api("/api/user/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: snapshot, expectedRevision: revision }),
        credentials: "same-origin",
      });
      revision = saved.revision;
      onStatus("cloud-saved");
    } catch (error) {
      if (retry && error.status === 409) {
        const latest = await api("/api/user/state", { credentials: "same-origin" });
        revision = latest.revision;
        const merged = mergeUserStates(snapshot, latest.state);
        active = false;
        onState(merged);
        saveState(merged);
        active = true;
        return push(merged, false);
      }
      onStatus("cloud-error", error);
    }
  }

  function schedule(snapshot) {
    if (!active) return;
    pending = snapshot;
    clearTimeout(timer);
    timer = setTimeout(() => { const value = pending; pending = null; void push(value); }, 450);
  }

  try {
    const session = await api("/api/auth/session", { credentials: "same-origin" });
    if (!session.user) return { state: localState, cloud: false, reason: "anonymous" };
    const remote = await api("/api/user/state", { credentials: "same-origin" });
    revision = remote.revision;
    const state = mergeUserStates(localState, remote.state);
    saveState(state);
    active = true;
    setStateSaveListener(schedule);
    if (!remote.state || JSON.stringify(state) !== JSON.stringify(remote.state)) await push(state);
    onStatus("cloud-ready");
    return { state, cloud: true, revision };
  } catch (error) {
    onStatus("local-only", error);
    return { state: localState, cloud: false, reason: error.code ?? "unavailable" };
  }
}
