import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, normalize, resolve, sep } from "node:path";
import { AppError } from "./zhihu-client.mjs";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://openapi.zhihu.com",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function requestId(req) {
  const incoming = String(req.headers["x-request-id"] ?? "").trim();
  return /^[A-Za-z0-9._:-]{1,100}$/.test(incoming)
    ? incoming
    : crypto.randomUUID();
}

function json(res, status, data, id, headers = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Request-Id": id,
    ...headers,
  });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let source = "";
  for await (const chunk of req) {
    source += chunk;
    if (Buffer.byteLength(source) > 150_000) {
      throw new AppError("REQUEST_TOO_LARGE", "请求内容过大。", 413);
    }
  }
  try {
    return source ? JSON.parse(source) : {};
  } catch {
    throw new AppError("INVALID_JSON", "请求不是有效 JSON。", 400);
  }
}

function isTrustedOrigin(req, publicBaseUrl) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = new Set([
    `http://${req.headers.host}`,
    `https://${req.headers.host}`,
  ]);
  if (publicBaseUrl) allowed.add(new URL(publicBaseUrl).origin);
  return allowed.has(origin);
}

export function createApplication({ root, config, zhihu, oauth, ai }) {
  const absoluteRoot = resolve(root);

  async function routeApi(req, res, url, id) {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      !isTrustedOrigin(req, config.publicBaseUrl)
    ) {
      throw new AppError("UNTRUSTED_ORIGIN", "请求来源不受信任。", 403);
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(
        res,
        200,
        {
          ok: true,
          zhihuConfigured: zhihu.configured,
          oauthConfigured: oauth.configured,
          deployment: {
            publicUrlConfigured: Boolean(config.publicBaseUrl),
            redirectMatchesPublicUrl: config.deployment.redirectMatchesPublicUrl,
          },
          capabilities: {
            search: true,
            hot: true,
            assistant: true,
            hackathonContent: true,
            oauthUserContent: zhihu.configured && oauth.configured,
            aiProviders: Boolean(ai),
            aiTrial: Boolean(ai?.trialAvailable && oauth.configured),
          },
        },
        id,
      );
    }
    if (req.method === "GET" && url.pathname === "/api/zhihu/search") {
      return json(
        res,
        200,
        await zhihu.search(url.searchParams.get("q"), url.searchParams.get("count")),
        id,
      );
    }
    if (req.method === "GET" && url.pathname === "/api/zhihu/hot") {
      return json(res, 200, await zhihu.hot(url.searchParams.get("limit")), id);
    }
    if (req.method === "GET" && url.pathname === "/api/zhihu/quota") {
      return json(res, 200, await zhihu.quota(), id);
    }
    if (req.method === "GET" && url.pathname === "/api/ai/config") {
      const session = oauth.session(req);
      return json(res, 200, {
        providers: ai.providers(),
        trial: {
          available: ai.trialAvailable && oauth.configured,
          loginRequired: !session,
          ...(session && ai.trialAvailable ? await ai.quota(session.uid) : {}),
        },
      }, id);
    }
    if (req.method === "GET" && url.pathname === "/api/ai/quota") {
      const session = oauth.session(req);
      if (!session) throw new AppError("AUTH_REQUIRED", "请先使用知乎账号登录。", 401);
      return json(res, 200, await ai.quota(session.uid), id);
    }
    if (req.method === "GET" && url.pathname === "/api/zhihu/stories") {
      return json(res, 200, await zhihu.hackathonContent("story"), id);
    }
    if (req.method === "GET" && url.pathname === "/api/zhihu/knowledge") {
      return json(res, 200, await zhihu.hackathonContent("knowledge"), id);
    }
    if (req.method === "GET" && url.pathname === "/api/zhihu/me/contents") {
      const token = oauth.accessToken(req);
      if (!token) {
        throw new AppError("AUTH_REQUIRED", "请先使用知乎账号登录。", 401);
      }
      return json(
        res,
        200,
        await zhihu.userContents(token, url.searchParams.get("limit"), url.searchParams.get("offset")),
        id,
      );
    }
    if (req.method === "GET" && url.pathname === "/api/zhihu/me/followees") {
      const token = oauth.accessToken(req);
      if (!token) throw new AppError("AUTH_REQUIRED", "请先使用知乎账号登录。", 401);
      return json(res, 200, await zhihu.userFollowees(token, url.searchParams.get("limit"), url.searchParams.get("offset")), id);
    }
    if (req.method === "POST" && url.pathname === "/api/zhihu/ai") {
      const input = await readJson(req);
      const prepared = zhihu.prepareExternalAssist(input);
      return json(res, 200, await ai.assist({
        prepared,
        ai: input.ai,
        validateResult: (result) => zhihu.validateAssist(
          prepared.task,
          prepared.nodes,
          result,
          {
            edges: prepared.edges,
            edgeId: prepared.edgeId,
            candidateNodeIds: prepared.candidateNodeIds,
          },
        ),
      }, oauth.session(req)), id);
    }
    if (req.method === "GET" && url.pathname === "/api/auth/session") {
      return json(res, 200, { user: oauth.session(req) }, id);
    }
    if (req.method === "GET" && url.pathname === "/api/auth/zhihu/start") {
      const result = oauth.begin(req);
      res.writeHead(302, {
        ...SECURITY_HEADERS,
        Location: result.url,
        "Set-Cookie": result.cookie,
        "X-Request-Id": id,
      });
      return res.end();
    }
    if (req.method === "GET" && url.pathname === "/api/auth/zhihu/callback") {
      const result = await oauth.callback(req, url);
      res.writeHead(302, {
        ...SECURITY_HEADERS,
        Location: "/profile",
        "Set-Cookie": result.cookies,
        "X-Request-Id": id,
      });
      return res.end();
    }
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      return json(res, 200, { ok: true }, id, {
        "Set-Cookie": oauth.logout(req),
      });
    }
    return false;
  }

  return async function application(req, res) {
    const id = requestId(req);
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        if ((await routeApi(req, res, url, id)) !== false) return;
        return json(
          res,
          404,
          { error: { code: "NOT_FOUND", message: "接口不存在。", requestId: id } },
          id,
        );
      }

      const pageRoutes = new Map([["/", "index.html"], ["/network", "network.html"], ["/profile", "profile.html"]]);
      const relativePath =
        pageRoutes.get(url.pathname) ??
        decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const file = resolve(absoluteRoot, normalize(relativePath));
      if (
        (file !== absoluteRoot && !file.startsWith(`${absoluteRoot}${sep}`)) ||
        !existsSync(file) ||
        statSync(file).isDirectory()
      ) {
        res.writeHead(404, {
          ...SECURITY_HEADERS,
          "Content-Type": "text/plain; charset=utf-8",
          "X-Request-Id": id,
        });
        return res.end("Not found");
      }
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "Cache-Control": "no-store",
        "Content-Type": MIME_TYPES[extname(file)] ?? "application/octet-stream",
        "X-Request-Id": id,
      });
      createReadStream(file).pipe(res);
    } catch (error) {
      const known = error instanceof AppError || error?.status;
      const status = known ? (error.status ?? 500) : 500;
      json(
        res,
        status,
        {
          error: {
            code: known ? (error.code ?? "INTERNAL_ERROR") : "INTERNAL_ERROR",
            message: known ? error.message : "服务暂时不可用。",
            requestId: id,
          },
        },
        id,
      );
    }
  };
}
