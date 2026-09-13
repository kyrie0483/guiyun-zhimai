import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createApplication } from "./src/server/application.mjs";
import { loadConfig } from "./src/server/config.mjs";
import { createOAuthManager } from "./src/server/oauth.mjs";
import { ZhihuClient } from "./src/server/zhihu-client.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const config = loadConfig();
const zhihu = new ZhihuClient({ accessSecret: config.zhihu.accessSecret });
const oauth = createOAuthManager({
  appId: config.zhihu.oauthAppId,
  appKey: config.zhihu.oauthAppKey,
  redirectUri: config.zhihu.oauthRedirectUri,
  secure: config.deployment.usesHttps,
});

const application = createApplication({ root, config, zhihu, oauth });
createServer(application).listen(config.port, config.host, () => {
  const displayUrl = config.publicBaseUrl ?? `http://localhost:${config.port}`;
  console.log(`归云·知脉已启动：${displayUrl}`);
});
