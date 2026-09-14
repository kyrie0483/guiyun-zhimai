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
  assert.match(styles, /\.modal \.edge-create-form>\.edge-form-body\{display:grid!important/);
  assert.match(styles, /\.ai-model-grid\{display:grid;grid-template-columns:1fr 1fr/);
});
