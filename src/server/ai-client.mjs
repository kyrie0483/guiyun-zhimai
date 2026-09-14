import { AppError, parseStructuredModelOutput } from "./zhihu-client.mjs";
import { guiyunPromptMetadata } from "./ai-prompts.mjs";

export const AI_PROVIDERS = {
  qwen: {
    name: "Qwen（阿里云百炼）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3.8-flash", "qwen3.7-plus", "qwen3.8-max"],
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  },
  kimi: {
    name: "Kimi（月之暗面）",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["kimi-k2.6", "kimi-k2.7-code", "kimi-k3"],
  },
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com",
    models: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
  },
  "openai-next": {
    name: "OpenAI Next（兼容协议）",
    baseUrl: "https://api.openai-next.com/v1",
    models: ["gpt-5.6-sol", "gpt-6-astra", "deepseek-v4-flash"],
  },
};

function estimateTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let tokens = 0;
  let asciiRun = 0;
  const flush = () => {
    if (!asciiRun) return;
    tokens += Math.ceil(asciiRun / 3.2);
    asciiRun = 0;
  };
  for (const character of text) {
    if (character.codePointAt(0) <= 127) asciiRun += 1;
    else {
      flush();
      tokens += 1;
    }
  }
  flush();
  return tokens + 24;
}

function cleanModel(provider, requested) {
  const definition = AI_PROVIDERS[provider];
  if (!definition) throw new AppError("AI_PROVIDER_INVALID", "不支持这个 AI 供应商。", 400);
  return definition.models.includes(String(requested)) ? String(requested) : definition.models[0];
}

function providerError(status) {
  if ([401, 403].includes(status)) return "API Key 无效或没有所选模型权限。";
  if (status === 402) return "API 账户余额不足。";
  if (status === 429) return "供应商请求过于频繁或额度已用尽。";
  return "模型服务拒绝了请求，请检查模型配置。";
}

function mergeUsage(one = {}, two = {}) {
  const add = (left, right) => left === undefined && right === undefined ? undefined : (Number(left) || 0) + (Number(right) || 0);
  return {
    inputTokens: add(one.inputTokens, two.inputTokens),
    outputTokens: add(one.outputTokens, two.outputTokens),
    totalTokens: add(one.totalTokens, two.totalTokens),
  };
}

function isStructuredOutputError(error) {
  return ["AI_RESPONSE_INVALID", "ZHIHU_RESPONSE_INVALID"].includes(error?.code);
}

function chatPath(provider) {
  return provider === "deepseek" ? "/chat/completions" : "/chat/completions";
}

function visibleChatAnswer(value, allowedSourceIds) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 100_000) throw new AppError("AI_RESPONSE_INVALID", "模型没有返回可展示的回答。", 502);
  const used = new Set();
  const markdown = text.replace(/\[S(\d+)\]/gu, marker => {
    if (!allowedSourceIds.has(marker.slice(1, -1))) return "";
    used.add(marker.slice(1, -1));
    return marker;
  });
  return { markdown, usedSourceIds: used };
}

