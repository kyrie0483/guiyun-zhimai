import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createAiClient } from "../src/server/ai-client.mjs";
import { createTrialQuotaStore } from "../src/server/ai-quota.mjs";

const prepared = {
  system: "只输出 JSON",
  user: JSON.stringify({ nodes: [{ id: "n1", title: "节点" }] }),
};

function modelResponse(result, usage = { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(result) } }],
    usage,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("自带 Key 只发送到固定供应商且不消耗站点额度", async () => {
  let requested;
  const quota = {
    configured: true,
    limit: 20_000,
    reserve() { throw new Error("自带 Key 不应预留站点额度"); },
    adjust() { throw new Error("自带 Key 不应调整站点额度"); },
    async status() { return { limit: 20_000, used: 0, remaining: 20_000 }; },
  };
  const ai = createAiClient({
    trial: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "site-secret", maxOutputTokens: 2_000 },
    quota,
    fetchImpl: async (url, options) => {
      requested = { url, options };
      return modelResponse({ note: "总结" });
    },
  });
  const response = await ai.assist({
    ai: { mode: "own", provider: "deepseek", model: "deepseek-v4-flash", apiKey: "user-secret" },
    prepared,
    validateResult: value => value,
  }, null);
  assert.equal(requested.url, "https://api.deepseek.com/chat/completions");
  assert.equal(requested.options.headers.Authorization, "Bearer user-secret");
  assert.equal(response.ai.mode, "own");
  assert.equal(JSON.stringify(response).includes("user-secret"), false);
});

test("OpenAI Next 使用官方兼容地址且不回传 API Key", async () => {
  let requested;
  const quota = {
    configured: false,
    async status() { return { limit: 0, used: 0, remaining: 0 }; },
  };
  const ai = createAiClient({
    trial: { provider: "openai-next", model: "gpt-5.6-sol", apiKey: "", maxOutputTokens: 2_000 },
    quota,
    fetchImpl: async (url, options) => {
      requested = { url, options };
      return modelResponse({ note: "已生成归档说明", edges: [] });
    },
  });
  const response = await ai.assist({
    ai: { mode: "own", provider: "openai-next", model: "gpt-5.6-sol", apiKey: "next-secret" },
    prepared,
    validateResult: value => value,
  }, null);
  const requestBody = JSON.parse(requested.options.body);
  assert.equal(requested.url, "https://api.openai-next.com/v1/chat/completions");
  assert.equal(requested.options.headers.Authorization, "Bearer next-secret");
  assert.equal(requestBody.model, "gpt-5.6-sol");
  assert.equal(requestBody.stream, false);
  assert.equal(JSON.stringify(response).includes("next-secret"), false);
  assert.equal(ai.providers().some(provider => provider.id === "openai-next"), true);
});

test("站点试用要求登录并按真实 usage 校准预留额度", async () => {
  const events = [];
  const quota = {
    configured: true,
    limit: 20_000,
    async reserve(uid, amount) { events.push(["reserve", uid, amount]); },
    async adjust(uid, amount) { events.push(["adjust", uid, amount]); },
    async status() { return { limit: 20_000, used: 30, remaining: 19_970 }; },
  };
  const ai = createAiClient({
    trial: { provider: "qwen", model: "qwen3.8-flash", apiKey: "site-secret", maxOutputTokens: 2_000 },
    quota,
    fetchImpl: async () => modelResponse({ edges: [] }),
  });
  await assert.rejects(
    ai.assist({ ai: { mode: "trial" }, prepared, validateResult: value => value }, null),
    error => error.code === "AUTH_REQUIRED",
  );
  const response = await ai.assist(
    { ai: { mode: "trial" }, prepared, validateResult: value => value },
    { uid: "zhihu-user-1" },
  );
  assert.equal(events[0][0], "reserve");
  assert.equal(events[1][0], "adjust");
  assert.equal(events[0][2] + events[1][2], 30);
  assert.deepEqual(response.ai.quota, { limit: 20_000, used: 30, remaining: 19_970 });
});

test("归云 Harness 会对无效结构执行一次模型纠错", async () => {
  let calls = 0;
  const ai = createAiClient({
    trial: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "site-secret", maxOutputTokens: 1_000 },
    quota: { configured: true, reserve() {}, adjust() {}, async status() { return { limit: 20_000, used: 80, remaining: 19_920 }; } },
    fetchImpl: async () => {
      calls += 1;
      return modelResponse(calls === 1 ? { wrong: true } : { note: "修复后的总结" });
    },
  });
  const response = await ai.assist({
    ai: { mode: "own", provider: "deepseek", model: "deepseek-v4-flash", apiKey: "user-secret" },
    prepared: { ...prepared, repair: "请重写完整 JSON", harnessVersion: "guiyun-harness@2", systemPromptVersion: "system@2", intent: "net_summarize", skill: { id: "draft-network", version: "1.5.1" } },
    validateResult(value) {
      if (typeof value.note !== "string") {
        const error = new Error("invalid");
        error.code = "AI_RESPONSE_INVALID";
        throw error;
      }
      return value;
    },
  }, null);
  assert.equal(calls, 2);
  assert.equal(response.result.note, "修复后的总结");
  assert.equal(response.ai.repaired, true);
  assert.equal(response.ai.prompt.skill.version, "1.5.1");
});

