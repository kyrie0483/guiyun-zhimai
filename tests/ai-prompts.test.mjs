import assert from "node:assert/strict";
import test from "node:test";

import { buildGuiyunChatPrompt, guiyunPromptMetadata } from "../src/server/ai-prompts.mjs";
import { ZhihuClient } from "../src/server/zhihu-client.mjs";

const nodes = [
  { id: "node-a", title: "节点 A", note: "用户笔记", excerpt: "知乎来源摘录 A" },
  { id: "node-b", title: "节点 B", note: "", excerpt: "知乎来源摘录 B" },
];

test("网络 AI 使用归云 system@2 和 draft-network Skill", () => {
  const metadata = guiyunPromptMetadata();
  assert.equal(metadata.harness, "guiyun-harness@2");
  assert.equal(metadata.systemPrompt, "system@2");
  assert.deepEqual(metadata.skills, [{ id: "chat", version: "1.5.0" }, { id: "draft-network", version: "1.5.1" }]);
  const prepared = new ZhihuClient().prepareExternalAssist({ task: "connect", nodes });
  assert.match(prepared.system, /归云 AI 系统提示词 v2/);
  assert.match(prepared.system, /Draft Network Skill 1\.5\.1/);
  assert.equal(prepared.intent, "net_suggest_edges");
  assert.deepEqual(prepared.skill, { id: "draft-network", version: "1.5.1" });
  assert.match(prepared.user, /<source id="S1"/);
  assert.deepEqual([...prepared.sourceReferenceIds], ["S1", "S2"]);
});

test("AI 对话迁移归云 chat@1.5.0 并建立可点击来源目录", () => {
  const prepared = buildGuiyunChatPrompt({
    intent: "net_answer",
    message: "这两个节点有什么联系？",
    nodes,
    edges: [{ id: "edge-1", sourceNodeId: "node-a", targetNodeId: "node-b", title: "补充", relationType: "supplements" }],
    history: [{ role: "user", content: "先看看网络" }, { role: "assistant", content: "好的" }],
  });
  assert.deepEqual(prepared.skill, { id: "chat", version: "1.5.0" });
  assert.match(prepared.system, /Chat Skill 1\.5\.0/);
  assert.match(prepared.system, /只回答，不得声称已经创建/);
  assert.match(prepared.user, /最近对话/);
  assert.deepEqual(prepared.sourceCatalog.map(source => source.nodeId), ["node-a", "node-b"]);
  assert.deepEqual([...prepared.sourceReferenceIds], ["S1", "S2"]);
});

test("通用对话不会向模型附带网络内容", () => {
  const prepared = buildGuiyunChatPrompt({ intent: "general_chat", message: "你好", nodes });
  assert.match(prepared.user, /本轮未授权访问个人资料或网络内容/);
  assert.doesNotMatch(prepared.user, /知乎来源摘录 A/);
  assert.deepEqual(prepared.sourceCatalog, []);
});

test("阅读 AI 的问答与检索只携带已授权阅读资料", () => {
  const readingSources = [
    { id: "source-current", title: "当前原文", content: "完整正文中的关键事实。", excerpt: "不应覆盖完整正文" },
    { id: "source-other", title: "另一篇资料", content: "补充阅读资料。" },
  ];
  for (const intent of ["note_answer", "note_search"]) {
    const prepared = buildGuiyunChatPrompt({ intent, message: "资料讲了什么？", nodes: readingSources });
    assert.deepEqual(prepared.skill, { id: "chat", version: "1.5.0" });
    assert.match(prepared.user, /阅读资料目录/);
    assert.match(prepared.user, /完整正文中的关键事实/);
    assert.doesNotMatch(prepared.user, /关系目录/);
    assert.deepEqual(prepared.sourceCatalog.map(source => source.nodeId), ["source-current", "source-other"]);
  }
});

test("翻译提示携带逐行 Markdown 结构契约", () => {
  const prepared = buildGuiyunChatPrompt({
    intent: "translate",
    message: "授权码只能使用一次。\n\n- 保留 \x60code\x60 内容\n- 保留第二项",
  });
  assert.deepEqual(prepared.translationContract.lineKinds, ["text", "blank", "unordered-list", "unordered-list"]);
  assert.deepEqual(prepared.translationContract.protectedFragments, ["\x60code\x60"]);
  assert.match(prepared.system, /不得遗漏任何列表项/);
});

test("归云 Skill 严格校验字段、来源白名单和关系端点", () => {
  const client = new ZhihuClient();
  const prepared = client.prepareExternalAssist({ task: "connect", nodes });
  const valid = {
    impactSummary: "将新增一条待确认关系",
    sourceReferenceIds: ["S1", "S2"],
    operations: [{ sourceNodeId: "node-a", targetNodeId: "node-b", title: "相互补充", note: null, edgeType: "normal", confidence: 0.8, rationale: "两份来源讨论同一主题" }],
  };
  const result = client.validateAssist("connect", nodes, valid, { sourceReferenceIds: prepared.sourceReferenceIds });
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].relationType, "related");
  assert.throws(() => client.validateAssist("connect", nodes, { ...valid, extra: true }, { sourceReferenceIds: prepared.sourceReferenceIds }), /Skill 契约/);
  assert.throws(() => client.validateAssist("connect", nodes, { ...valid, sourceReferenceIds: ["S9"] }, { sourceReferenceIds: prepared.sourceReferenceIds }), /无效来源/);
});

test("节点和关系总结目标由 Harness 标记而不是模型决定", () => {
  const client = new ZhihuClient();
  const nodePrompt = client.prepareExternalAssist({ task: "summarize-node", nodes, targetNodeId: "node-b" });
  assert.match(nodePrompt.user, /"target":"\[总结目标\]"/);
  const edges = [{ id: "edge-1", sourceNodeId: "node-a", targetNodeId: "node-b", title: "相关", relationType: "related" }];
  const edgePrompt = client.prepareExternalAssist({ task: "summarize-edge", nodes, existingEdges: edges, edgeId: "edge-1" });
  assert.match(edgePrompt.user, /"target":"\[总结目标\]"/);
});

test("归云网络总结保留 Markdown 行结构", () => {
  const client = new ZhihuClient();
  const result = client.validateAssist("summarize-network", nodes, {
    note: "## 主题\n\n- 结论一\n- 结论二",
    impactSummary: "更新网络说明",
    sourceReferenceIds: ["S1"],
  }, { sourceReferenceIds: new Set(["S1", "S2"]) });
  assert.match(result.note, /\n\n- 结论一\n- 结论二/);
});

test("归云网络总结不向用户暴露内部 UUID", () => {
  const client = new ZhihuClient();
  const uuid = "589f82de-c7b9-4696-aad4-56a169620009";
  const result = client.validateAssist("summarize-network", [{ ...nodes[0], id: uuid }], {
    note: "## 主题\n\n- **节点 A**（589f82de-c7b9-4696-aad4-56a169620009）：摘要",
    impactSummary: "更新网络说明",
    sourceReferenceIds: ["S1"],
  }, { sourceReferenceIds: new Set(["S1"]) });
  assert.doesNotMatch(result.note, /589f82de/);
  assert.match(result.note, /\*\*节点 A\*\*：摘要/);
});
