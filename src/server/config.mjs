function optional(value) {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function parsePort(value) {
  const port = Number(value ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT 必须是 1 到 65535 之间的整数。");
  }
  return port;
}

function parseHttpUrl(value, name) {
  const raw = optional(value);
  if (!raw) return undefined;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} 必须是有效的 http(s) URL。`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error(`${name} 只支持 http 或 https。`);
  }
  return url.toString();
}

export function loadConfig(env = process.env) {
  const nodeEnv = optional(env.NODE_ENV) ?? "development";
  const publicBaseUrl = parseHttpUrl(env.PUBLIC_BASE_URL, "PUBLIC_BASE_URL");
  const oauthRedirectUri = parseHttpUrl(
    env.ZHIHU_OAUTH_REDIRECT_URI,
    "ZHIHU_OAUTH_REDIRECT_URI",
  );
  const expectedRedirect = publicBaseUrl
    ? new URL("/api/auth/zhihu/callback", publicBaseUrl).toString()
    : undefined;

  if (
    nodeEnv === "production" &&
    publicBaseUrl &&
    new URL(publicBaseUrl).protocol !== "https:"
  ) {
    throw new Error("生产环境的 PUBLIC_BASE_URL 必须使用 HTTPS。");
  }

  if (
    nodeEnv === "production" &&
    oauthRedirectUri &&
    new URL(oauthRedirectUri).protocol !== "https:"
  ) {
    throw new Error("生产环境的 ZHIHU_OAUTH_REDIRECT_URI 必须使用 HTTPS。");
  }

  return {
    host: optional(env.HOST) ?? "0.0.0.0",
    port: parsePort(env.PORT),
    nodeEnv,
    publicBaseUrl,
    zhihu: {
      accessSecret: optional(env.ZHIHU_ACCESS_SECRET),
      oauthAppId: optional(env.ZHIHU_OAUTH_APP_ID),
      oauthAppKey: optional(env.ZHIHU_OAUTH_APP_KEY),
      oauthRedirectUri,
    },
    deployment: {
      isProduction: nodeEnv === "production",
      usesHttps: publicBaseUrl
        ? new URL(publicBaseUrl).protocol === "https:"
        : nodeEnv === "production",
      redirectMatchesPublicUrl:
        !expectedRedirect && !oauthRedirectUri
          ? true
          : expectedRedirect === oauthRedirectUri,
      expectedRedirect,
    },
  };
}
