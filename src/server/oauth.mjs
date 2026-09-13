import { randomBytes, timingSafeEqual } from "node:crypto";

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie ?? "")
      .split(/;\s*/)
      .filter(Boolean)
      .map((value) => {
        const separator = value.indexOf("=");
        return [
          value.slice(0, separator),
          decodeURIComponent(value.slice(separator + 1)),
        ];
      }),
  );
}

function serializeCookie(name, value, maxAge, secure) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function safelyEqual(left, right) {
  const a = Buffer.from(left ?? "");
  const b = Buffer.from(right ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

function oauthError(code, message, status) {
  return Object.assign(new Error(message), { code, status });
}

function parseJsonWithLosslessUid(text) {
  return JSON.parse(text.replace(/("uid"\s*:\s*)(\d{16,})/, '$1"$2"'));
}

export function createOAuthManager({
  appId,
  appKey,
  redirectUri,
  secure = false,
  fetchImpl = fetch,
} = {}) {
  const configured = Boolean(appId && appKey && redirectUri);
  const states = new Map();
  const sessions = new Map();

  function getSession(req) {
    const id = parseCookies(req).gy_session;
    const session = sessions.get(id);
    if (!session || session.expires <= Date.now()) {
      if (id) sessions.delete(id);
      return null;
    }
    return session;
  }

  return {
    configured,

    begin(req) {
      if (!configured) {
        throw oauthError(
          "ZHIHU_OAUTH_NOT_CONFIGURED",
          "尚未配置知乎 OAuth。",
          503,
        );
      }

      const now = Date.now();
      for (const [key, record] of states) {
        if (record.expires <= now) states.delete(key);
      }

      const browser =
        parseCookies(req).gy_browser ?? randomBytes(24).toString("base64url");
      const state = randomBytes(32).toString("base64url");
      states.set(state, { browser, expires: now + 10 * 60 * 1000 });

      const url = new URL("https://openapi.zhihu.com/authorize");
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("app_id", appId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("state", state);
      return {
        url: url.toString(),
        cookie: serializeCookie("gy_browser", browser, 86_400, secure),
      };
    },

    async callback(req, url) {
      const state = url.searchParams.get("state");
      const record = states.get(state);
      states.delete(state);
      if (
        !record ||
        record.expires <= Date.now() ||
        !safelyEqual(record.browser, parseCookies(req).gy_browser)
      ) {
        throw oauthError(
          "ZHIHU_OAUTH_STATE_INVALID",
          "OAuth state 无效、过期或已使用。",
          400,
        );
      }

      const code =
        url.searchParams.get("authorization_code") ??
        url.searchParams.get("code");
      if (!code) {
        throw oauthError(
          "ZHIHU_OAUTH_CALLBACK_FAILED",
          "缺少知乎授权码。",
          400,
        );
      }

      const form = new URLSearchParams({
        app_id: appId,
        app_key: appKey,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      });
      const tokenResponse = await fetchImpl(
        "https://openapi.zhihu.com/access_token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
          signal: AbortSignal.timeout(15_000),
        },
      );
      const tokenPayload = await tokenResponse.json();
      const accessToken = tokenPayload.access_token;
      if (!tokenResponse.ok || !accessToken) {
        throw oauthError(
          "ZHIHU_OAUTH_CALLBACK_FAILED",
          "无法换取知乎访问令牌。",
          502,
        );
      }

      const profileResponse = await fetchImpl("https://openapi.zhihu.com/user", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      const profileText = await profileResponse.text();
      let profile;
      try {
        profile = parseJsonWithLosslessUid(profileText);
      } catch {
        throw oauthError(
          "ZHIHU_OAUTH_CALLBACK_FAILED",
          "知乎用户信息无法解析。",
          502,
        );
      }
      const user = profile?.data && typeof profile.data === "object" ? profile.data : profile;
      const uid = user?.uid ?? user?.hash_id;
      if (!profileResponse.ok || uid === undefined || uid === null || uid === "") {
        throw oauthError(
          "ZHIHU_OAUTH_CALLBACK_FAILED",
          "知乎用户信息缺少有效标识。",
          502,
        );
      }

      const sessionId = randomBytes(32).toString("base64url");
      const reportedAge = Number(tokenPayload.expires_in);
      const maxAge = Number.isFinite(reportedAge)
        ? Math.max(60, Math.min(Math.floor(reportedAge), 86_400))
        : 3_600;
      sessions.set(sessionId, {
        uid: String(uid),
        name: user.fullname ?? "知乎用户",
        avatar: user.avatar_path ?? "",
        headline: user.headline ?? "",
        expires: Date.now() + maxAge * 1000,
        accessToken,
      });
      return {
        cookies: [
          serializeCookie("gy_session", sessionId, maxAge, secure),
          serializeCookie("gy_browser", record.browser, 86_400, secure),
        ],
      };
    },

    session(req) {
      const session = getSession(req);
      return session
        ? {
            uid: session.uid,
            name: session.name,
            avatar: session.avatar,
            headline: session.headline,
          }
        : null;
    },

    accessToken(req) {
      return getSession(req)?.accessToken ?? null;
    },

    logout(req) {
      const id = parseCookies(req).gy_session;
      if (id) sessions.delete(id);
      return serializeCookie("gy_session", "", 0, secure);
    },
  };
}
