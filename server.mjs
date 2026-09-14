import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createApplication } from "./src/server/application.mjs";
import { loadConfig } from "./src/server/config.mjs";
import { createOAuthManager } from "./src/server/oauth.mjs";
import { ZhihuClient } from "./src/server/zhihu-client.mjs";
import { createAiClient } from "./src/server/ai-client.mjs";
import { createTrialQuotaStore } from "./src/server/ai-quota.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const config = loadConfig();
const zhihu = new ZhihuClient({ accessSecret: config.zhihu.accessSecret });
const oauth = createOAuthManager({
  appId: config.zhihu.oauthAppId,
  appKey: config.zhihu.oauthAppKey,
  redirectUri: config.zhihu.oauthRedirectUri,
  secure: config.deployment.usesHttps,
});
const aiQuota = createTrialQuotaStore({
  restUrl: config.ai.upstashRedisRestUrl,
  restToken: config.ai.upstashRedisRestToken,
  limit: config.ai.trialTokenLimit,
});
const ai = createAiClient({
  trial: {
    provider: config.ai.trialProvider,
    model: config.ai.trialModel,
    apiKey: config.ai.trialApiKey,
    maxOutputTokens: config.ai.maxOutputTokens,
  },
  quota: aiQuota,
});

const application = createApplication({ root, config, zhihu, oauth, ai });
createServer(application).listen(config.port, config.host, () => {
  const displayUrl = config.publicBaseUrl ?? `http://localhost:${config.port}`;
  console.log(`归云·知脉已启动：${displayUrl}`);
});