function markdownLineKind(line) {
  if (!line.trim()) return "blank";
  const fence = line.match(/^\s*(\x60{3,}|~{3,})/u);
  if (fence) return "fence:" + fence[1][0];
  const heading = line.match(/^\s*(#{1,6})\s/u);
  if (heading) return "heading:" + heading[1].length;
  if (/^\s*[-*+]\s+/u.test(line)) return "unordered-list";
  if (/^\s*\d+[.)]\s+/u.test(line)) return "ordered-list";
  if (/^\s*>\s?/u.test(line)) return "blockquote";
  return "text";
}

function translationMatches(markdown, contract) {
  if (!contract) return true;
  const normalized = String(markdown ?? "").replace(/\r\n?/gu, "\n").trim();
  const lines = normalized.split("\n");
  if (JSON.stringify(lines.map(markdownLineKind)) !== JSON.stringify(contract.lineKinds)) return false;
  if (contract.protectedLines.some(item => lines[item.index] !== item.value)) return false;
  return contract.protectedFragments.every(fragment => normalized.includes(fragment));
}

async function callCompatible({ provider, model, apiKey, messages, maxOutputTokens, fetchImpl }) {
  const baseUrl = AI_PROVIDERS[provider].baseUrl.replace(/\/+$/u, "");
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${chatPath(provider)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(provider === "kimi"
          ? { max_completion_tokens: maxOutputTokens }
          : { max_tokens: maxOutputTokens, temperature: 0.2 }),
        ...(provider === "deepseek" ? { thinking: { type: "disabled" } } : {}),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError";
    throw new AppError("AI_PROVIDER_UNAVAILABLE", timedOut ? "模型响应超时，请稍后重试。" : "无法连接模型服务。", 502);
  }
  const text = await response.text();
  if (text.length > 2_000_000) throw new AppError("AI_RESPONSE_INVALID", "模型返回内容超过安全上限。", 502);
  if (!response.ok) throw new AppError("AI_PROVIDER_REJECTED", providerError(response.status), 502);
  let payload;
  try { payload = JSON.parse(text); } catch { throw new AppError("AI_RESPONSE_INVALID", "模型返回内容无法解析。", 502); }
  const content = payload.choices?.[0]?.message?.content;
  return {
    text: typeof content === "string" ? content : Array.isArray(content) ? content.map(part => part?.text ?? "").join("") : "",
    usage: {
      inputTokens: Number(payload.usage?.prompt_tokens) || undefined,
      outputTokens: Number(payload.usage?.completion_tokens) || undefined,
      totalTokens: Number(payload.usage?.total_tokens) || undefined,
    },
  };
}

async function callOpenAi({ model, apiKey, messages, maxOutputTokens, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: messages, max_output_tokens: maxOutputTokens, store: false }),
      redirect: "error",
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError";
    throw new AppError("AI_PROVIDER_UNAVAILABLE", timedOut ? "模型响应超时，请稍后重试。" : "无法连接模型服务。", 502);
  }
  const text = await response.text();
  if (!response.ok) throw new AppError("AI_PROVIDER_REJECTED", providerError(response.status), 502);
  let payload;
  try { payload = JSON.parse(text); } catch { throw new AppError("AI_RESPONSE_INVALID", "模型返回内容无法解析。", 502); }
  const output = (payload.output ?? []).flatMap(item => item.content ?? []).filter(item => item.type === "output_text").map(item => item.text ?? "").join("");
  return { text: output, usage: { inputTokens: Number(payload.usage?.input_tokens) || undefined, outputTokens: Number(payload.usage?.output_tokens) || undefined, totalTokens: Number(payload.usage?.total_tokens) || undefined } };
}

