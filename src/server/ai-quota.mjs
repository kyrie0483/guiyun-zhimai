import { createHash } from "node:crypto";
import { AppError } from "./zhihu-client.mjs";

const RESERVE_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local amount = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
if used + amount > limit then return {-1, used} end
local next = redis.call('INCRBY', KEYS[1], amount)
return {next, limit - next}
`;

const ADJUST_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local delta = tonumber(ARGV[1])
local next = used + delta
if next < 0 then next = 0 end
redis.call('SET', KEYS[1], next)
return next
`;

function quotaKey(uid) {
  const digest = createHash("sha256").update(String(uid)).digest("hex");
  return `guiyun-zhimai:ai-trial:v1:${digest}`;
}

export function createTrialQuotaStore({ restUrl, restToken, limit, fetchImpl = fetch } = {}) {
  const configured = Boolean(restUrl && restToken);

  async function command(parts) {
    let response;
    try {
      response = await fetchImpl(String(restUrl).replace(/\/+$/u, ""), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${restToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parts),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError("AI_QUOTA_UNAVAILABLE", "试用额度服务暂时不可用。", 503);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new AppError("AI_QUOTA_UNAVAILABLE", "试用额度服务返回异常。", 503);
    }
    if (!response.ok || payload.error) {
      throw new AppError("AI_QUOTA_UNAVAILABLE", "试用额度服务暂时不可用。", 503);
    }
    return payload.result;
  }

  async function used(uid) {
    if (!configured) return 0;
    const value = await command(["GET", quotaKey(uid)]);
    return Math.max(0, Number(value) || 0);
  }

  return {
    configured,
    limit,

    async status(uid) {
      const consumed = await used(uid);
      return { limit, used: consumed, remaining: Math.max(0, limit - consumed) };
    },

    async reserve(uid, amount) {
      if (!configured) {
        throw new AppError(
          "AI_TRIAL_NOT_CONFIGURED",
          "站点试用尚未配置持久化额度服务，请改用自己的 API Key。",
          503,
        );
      }
      const result = await command([
        "EVAL",
        RESERVE_SCRIPT,
        1,
        quotaKey(uid),
        Math.max(1, Math.ceil(amount)),
        limit,
      ]);
      if (!Array.isArray(result) || Number(result[0]) < 0) {
        throw new AppError("AI_TRIAL_EXHAUSTED", "你的站点 AI 试用额度已用完，请配置自己的 API Key。", 429);
      }
      return Number(result[0]);
    },

    async adjust(uid, delta) {
      if (!configured || !delta) return;
      await command(["EVAL", ADJUST_SCRIPT, 1, quotaKey(uid), Math.trunc(delta)]);
    },
  };
}
