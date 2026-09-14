import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readText = (...parts) => readFileSync(resolve(ROOT, ...parts), "utf8").trim();
const readJson = (...parts) => JSON.parse(readText(...parts));

const SYSTEM_MANIFEST = readJson("ai", "prompts", "system", "manifest.json");
const SYSTEM_PROMPT = readText("ai", "prompts", "system", SYSTEM_MANIFEST.file);
const SKILL_REGISTRY = readJson("ai", "skills", "registry.json");

export const GUIYUN_HARNESS_VERSION = "guiyun-harness@2";

export const NETWORK_TASK_INTENTS = Object.freeze({
  connect: "net_suggest_edges",
  integrate: "net_suggest_edges",
  "summarize-node": "net_summarize_node",
  "summarize-edge": "net_summarize_edge",
  "summarize-network": "net_summarize",
});

function resolveSkill(intent) {
  const skillId = SKILL_REGISTRY.routes[intent];
  if (!skillId) throw new Error(`没有为 ${intent} 配置 AI Skill。`);
  const manifest = readJson("ai", "skills", skillId, "manifest.json");
  if (manifest.id !== skillId || !manifest.intents.includes(intent)) {
    throw new Error(`AI Skill ${skillId} 与意图 ${intent} 不匹配。`);
  }
  return {
    id: skillId,
    version: manifest.version,
    instructions: readText("ai", "skills", skillId, "instructions.md"),
  };
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sourceText(node) {
  return String(node.content || node.excerpt || node.note || "").trim();
}

const CHAT_INTENTS = new Set([
  "general_chat",
  "note_answer",
  "note_search",
  "net_answer",
  "net_search",
  "translate",
]);

function cleanChatText(value, limit) {
  return String(value ?? "").replaceAll("\u0000", "").trim().slice(0, limit);
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

function translationContract(source) {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  let inFence = false;
  const protectedLines = [];
  for (const [index, line] of lines.entries()) {
    if (/^\s*(\x60{3,}|~{3,})/u.test(line)) {
      protectedLines.push({ index, value: line });
      inFence = !inFence;
    } else if (inFence) protectedLines.push({ index, value: line });
  }
  const protectedFragments = [
    ...source.matchAll(/\x60[^\x60\n]+\x60/gu),
    ...source.matchAll(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/gu),
    ...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu),
    ...source.matchAll(/\[S\d+\]/gu),
  ].map(match => match[1] ?? match[0]);
  const lineKinds = lines.map(markdownLineKind);
  return {
    lineKinds,
    protectedLines,
    protectedFragments: [...new Set(protectedFragments)],
    repair: [
      "上一份译文破坏了 Markdown 结构。请重新翻译，并且只输出完整译文。",
      "必须逐行保持此结构签名：" + JSON.stringify(lineKinds) + "。",
      "空行、标题级别、列表项数量、引用层级和代码围栏必须与原文逐行对应；代码、公式、链接目标和 [Sx] 原样保留。",
      "原文：\n" + source,
    ].join("\n"),
  };
}

export function buildGuiyunChatPrompt({ intent = "net_answer", message, nodes = [], edges = [], history = [] }) {
  if (!CHAT_INTENTS.has(intent)) throw new Error("不支持这个归云 AI 对话意图。");
  const skill = resolveSkill(intent);
  const query = cleanChatText(message, 8_000);
  if (!query) throw new Error("请输入要发送的内容。");
  const networkEnabled = intent === "net_answer" || intent === "net_search";
  const readingEnabled = intent === "note_answer" || intent === "note_search";
  const sourceEnabled = networkEnabled || readingEnabled;
  const safeNodes = sourceEnabled ? nodes.slice(0, networkEnabled ? 120 : 24) : [];
  const sourceReferenceIds = new Set();
  const sources = [];
  const sourceCatalog = [];
  for (const node of safeNodes) {
    const body = cleanChatText(sourceText(node), 6_000);
    if (!body) continue;
    const id = `S${sources.length + 1}`;
    sourceReferenceIds.add(id);
    sourceCatalog.push({ id, title: cleanChatText(node.title, 200), nodeId: String(node.id) });
    sources.push(`<source id="${id}" title="${xmlEscape(node.title)}">\n${xmlEscape(body)}\n</source>`);
  }
  const nodeCatalog = safeNodes.map(node => ({ id: String(node.id), title: cleanChatText(node.title, 200) }));
  const nodeIds = new Set(nodeCatalog.map(node => node.id));
  const edgeCatalog = networkEnabled ? edges.slice(0, 240).filter(edge => nodeIds.has(String(edge.sourceNodeId)) && nodeIds.has(String(edge.targetNodeId))).map(edge => ({
    sourceNodeId: String(edge.sourceNodeId), targetNodeId: String(edge.targetNodeId),
    title: cleanChatText(edge.title, 200), relationType: cleanChatText(edge.relationType, 60),
  })) : [];
  const conversation = history.slice(-12).map(item => ({
    role: item?.role === "assistant" ? "assistant" : "user",
    content: cleanChatText(item?.content, 4_000),
  })).filter(item => item.content);
  const translation = intent === "translate" ? translationContract(query) : null;
  const system = [
    SYSTEM_PROMPT,
    `# Active Skill\n${skill.instructions}`,
    `# Harness\n- harness: ${GUIYUN_HARNESS_VERSION}\n- systemPrompt: ${SYSTEM_MANIFEST.version}\n- skill: ${skill.id}@${skill.version}\n- intent: ${intent}`,
    "# 当前对话边界\n只回答，不得声称已经创建、修改或删除网络对象。输出可直接展示的 Markdown 正文，禁止 HTML、JSON/XML 外壳和内部诊断。只能使用允许的 [Sx] 来源编号。",
    ...(translation ? ["# 翻译结构硬约束\n逐行保持结构签名 " + JSON.stringify(translation.lineKinds) + "。不得遗漏任何列表项、空行、标题、引用或代码围栏；代码、公式、链接目标和 [Sx] 必须原样保留。只输出译文。"] : []),
  ].join("\n\n");
  const user = [
    `任务意图：${intent}`,
    conversation.length ? `最近对话：${JSON.stringify(conversation)}` : "最近对话：空",
    networkEnabled
      ? `节点目录：${JSON.stringify(nodeCatalog)}\n关系目录：${JSON.stringify(edgeCatalog)}`
      : readingEnabled
        ? `阅读资料目录：${JSON.stringify(nodeCatalog)}`
        : "本轮未授权访问个人资料或网络内容。",
    `允许引用的来源编号：${JSON.stringify([...sourceReferenceIds])}`,
    sources.length ? `来源表：\n${sources.join("\n")}` : "来源表：空；不得生成来源编号。",
    `用户当前问题：\n${xmlEscape(query)}`,
  ].join("\n\n");
  return { system, user, intent, skill: { id: skill.id, version: skill.version }, systemPromptVersion: SYSTEM_MANIFEST.version, harnessVersion: GUIYUN_HARNESS_VERSION, sourceReferenceIds, sourceCatalog, ...(translation ? { translationContract: translation } : {}) };
}

function taskRules(task) {
  if (task === "integrate") {
    return "每项 operation 至少一端必须标记为 [待整合]；通常为每个待整合节点建议 3～5 条可靠关系，资料不足时宁可少给或不给。";
  }
  if (task === "summarize-node") {
    return "只总结标记为 [总结目标] 的节点；其他节点只可作为明确提供的上下文，不能把它们的事实归给目标节点。";
  }
  if (task === "summarize-edge") {
    return "只总结标记为 [总结目标] 的关系及其两个端点，不臆造方向、强度或因果。";
  }
  if (task === "summarize-network") {
    return "总结当前目录中的网络主题、关键簇、可靠关系与尚未连接部分，不补造目录之外的事实。正文只使用节点标题和关系标题指代对象，绝对不得展示节点 ID、关系 ID、UUID 或其他内部标识符；不要重复目录字段。";
  }
  return "只建议目录中已有节点之间的可靠关系；没有可靠关系时 operations 返回空数组。";
}

function outputContract(intent) {
  if (intent === "net_suggest_edges") {
    return '只输出严格 JSON：{"impactSummary":"非空字符串","sourceReferenceIds":["S1"],"operations":[{"sourceNodeId":"真实ID","targetNodeId":"真实ID","title":"关系短语","note":null,"edgeType":"normal","confidence":0.8,"rationale":"事实依据"}]}。对象和 operation 都不得增加字段。';
  }
  return '只输出严格 JSON：{"note":"Markdown总结","impactSummary":"非空字符串","sourceReferenceIds":["S1"]}。不得增加字段。';
}

export function buildGuiyunNetworkPrompt({
  task,
  nodes,
  edges,
  edgeId,
  targetNodeId,
  candidateNodeIds = new Set(),
}) {
  const intent = NETWORK_TASK_INTENTS[task];
  if (!intent) throw new Error("不支持这个归云 AI 网络任务。");
  const skill = resolveSkill(intent);
  const sourceReferenceIds = new Set();
  const sourceIdByNode = new Map();
  const sourceBlocks = [];
  for (const node of nodes) {
    const text = sourceText(node);
    if (!text) continue;
    const id = `S${sourceBlocks.length + 1}`;
    sourceReferenceIds.add(id);
    sourceIdByNode.set(node.id, id);
    sourceBlocks.push(`<source id="${id}" title="${xmlEscape(node.title)}">\n${xmlEscape(text)}\n</source>`);
  }
  const nodeCatalog = nodes.map((node) => ({
    id: node.id,
    title: node.title,
    ...(candidateNodeIds.has(node.id) ? { marker: "[待整合]" } : {}),
    ...(targetNodeId === node.id ? { target: "[总结目标]" } : {}),
    ...(sourceIdByNode.has(node.id) ? { sourceReferenceId: sourceIdByNode.get(node.id) } : {}),
  }));
  const edgeCatalog = edges.map((edge) => ({
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    title: edge.title,
    relationType: edge.relationType,
    ...(edge.id === edgeId ? { target: "[总结目标]" } : {}),
  }));
  const system = [
    SYSTEM_PROMPT,
    `# Active Skill\n${skill.instructions}`,
    `# Harness\n- harness: ${GUIYUN_HARNESS_VERSION}\n- systemPrompt: ${SYSTEM_MANIFEST.version}\n- skill: ${skill.id}@${skill.version}\n- intent: ${intent}`,
    `# 当前任务附加约束\n${taskRules(task)}\n${outputContract(intent)}`,
  ].join("\n\n");
  const user = [
    `任务意图：${intent}`,
    `节点目录：${JSON.stringify(nodeCatalog)}`,
    `关系目录：${JSON.stringify(edgeCatalog)}`,
    `允许引用的来源编号：${JSON.stringify([...sourceReferenceIds])}`,
    sourceBlocks.length ? `来源表：\n${sourceBlocks.join("\n")}` : "来源表：空；sourceReferenceIds 必须为 []。",
  ].join("\n\n");
  return {
    system,
    user,
    intent,
    skill: { id: skill.id, version: skill.version },
    systemPromptVersion: SYSTEM_MANIFEST.version,
    harnessVersion: GUIYUN_HARNESS_VERSION,
    sourceReferenceIds,
    repair: `上一份输出没有通过服务端校验。请从头重写一个完整对象，不要解释、不要代码围栏。${outputContract(intent)} 只能引用这些来源编号：${JSON.stringify([...sourceReferenceIds])}。`,
  };
}

export function guiyunPromptMetadata() {
  return {
    harness: GUIYUN_HARNESS_VERSION,
    systemPrompt: SYSTEM_MANIFEST.version,
    skills: [...new Set(Object.values(SKILL_REGISTRY.routes))].map((id) => {
      const manifest = readJson("ai", "skills", id, "manifest.json");
      return { id, version: manifest.version };
    }),
  };
}
