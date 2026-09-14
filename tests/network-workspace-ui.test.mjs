import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = Promise.all([
  readFile(new URL("../network.html", import.meta.url), "utf8"),
  readFile(new URL("../src/network-app.js", import.meta.url), "utf8"),
  readFile(new URL("../assets/styles/ui.css", import.meta.url), "utf8"),
]);

test("网络页只暴露两个主操作并把编辑动作收进菜单", async () => {
  const [html] = await files;
  const toolbar = html.match(/<div class="actions network-action-bar"[\s\S]*?<\/div>\s*<button id="expand-right-panel"/)?.[0] ?? "";
  assert.match(toolbar, /id="integrate-new"/);
  assert.match(toolbar, /id="network-edit-toggle"/);
  assert.match(toolbar, /id="network-edit-menu"[^>]*hidden/);
  for (const id of ["create-node", "create-edge", "ai-connect", "ai-node", "ai-network"]) {
    assert.match(toolbar, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(toolbar, /id="ai-settings"/);
});

test("AI 设置位于归云式左下角工具区", async () => {
  const [html, , styles] = await files;
  const navigation = html.match(/<aside class="network-navigation"[\s\S]*?<\/aside>/)?.[0] ?? "";
  assert.match(navigation, /class="network-sidebar-utilities"/);
  assert.match(navigation, /id="ai-settings"[^>]*aria-label="打开 AI 设置与用量"/);
  assert.match(styles, /\.network-sidebar-utilities\{[^}]*margin-top:auto/);
  assert.match(styles, /\.network-utility-button\{[^}]*width:36px;height:36px/);
});

test("归云式左右面板可收起并在窄屏变成互斥抽屉", async () => {
  const [html, script, styles] = await files;
  for (const id of ["collapse-left-panel", "expand-left-panel", "collapse-right-panel", "expand-right-panel", "network-panel-scrim"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /workspaceLayout\.classList\.remove\(side==="left"\?"right-open":"left-open"\)/);
  assert.match(script, /guiyun-zhimai:network-layout:v1/);
  assert.match(styles, /@media\(max-width:1050px\)/);
  assert.match(styles, /\.network-page-layout\.left-open>\.network-navigation/);
  assert.match(styles, /\.network-page-layout\.right-open>\.network-inspector/);
  assert.match(styles, /width:min\(330px,86vw\)/);
});

test("返回阅读与面板开关使用可访问的小图标按钮", async () => {
  const [html, , styles] = await files;
  assert.match(html, /class="network-chrome-button"[^>]*aria-label="返回阅读"/);
  assert.match(html, /aria-label="收起知识网络导航"/);
  assert.match(html, /aria-label="收起对象详情"/);
  assert.match(styles, /\.network-chrome-button,\.network-panel-toggle\{[^}]*width:36px;height:36px/);
});

test("全局网络迁移归云的动态与点击反馈", async () => {
  const [, script, styles] = await files;
  assert.match(script, /class="overview-node \$\{classes\}"/);
  assert.match(script, /class="overview-edge-group/);
  assert.match(script, /installOverviewInteraction/);
  assert.match(script, /addEventListener\("wheel"/);
  assert.match(script, /event\.key==="Enter"\|\|event\.key===" "/);
  assert.match(script, /currentView\?\.overviewExpanded/);
  assert.match(styles, /\.overview-node:hover \.overview-node-dot/);
  assert.match(styles, /\.overview-edge-group:hover \.overview-edge/);
  assert.match(styles, /@keyframes overview-node-enter/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/);
});

test("主网络节点使用归云式圆形节点", async () => {
  const [, script, styles] = await files;
  assert.match(script, /longTitle=String\(node\.title\|\|""\)\.length>14/);
  assert.match(styles, /\.network #graph \.stage-node\{width:84px;height:84px;min-height:84px[^}]*border-radius:50%/);
  assert.match(styles, /\.network #graph \.stage-node\.long\{width:92px;height:92px/);
  assert.match(styles, /\.network #graph \.stage-node\.center\{width:96px;height:96px;min-height:96px;border-radius:50%/);
  assert.match(styles, /-webkit-line-clamp:3/);
});
