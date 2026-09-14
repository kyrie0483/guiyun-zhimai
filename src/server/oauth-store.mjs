import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const PREFIX = "guiyun-zhimai:oauth:v1";

function digest(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function encryptionKey(secret) {
  return createHash("sha256")
    .update("guiyun-zhimai/oauth-session/v1\0")
    .update(String(secret ?? ""))
    .digest();
}

function seal(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function open(value, key) {
  try {
    const [iv, tag, ciphertext] = String(value).split(".").map((part) =>
      Buffer.from(part, "base64url"),
    );
    if (!iv || !tag || !ciphertext) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"),
    );
  } catch {
    return null;
  }
}

function storageError() {
  return Object.assign(new Error("OAuth 会话存储暂时不可用。"), {
    code: "OAUTH_STORAGE_UNAVAILABLE",
    status: 503,
  });
}

export function createOAuthStore({
  restUrl,
  restToken,
  encryptionSecret,
  fetchImpl = fetch,
} = {}) {
  const configured = Boolean(restUrl && restToken);
  const key = encryptionKey(encryptionSecret);
  const memoryStates = new Map();
  const memoryLatest = new Map();
  const memorySessions = new Map();

  async function command(parts) {
    let response;
    try {
      response = await fetchImpl(String(restUrl).replace(/\/+$/u, ""), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${restToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parts),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw storageError();
      return payload.result;
    } catch (error) {
      if (error?.code === "OAUTH_STORAGE_UNAVAILABLE") throw error;
      throw storageError();
    }
  }

  function stateKey(state) {
    return `${PREFIX}:state:${digest(state)}`;
  }

  function latestKey(browserHash) {
    return `${PREFIX}:latest:${browserHash}`;
  }

  function sessionKey(id) {
    return `${PREFIX}:session:${digest(id)}`;
  }

  return {
    configured,

    async saveState(state, browser, ttlSeconds) {
      const browserHash = digest(browser);
      if (configured) {
        await command(["SET", stateKey(state), browserHash, "EX", ttlSeconds]);
        await command(["SET", latestKey(browserHash), state, "EX", ttlSeconds]);
        return;
      }
      const expires = Date.now() + ttlSeconds * 1000;
      memoryStates.set(state, { browserHash, expires });
      memoryLatest.set(browserHash, { state, expires });
    },

    async consumeState(state, browser) {
      const browserHash = digest(browser);
      if (configured) {
        const storedBrowser = await command(["GETDEL", stateKey(state)]);
        return storedBrowser === browserHash ? { browser } : null;
      }
      const record = memoryStates.get(state);
      memoryStates.delete(state);
      return record && record.expires > Date.now() && record.browserHash === browserHash
        ? { browser }
        : null;
    },

    async consumeLatestState(browser) {
      const browserHash = digest(browser);
      let state;
      if (configured) {
        state = await command(["GETDEL", latestKey(browserHash)]);
      } else {
        const record = memoryLatest.get(browserHash);
        memoryLatest.delete(browserHash);
        if (record?.expires > Date.now()) state = record.state;
      }
      return state ? this.consumeState(state, browser) : null;
    },

    async saveSession(id, session, ttlSeconds) {
      const encoded = seal(session, key);
      if (configured) {
        await command(["SET", sessionKey(id), encoded, "EX", ttlSeconds]);
        return;
      }
      memorySessions.set(id, { encoded, expires: Date.now() + ttlSeconds * 1000 });
    },

    async getSession(id) {
      if (!id) return null;
      let encoded;
      if (configured) {
        encoded = await command(["GET", sessionKey(id)]);
      } else {
        const record = memorySessions.get(id);
        if (!record || record.expires <= Date.now()) {
          memorySessions.delete(id);
          return null;
        }
        encoded = record.encoded;
      }
      return encoded ? open(encoded, key) : null;
    },

    async deleteSession(id) {
      if (!id) return;
      if (configured) await command(["DEL", sessionKey(id)]);
      else memorySessions.delete(id);
    },
  };
}