test("AI 对话复用供应商配置并过滤伪造来源编号", async () => {
  const ai = createAiClient({
    trial: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "site-secret", maxOutputTokens: 1_000 },
    quota: { configured: true, reserve() {}, adjust() {}, async status() { return { limit: 20_000, used: 0, remaining: 20_000 }; } },
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: "依据来自节点 [S1]，伪造来源 [S99]。" } }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    }), { status: 200 }),
  });
  const response = await ai.chat({
    ai: { mode: "own", provider: "deepseek", model: "deepseek-v4-flash", apiKey: "user-secret" },
    prepared: {
      system: "回答问题", user: "问题", intent: "net_answer",
      sourceReferenceIds: new Set(["S1"]),
      sourceCatalog: [{ id: "S1", title: "节点 A", nodeId: "node-a" }],
      harnessVersion: "guiyun-harness@2", systemPromptVersion: "system@2", skill: { id: "chat", version: "1.5.0" },
    },
  }, null);
  assert.match(response.message, /\[S1\]/);
  assert.doesNotMatch(response.message, /\[S99\]/);
  assert.deepEqual(response.citations, [{ id: "S1", title: "节点 A", nodeId: "node-a" }]);
  assert.equal(response.ai.prompt.skill.version, "1.5.0");
  assert.equal(JSON.stringify(response).includes("user-secret"), false);
});

test("翻译破坏 Markdown 结构时自动纠错一次", async () => {
  let calls = 0;
  const ai = createAiClient({
    trial: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "site-secret", maxOutputTokens: 1_000 },
    quota: { configured: true, reserve() {}, adjust() {}, async status() { return { limit: 20_000, used: 0, remaining: 20_000 }; } },
    fetchImpl: async () => {
      calls += 1;
      const content = calls === 1 ? "The code is single-use." : "The code is single-use.\n\n- Keep the list";
      return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 30 } }), { status: 200 });
    },
  });
  const response = await ai.chat({
    ai: { mode: "own", provider: "deepseek", model: "deepseek-v4-flash", apiKey: "user-secret" },
    prepared: {
      system: "翻译", user: "原文", intent: "translate",
      sourceReferenceIds: new Set(), sourceCatalog: [],
      translationContract: { lineKinds: ["text", "blank", "unordered-list"], protectedLines: [], protectedFragments: [], repair: "保持三行结构" },
      harnessVersion: "guiyun-harness@2", systemPromptVersion: "system@2", skill: { id: "chat", version: "1.5.0" },
    },
  }, null);
  assert.equal(calls, 2);
  assert.equal(response.message, "The code is single-use.\n\n- Keep the list");
  assert.equal(response.ai.repaired, true);
});

test("额度存储用原子脚本拒绝超额且不暴露知乎 UID", async () => {
  const commands = [];
  const store = createTrialQuotaStore({
    restUrl: "https://example.upstash.io",
    restToken: "redis-secret",
    limit: 100,
    fetchImpl: async (_url, options) => {
      const command = JSON.parse(options.body);
      commands.push(command);
      return new Response(JSON.stringify({ result: command[0] === "EVAL" ? [-1, 90] : "90" }), { status: 200 });
    },
  });
  await assert.rejects(store.reserve("raw-zhihu-uid", 20), error => error.code === "AI_TRIAL_EXHAUSTED");
  assert.equal(JSON.stringify(commands).includes("raw-zhihu-uid"), false);
  assert.equal(commands[0][0], "EVAL");
});

test("节点、关系与 AI 设置弹窗保持纵向清晰布局", async () => {
  const [html, script, styles] = await Promise.all([
    readFile(new URL("../network.html", import.meta.url), "utf8"),
    readFile(new URL("../src/network-app.js", import.meta.url), "utf8"),
    readFile(new URL("../assets/styles/ui.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /补充理由或依据/);
  assert.match(html, /例如：OAuth 回调安全/);
  assert.match(script, /<h2>AI 设置<\/h2>/);
  assert.match(script, /自带 API Key/);
  assert.match(script, /function ensureAiConfigured\(resume\)/);
  assert.match(script, /请输入 API Key，保存后将自动继续/);
  assert.match(script, /if\(resume\)queueMicrotask\(resume\)/);
  assert.match(script, /fallbackProvider=aiConfig\.providers\.some\(item=>item\.id==="openai-next"\)/);
  assert.match(styles, /\.modal \.edge-create-form>\.edge-form-body\{display:grid!important/);
  assert.match(styles, /\.ai-model-grid\{display:grid;grid-template-columns:1fr 1fr/);
});
