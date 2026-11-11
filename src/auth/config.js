import googleConfig from "../../config/google.json" with { type: "json" };

/** True only for a real Web client ID. The placeholder must not start a sign-in. */
export function isGoogleConfigured(clientId) {
  if (typeof clientId !== "string") return false;
  const id = clientId.trim();
  if (!id || id.includes("YOUR_GOOGLE_OAUTH_CLIENT_ID")) return false;
  return /^[0-9A-Za-z-]+\.apps\.googleusercontent\.com$/.test(id);
}

export const googleClientId = googleConfig.clientId;
export const googleConfigured = isGoogleConfigured(googleClientId);
