import { createHash } from "node:crypto";
import { AppError } from "./zhihu-client.mjs";

const SAVE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local current = 0
if raw then
  local ok, record = pcall(cjson.decode, raw)
  if ok and record then current = tonumber(record.revision) or 0 end
end
local expected = tonumber(ARGV[1]) or 0
if current ~= expected then return {0, current} end
local next = current + 1
local state = cjson.decode(ARGV[2])
redis.call('SET', KEYS[1], cjson.encode({revision = next, state = state, updatedAt = ARGV[3]}))
return {1, next}
`;

function stateKey(uid) {
  const digest = createHash("sha256").update(String(uid)).digest("hex");
  return `guiyun-zhimai:user-state:v1:${digest}`;
}

function validateState(value) {
  if (!value || value.version !== 2 || !Array.isArray(value.networks) || !value.networks.length) {
    throw new AppError("USER_STATE_INVALID", "知识网络数据格式无效。", 400);
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > 1_000_000) {
    throw new AppError("USER_STATE_TOO_LARGE", "知识网络数据超过 1 MB，请精简后重试。", 413);
  }
  return serialized;
}

export function createUserDataStore({ restUrl, restToken, fetchImpl = fetch } = {}) {
  const configured = Boolean(restUrl && restToken);

  async function command(parts) {
    if (!configured) throw new AppError("USER_DATA_NOT_CONFIGURED", "云端数据存储尚未配置。", 503);
    let response;
    try {
      response = await fetchImpl(String(restUrl).replace(/\/+$/u, ""), {
        method: "POST",
        headers: { Authorization: `Bearer ${restToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(parts),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError("USER_DATA_UNAVAILABLE", "云端数据存储暂时不可用。", 503);
    }
    let payload;
    try { payload = await response.json(); } catch {
      throw new AppError("USER_DATA_UNAVAILABLE", "云端数据存储返回异常。", 503);
    }
    if (!response.ok || payload.error) throw new AppError("USER_DATA_UNAVAILABLE", "云端数据存储暂时不可用。", 503);
    return payload.result;
  }

  return {
    configured,
    async load(uid) {
      const raw = await command(["GET", stateKey(uid)]);
      if (!raw) return { revision: 0, state: null, updatedAt: null };
      try {
        const record = JSON.parse(raw);
        return { revision: Math.max(0, Number(record.revision) || 0), state: record.state ?? null, updatedAt: record.updatedAt ?? null };
      } catch {
        throw new AppError("USER_DATA_INVALID", "云端知识网络数据无法解析。", 502);
      }
    },
    async save(uid, state, expectedRevision = 0) {
      const serialized = validateState(state);
      const expected = Math.max(0, Number(expectedRevision) || 0);
      const updatedAt = new Date().toISOString();
      const result = await command(["EVAL", SAVE_SCRIPT, 1, stateKey(uid), expected, serialized, updatedAt]);
      if (!Array.isArray(result) || Number(result[0]) !== 1) {
        throw new AppError("USER_STATE_CONFLICT", "云端数据已在其他设备更新，请刷新后重试。", 409);
      }
      return { revision: Number(result[1]), updatedAt };
    },
  };
}
