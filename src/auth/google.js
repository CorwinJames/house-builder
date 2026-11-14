import { DRIVE_SCOPE } from "../drive/client.js";

const GIS_SRC = "https://accounts.google.com/gsi/client";
const SESSION_FLAG = "house-builder.google.seen";
const TOKEN_KEY = "house-builder.google.token.v1";
const HINT_KEY = "house-builder.google.hint.v1";

/**
 * Browser token client.
 * The access token (drive.file scope only) is kept in localStorage until it expires,
 * about an hour, so a reload or a new tab keeps working without a Google popup.
 * After that, reconnecting passes the last account as login_hint, so Google can
 * skip the account chooser and close its window by itself.
 */
export function createGoogleAuth({ clientId, scope = DRIVE_SCOPE } = {}) {
  let client = null;
  const stored = readStoredToken();
  let accessToken = stored?.accessToken || null;
  let expiresAt = stored?.expiresAt || 0;
  let activeFinish = () => {};

  async function library() {
    if (window.google?.accounts?.oauth2) return window.google;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Google sign-in."));
      document.head.appendChild(script);
    });
    return window.google;
  }

  async function ready() {
    if (client) return client;
    const google = await library();
    client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: (response) => activeFinish(response),
      error_callback: (error) => activeFinish({ error: error?.type || error?.message || "popup_failed" }),
    });
    return client;
  }

  function request(prompt) {
    return new Promise((resolve) => {
      let done = false;
      activeFinish = (value) => {
        if (done) return;
        done = true;
        resolve(value || { error: "empty" });
      };
      ready().then((tokenClient) => {
        tokenClient.callback = (response) => activeFinish(response);
        const hint = loginHint();
        tokenClient.requestAccessToken(hint && prompt !== "select_account" ? { prompt, login_hint: hint } : { prompt });
      }).catch((error) => activeFinish({ error: error.message || "popup_failed" }));
    });
  }

  async function ensureToken({ interactive } = {}) {
    // A known account reconnects without the chooser. A first sign-in still picks one.
    const response = await request(interactive && !loginHint() ? "select_account" : "");
    if (!response.access_token) {
      const reason = typeof response.error === "string"
        ? response.error
        : (response.error?.type || response.error?.message || "Google sign-in failed");
      const error = new Error(reason);
      error.code = reason === "access_denied" ? "access_denied" : (interactive ? "denied" : "reconnect");
      throw error;
    }
    accessToken = response.access_token;
    expiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
    try {
      localStorage.setItem(SESSION_FLAG, "1");
      localStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken, expiresAt }));
    } catch { /* private mode */ }
    return accessToken;
  }

  async function token({ interactive = false, force = false } = {}) {
    if (!force && accessToken && Date.now() < expiresAt - 60_000) return accessToken;
    return ensureToken({ interactive });
  }

  /** A token saved by an earlier page load that has not expired yet. */
  function hasLiveToken() {
    return Boolean(accessToken && Date.now() < expiresAt - 60_000);
  }

  /** Drop a token Google no longer accepts, so the next call asks again. */
  function forget() {
    accessToken = null;
    expiresAt = 0;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
  }

  function rememberAccount(email) {
    try {
      if (email) localStorage.setItem(HINT_KEY, String(email));
    } catch { /* private mode */ }
  }

  function signOut() {
    const old = accessToken;
    accessToken = null;
    expiresAt = 0;
    try {
      localStorage.removeItem(SESSION_FLAG);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(HINT_KEY);
    } catch { /* private mode */ }
    if (old && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(old, () => {});
    }
  }

  function hadSession() {
    try { return localStorage.getItem(SESSION_FLAG) === "1"; } catch { return false; }
  }

  return { token, signOut, hadSession, hasLiveToken, forget, rememberAccount };
}

function readStoredToken() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
    if (!parsed?.accessToken || !(Number(parsed.expiresAt) > Date.now() + 60_000)) return null;
    return { accessToken: String(parsed.accessToken), expiresAt: Number(parsed.expiresAt) };
  } catch {
    return null;
  }
}

function loginHint() {
  try { return localStorage.getItem(HINT_KEY) || ""; } catch { return ""; }
}
