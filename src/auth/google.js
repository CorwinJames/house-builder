import { DRIVE_SCOPE } from "../drive/client.js";

const GIS_SRC = "https://accounts.google.com/gsi/client";
const SESSION_FLAG = "house-builder.google.seen";

/**
 * Browser token client. The access token stays in memory.
 * localStorage only remembers that this browser has signed in before, so a reload can ask Google quietly.
 */
export function createGoogleAuth({ clientId, scope = DRIVE_SCOPE } = {}) {
  let client = null;
  let accessToken = null;
  let expiresAt = 0;
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
        tokenClient.requestAccessToken({ prompt });
      }).catch((error) => activeFinish({ error: error.message || "popup_failed" }));
    });
  }

  async function ensureToken({ interactive } = {}) {
    const response = await request(interactive ? "select_account" : "");
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
    try { localStorage.setItem(SESSION_FLAG, "1"); } catch { /* private mode */ }
    return accessToken;
  }

  async function token({ interactive = false, force = false } = {}) {
    if (!force && accessToken && Date.now() < expiresAt - 60_000) return accessToken;
    return ensureToken({ interactive });
  }

  function signOut() {
    const old = accessToken;
    accessToken = null;
    expiresAt = 0;
    try { localStorage.removeItem(SESSION_FLAG); } catch { /* private mode */ }
    if (old && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(old, () => {});
    }
  }

  function hadSession() {
    try { return localStorage.getItem(SESSION_FLAG) === "1"; } catch { return false; }
  }

  return { token, signOut, hadSession };
}
