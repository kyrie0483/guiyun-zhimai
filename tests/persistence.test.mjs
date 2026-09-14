import assert from "node:assert/strict";
import test from "node:test";

import { mergeUserStates } from "../src/cloud-state.js";
import { createInitialState, createNetwork, deleteTrashedNetwork, renameNetwork, restoreNetwork, trashNetwork } from "../src/domain/store.js";
import { createUserDataStore } from "../src/server/user-data-store.mjs";

test("网络支持重命名、移入回收站、恢复和永久删除", () => {
  const state = createInitialState({ id: "one", name: "网络一" });
  state.networks.push(createNetwork({ id: "two", name: "网络二" }));
  renameNetwork(state, "two", "重命名网络");
  assert.equal(state.networks[1].name, "重命名网络");
  trashNetwork(state, "two", "2026-09-14T00:00:00.000Z");
  assert.deepEqual(state.networks.map((item) => item.id), ["one"]);
  assert.equal(state.trash[0].deletedAt, "2026-09-14T00:00:00.000Z");
  restoreNetwork(state, "two");
  assert.equal(state.activeNetworkId, "two");
  trashNetwork(state, "two");
  deleteTrashedNetwork(state, "two");
  assert.equal(state.trash.length, 0);
});

test("本地与云端状态按对象更新时间合并且不丢回收站和对话", () => {
  const local = createInitialState({ id: "shared", name: "本地旧名称", now: "2026-09-13T00:00:00.000Z" });
  local.networks.push(createNetwork({ id: "local-only", name: "仅本地" }));
  local.trash = [{ ...createNetwork({ id: "deleted", name: "已删除" }), deletedAt: "2026-09-14T00:00:00.000Z" }];
  local.chats = { shared: [{ id: "chat-local", messages: [] }] };
  const remote = createInitialState({ id: "shared", name: "云端新名称", now: "2026-09-14T00:00:00.000Z" });
  remote.chats = { remote: [{ id: "chat-remote", messages: [] }] };
  const merged = mergeUserStates(local, remote);
  assert.equal(merged.networks.find((item) => item.id === "shared").name, "云端新名称");
  assert.ok(merged.networks.some((item) => item.id === "local-only"));
  assert.equal(merged.trash[0].id, "deleted");
  assert.ok(merged.chats.shared);
  assert.ok(merged.chats.remote);
});

test("云端删除时间比本地网络更新时不会被旧设备复活", () => {
  const local = createInitialState({ id: "stale", name: "旧设备", now: "2026-09-13T00:00:00.000Z" });
  local.networks.push(createNetwork({ id: "keep", name: "保留网络", now: "2026-09-13T00:00:00.000Z" }));
  const remote = createInitialState({ id: "keep", name: "保留网络", now: "2026-09-13T00:00:00.000Z" });
  remote.trash = [{ ...createNetwork({ id: "stale", name: "已删除", now: "2026-09-13T00:00:00.000Z" }), deletedAt: "2026-09-14T00:00:00.000Z" }];
  const merged = mergeUserStates(local, remote);
  assert.equal(merged.networks.some((item) => item.id === "stale"), false);
  assert.equal(merged.trash.some((item) => item.id === "stale"), true);
});

test("用户云端状态使用哈希用户键并执行乐观版本保存", async () => {
  const commands = [];
  const store = createUserDataStore({
    restUrl: "https://redis.example.com",
    restToken: "redis-secret",
    fetchImpl: async (_url, options) => {
      const command = JSON.parse(options.body);
      commands.push(command);
      return new Response(JSON.stringify({ result: command[0] === "GET" ? null : [1, 1] }), { status: 200 });
    },
  });
  const loaded = await store.load("zhihu-user-123");
  assert.equal(loaded.revision, 0);
  const saved = await store.save("zhihu-user-123", createInitialState({ id: "network" }), 0);
  assert.equal(saved.revision, 1);
  assert.equal(JSON.stringify(commands).includes("zhihu-user-123"), false);
  assert.equal(JSON.stringify(commands).includes("redis-secret"), false);
  assert.equal(commands[1][0], "EVAL");
  assert.equal(commands[1][4], 0);
});