export function createAiClient({ trial, quota, fetchImpl = fetch }) {
  const maxOutputTokens = Math.min(8_192, Math.max(256, trial.maxOutputTokens));

  return {
    providers() {
      return Object.entries(AI_PROVIDERS).map(([id, value]) => ({ id, name: value.name, models: value.models }));
    },
    promptMetadata() { return guiyunPromptMetadata(); },
    trialAvailable: Boolean(trial.apiKey && quota.configured),
    async quota(uid) { return quota.status(uid); },
    async assist(input, session) {
      const mode = input?.ai?.mode === "own" ? "own" : "trial";
      let provider, model, apiKey, reservation = 0;
      if (mode === "own") {
        provider = String(input?.ai?.provider ?? "");
        model = cleanModel(provider, input?.ai?.model);
        apiKey = String(input?.ai?.apiKey ?? "").trim();
        if (!apiKey || apiKey.length > 1_000) throw new AppError("AI_KEY_REQUIRED", "请输入当前供应商的 API Key。", 400);
      } else {
        if (!session) throw new AppError("AUTH_REQUIRED", "使用站点试用额度前，请先登录知乎。", 401);
        provider = String(trial.provider);
        model = cleanModel(provider, trial.model);
        apiKey = trial.apiKey;
        if (!apiKey) throw new AppError("AI_TRIAL_NOT_CONFIGURED", "站点试用尚未开放，请配置自己的 API Key。", 503);
      }

      const { prepared, validateResult } = input;
      const messages = [{ role: "system", content: prepared.system }, { role: "user", content: prepared.user }];
      const estimatedInput = estimateTokens(messages);
      if (estimatedInput > 30_000) throw new AppError("AI_INPUT_TOO_LARGE", "本次 AI 输入过长，请减少节点或说明内容。", 413);
      if (mode === "trial") {
        reservation = estimatedInput * 2 + maxOutputTokens * 2;
        await quota.reserve(session.uid, reservation);
      }
      try {
        const generate = currentMessages => provider === "openai"
          ? callOpenAi({ model, apiKey, messages: currentMessages, maxOutputTokens, fetchImpl })
          : callCompatible({ provider, model, apiKey, messages: currentMessages, maxOutputTokens, fetchImpl });
        let generated = await generate(messages), parsed = parseStructuredModelOutput(generated.text), validated, repaired = false, fallbackActual = estimatedInput + estimateTokens(generated.text);
        try {
          if (!parsed) throw new AppError("AI_RESPONSE_INVALID", "模型没有返回有效的结构化结果。", 502);
          validated = validateResult(parsed);
        } catch (error) {
          if (!prepared.repair || !isStructuredOutputError(error)) throw error;
          const repairMessages = [...messages, { role: "assistant", content: generated.text.slice(0, 30_000) }, { role: "user", content: prepared.repair }];
          if (estimateTokens(repairMessages) > 30_000) throw new AppError("AI_RESPONSE_INVALID", "模型草案过长，无法安全纠错。", 502);
          const corrected = await generate(repairMessages);
          parsed = parseStructuredModelOutput(corrected.text);
          if (!parsed) throw new AppError("AI_RESPONSE_INVALID", "模型连续两次未返回有效的结构化结果。", 502);
          validated = validateResult(parsed);
          fallbackActual += estimateTokens(repairMessages) + estimateTokens(corrected.text);
          generated = { text: corrected.text, usage: mergeUsage(generated.usage, corrected.usage) };
          repaired = true;
        }
        const actual = generated.usage.totalTokens ?? fallbackActual;
        if (mode === "trial") {
          const adjustment = actual - reservation;
          reservation = 0;
          await quota.adjust(session.uid, adjustment);
        }
        return {
          demo: false,
          result: validated,
          ai: {
            mode,
            provider,
            model,
            repaired,
            prompt: {
              harness: prepared.harnessVersion,
              system: prepared.systemPromptVersion,
              skill: prepared.skill,
              intent: prepared.intent,
            },
            usage: { ...generated.usage, totalTokens: actual },
            ...(mode === "trial" ? { quota: await quota.status(session.uid) } : {}),
          },
        };
      } catch (error) {
        if (mode === "trial" && reservation) await quota.adjust(session.uid, -reservation).catch(() => {});
        throw error;
      }
    },
    async chat(input, session) {
      const mode = input?.ai?.mode === "own" ? "own" : "trial";
      let provider, model, apiKey, reservation = 0;
      if (mode === "own") {
        provider = String(input?.ai?.provider ?? "");
        model = cleanModel(provider, input?.ai?.model);
        apiKey = String(input?.ai?.apiKey ?? "").trim();
        if (!apiKey || apiKey.length > 1_000) throw new AppError("AI_KEY_REQUIRED", "请输入当前供应商的 API Key。", 400);
      } else {
        if (!session) throw new AppError("AUTH_REQUIRED", "使用站点试用额度前，请先登录知乎。", 401);
        provider = String(trial.provider);
        model = cleanModel(provider, trial.model);
        apiKey = trial.apiKey;
        if (!apiKey) throw new AppError("AI_TRIAL_NOT_CONFIGURED", "站点试用尚未开放，请配置自己的 API Key。", 503);
      }
      const { prepared } = input;
      const messages = [{ role: "system", content: prepared.system }, { role: "user", content: prepared.user }];
      const estimatedInput = estimateTokens(messages);
      if (estimatedInput > 30_000) throw new AppError("AI_INPUT_TOO_LARGE", "本次 AI 输入过长，请减少网络内容或对话历史。", 413);
      if (mode === "trial") {
        reservation = estimatedInput * 2 + maxOutputTokens * 2;
        await quota.reserve(session.uid, reservation);
      }
      try {
        const generate = currentMessages => provider === "openai"
          ? callOpenAi({ model, apiKey, messages: currentMessages, maxOutputTokens, fetchImpl })
          : callCompatible({ provider, model, apiKey, messages: currentMessages, maxOutputTokens, fetchImpl });
        let generated = await generate(messages), repaired = false;
        if (!translationMatches(generated.text, prepared.translationContract)) {
          const repairMessages = [...messages, { role: "assistant", content: generated.text.slice(0, 30_000) }, { role: "user", content: prepared.translationContract.repair }];
          if (estimateTokens(repairMessages) > 30_000) throw new AppError("AI_RESPONSE_INVALID", "译文过长，无法安全纠正格式。", 502);
          const corrected = await generate(repairMessages);
          if (!translationMatches(corrected.text, prepared.translationContract)) throw new AppError("AI_RESPONSE_INVALID", "模型连续两次未能保留 Markdown 结构，请缩短原文后重试。", 502);
          generated = { text: corrected.text, usage: mergeUsage(generated.usage, corrected.usage) };
          repaired = true;
        }
        const answer = visibleChatAnswer(generated.text, prepared.sourceReferenceIds);
        const actual = generated.usage.totalTokens ?? estimatedInput + estimateTokens(generated.text);
        if (mode === "trial") {
          const adjustment = actual - reservation;
          reservation = 0;
          await quota.adjust(session.uid, adjustment);
        }
        const citations = prepared.sourceCatalog.filter(source => answer.usedSourceIds.has(source.id));
        return {
          message: answer.markdown,
          citations,
          ai: {
            mode, provider, model, repaired,
            prompt: { harness: prepared.harnessVersion, system: prepared.systemPromptVersion, skill: prepared.skill, intent: prepared.intent },
            usage: { ...generated.usage, totalTokens: actual },
            ...(mode === "trial" ? { quota: await quota.status(session.uid) } : {}),
          },
        };
      } catch (error) {
        if (mode === "trial" && reservation) await quota.adjust(session.uid, -reservation).catch(() => {});
        throw error;
      }
    },
  };
}
