/** Drive API v3 over fetch. No client secret. Scope is drive.file. */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const APP_KEY = "house-builder";
export const FOLDER_NAME = "House Builder";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const FILE_MIME = "application/json";
export const AUTOSAVE_MS = 10_000;

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export class DriveError extends Error {
  constructor(message, { status = 0, code = "http" } = {}) {
    super(message);
    this.name = "DriveError";
    this.status = status;
    this.code = code;
  }
}

export function designFileName(name) {
  const cleaned = String(name || "Untitled")
    .replace(/\.house\.json$/i, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${cleaned || "Untitled"}.house.json`;
}

export function designNameFromFile(fileName) {
  return String(fileName || "Untitled").replace(/\.house\.json$/i, "") || "Untitled";
}

function appProperties(schemaVersion) {
  return { app: APP_KEY, schemaVersion: String(schemaVersion || 2) };
}

export function multipartRelated(metadata, jsonText) {
  const boundary = `housebuilder_${Math.random().toString(16).slice(2)}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    jsonText,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

async function driveFetch(fetchImpl, token, url, options = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    throw new DriveError("Offline", { code: "offline" });
  }
  if (response.status === 401) {
    throw new DriveError("Google needs a new sign-in.", { status: 401, code: "auth" });
  }
  if (response.status === 404) {
    throw new DriveError("That file is not available to this app.", { status: 404, code: "not-found" });
  }
  if (!response.ok) {
    let message = `Drive returned ${response.status}`;
    try {
      const body = await response.json();
      message = body.error?.message || message;
    } catch {
      // The body was not JSON.
    }
    throw new DriveError(message, { status: response.status, code: "http" });
  }
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") || "";
  if (type.includes("json")) return response.json();
  return response.text();
}

export async function getUser(fetchImpl, token) {
  const about = await driveFetch(
    fetchImpl,
    token,
    `${API}/about?fields=user(displayName,emailAddress,photoLink)`,
  );
  return about.user || {};
}

export async function findAppFolder(fetchImpl, token) {
  const q = `mimeType='${FOLDER_MIME}' and name='${FOLDER_NAME}' and appProperties has { key='app' and value='${APP_KEY}' } and trashed=false`;
  const listed = await driveFetch(
    fetchImpl,
    token,
    `${API}/files?pageSize=1&fields=files(id,name)&q=${encodeURIComponent(q)}`,
  );
  return listed.files?.[0] || null;
}

export async function ensureAppFolder(fetchImpl, token) {
  const existing = await findAppFolder(fetchImpl, token);
  if (existing) return existing.id;
  const created = await driveFetch(fetchImpl, token, `${API}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: FOLDER_MIME,
      appProperties: { app: APP_KEY },
    }),
  });
  return created.id;
}

export async function listDesigns(fetchImpl, token) {
  const q = `appProperties has { key='app' and value='${APP_KEY}' } and mimeType='${FILE_MIME}' and trashed=false`;
  const listed = await driveFetch(
    fetchImpl,
    token,
    `${API}/files?pageSize=50&orderBy=${encodeURIComponent("modifiedTime desc")}&fields=files(id,name,modifiedTime,appProperties)&q=${encodeURIComponent(q)}`,
  );
  const files = listed.files || [];
  return files
    .filter((file) => file.appProperties?.app === APP_KEY)
    .sort((a, b) => String(b.modifiedTime || "").localeCompare(String(a.modifiedTime || "")));
}

export async function readDesign(fetchImpl, token, fileId) {
  const meta = await driveFetch(
    fetchImpl,
    token,
    `${API}/files/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime,appProperties`,
  );
  const text = await driveFetch(
    fetchImpl,
    token,
    `${API}/files/${encodeURIComponent(fileId)}?alt=media`,
  );
  const house = typeof text === "string" ? JSON.parse(text) : text;
  return { id: meta.id, name: meta.name, modifiedTime: meta.modifiedTime, house };
}

async function upload(fetchImpl, token, { method, url, metadata, house }) {
  const jsonText = JSON.stringify(house);
  const { body, contentType } = multipartRelated(metadata, jsonText);
  return driveFetch(fetchImpl, token, url, {
    method,
    headers: { "Content-Type": contentType },
    body,
  });
}

export async function createDesign(fetchImpl, token, { folderId, designName, house }) {
  const metadata = {
    name: designFileName(designName || house.name),
    mimeType: FILE_MIME,
    parents: [folderId],
    appProperties: appProperties(house.schemaVersion),
  };
  const created = await upload(fetchImpl, token, {
    method: "POST",
    url: `${UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime`,
    metadata,
    house,
  });
  return created;
}

export async function updateDesign(fetchImpl, token, { fileId, designName, house, modifiedTime, force = false }) {
  if (!force && modifiedTime) {
    const meta = await driveFetch(
      fetchImpl,
      token,
      `${API}/files/${encodeURIComponent(fileId)}?fields=modifiedTime`,
    );
    if (meta.modifiedTime && meta.modifiedTime !== modifiedTime) {
      const error = new DriveError("This file changed in Drive.", { code: "conflict" });
      error.modifiedTime = meta.modifiedTime;
      throw error;
    }
  }
  const metadata = {
    name: designFileName(designName || house.name),
    mimeType: FILE_MIME,
    appProperties: appProperties(house.schemaVersion),
  };
  return upload(fetchImpl, token, {
    method: "PATCH",
    url: `${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,modifiedTime`,
    metadata,
    house,
  });
}

export function validShareEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

export async function shareDesign(fetchImpl, token, fileId, email) {
  const address = String(email || "").trim();
  if (!validShareEmail(address)) {
    throw new DriveError("Enter an email address.", { code: "http" });
  }
  return driveFetch(
    fetchImpl,
    token,
    `${API}/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "user", role: "writer", emailAddress: address }),
    },
  );
}
