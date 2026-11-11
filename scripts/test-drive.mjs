import assert from "node:assert/strict";
import {
  DriveError,
  createDesign,
  designFileName,
  ensureAppFolder,
  getUser,
  listDesigns,
  readDesign,
  shareDesign,
  updateDesign,
} from "../src/drive/client.js";
import { isGoogleConfigured } from "../src/auth/config.js";

let failed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok  ${name}`))
    .catch((error) => {
      failed += 1;
      console.error(`FAIL ${name}`);
      console.error(error);
    });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    assert.equal(options.headers.Authorization?.startsWith("Bearer "), true);
    assert.equal(JSON.stringify(options).includes("client_secret"), false);
    return handler(String(url), options, calls);
  };
  return { fetchImpl, calls };
}

const house = { schemaVersion: 2, name: "Sample house", id: "house-1" };

await check("placeholder client id is not configured", () => {
  assert.equal(isGoogleConfigured("YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com"), false);
  assert.equal(isGoogleConfigured(""), false);
  assert.equal(isGoogleConfigured("123-abc.apps.googleusercontent.com"), true);
});

await check("design file names stay inside one safe file name", () => {
  assert.equal(designFileName("Sample house"), "Sample house.house.json");
  assert.equal(designFileName("Phase 1.house.json"), "Phase 1.house.json");
  assert.equal(designFileName("a/b:c"), "a b c.house.json");
  assert.equal(designFileName(""), "Untitled.house.json");
});

await check("the app folder is created when Drive has none", async () => {
  const { fetchImpl, calls } = mockFetch((url, options) => {
    if (url.includes("/files?") && (!options.method || options.method === "GET")) {
      return jsonResponse({ files: [] });
    }
    assert.equal(options.method, "POST");
    const body = JSON.parse(options.body);
    assert.equal(body.name, "House Builder");
    assert.equal(body.mimeType, "application/vnd.google-apps.folder");
    assert.equal(body.appProperties.app, "house-builder");
    return jsonResponse({ id: "folder-1" });
  });
  const id = await ensureAppFolder(fetchImpl, "token");
  assert.equal(id, "folder-1");
  assert.equal(calls.length, 2);
});

await check("an existing app folder is reused", async () => {
  const { fetchImpl, calls } = mockFetch(() => jsonResponse({ files: [{ id: "folder-9", name: "House Builder" }] }));
  assert.equal(await ensureAppFolder(fetchImpl, "token"), "folder-9");
  assert.equal(calls.length, 1);
});

await check("designs are listed newest first", async () => {
  const { fetchImpl } = mockFetch((url) => {
    assert.match(url, /orderBy=modifiedTime(?:%20|\+)desc/);
    assert.match(decodeURIComponent(url), /value='house-builder'/);
    return jsonResponse({
      files: [
        { id: "old", name: "Old.house.json", modifiedTime: "2026-01-01T00:00:00.000Z", appProperties: { app: "house-builder" } },
        { id: "new", name: "New.house.json", modifiedTime: "2026-06-01T00:00:00.000Z", appProperties: { app: "house-builder" } },
        { id: "other", name: "Notes.json", modifiedTime: "2026-07-01T00:00:00.000Z", appProperties: { app: "other" } },
      ],
    });
  });
  const files = await listDesigns(fetchImpl, "token");
  assert.deepEqual(files.map((file) => file.id), ["new", "old"]);
});

await check("a new design is JSON in the House Builder folder", async () => {
  const { fetchImpl } = mockFetch((url, options) => {
    assert.equal(options.method, "POST");
    assert.match(options.headers["Content-Type"], /multipart\/related/);
    assert.match(options.body, /"name":"Sample house\.house\.json"/);
    assert.match(options.body, /"parents":\["folder-1"\]/);
    assert.match(options.body, /"app":"house-builder"/);
    assert.match(options.body, /"schemaVersion":"2"/);
    assert.match(options.body, /"id":"house-1"/);
    assert.equal(url.includes("uploadType=multipart"), true);
    return jsonResponse({ id: "file-1", name: "Sample house.house.json", modifiedTime: "2026-11-11T00:00:00.000Z" });
  });
  const created = await createDesign(fetchImpl, "token", { folderId: "folder-1", designName: "Sample house", house });
  assert.equal(created.id, "file-1");
});

await check("an update refuses to overwrite a newer Drive copy", async () => {
  const { fetchImpl, calls } = mockFetch(() => jsonResponse({ modifiedTime: "2026-11-11T02:00:00.000Z" }));
  await assert.rejects(
    () => updateDesign(fetchImpl, "token", {
      fileId: "file-1",
      house,
      modifiedTime: "2026-11-11T01:00:00.000Z",
    }),
    (error) => error instanceof DriveError && error.code === "conflict",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, undefined);
});

await check("a matching modified time uploads with PATCH", async () => {
  const { fetchImpl, calls } = mockFetch((url, options) => {
    if (!options.method || options.method === "GET") return jsonResponse({ modifiedTime: "2026-11-11T01:00:00.000Z" });
    assert.equal(options.method, "PATCH");
    assert.match(url, /\/file-1\?/);
    return jsonResponse({ id: "file-1", name: "Sample house.house.json", modifiedTime: "2026-11-11T03:00:00.000Z" });
  });
  const saved = await updateDesign(fetchImpl, "token", {
    fileId: "file-1",
    house,
    modifiedTime: "2026-11-11T01:00:00.000Z",
  });
  assert.equal(saved.modifiedTime, "2026-11-11T03:00:00.000Z");
  assert.equal(calls.length, 2);
});

await check("force writes over a newer copy", async () => {
  const { fetchImpl, calls } = mockFetch((url, options) => {
    assert.equal(options.method, "PATCH");
    return jsonResponse({ id: "file-1", name: "Sample house.house.json", modifiedTime: "2026-11-11T04:00:00.000Z" });
  });
  await updateDesign(fetchImpl, "token", {
    fileId: "file-1",
    house,
    modifiedTime: "2026-11-11T01:00:00.000Z",
    force: true,
  });
  assert.equal(calls.length, 1);
});

await check("reading a file the app cannot see is not-found", async () => {
  const { fetchImpl } = mockFetch(() => jsonResponse({ error: { message: "not found" } }, 404));
  await assert.rejects(
    () => readDesign(fetchImpl, "token", "shared-1"),
    (error) => error instanceof DriveError && error.code === "not-found",
  );
});

await check("reading a design returns the house JSON", async () => {
  const { fetchImpl } = mockFetch((url) => {
    if (url.includes("alt=media")) {
      return new Response(JSON.stringify(house), { status: 200, headers: { "content-type": "application/json" } });
    }
    return jsonResponse({ id: "file-1", name: "Sample house.house.json", modifiedTime: "2026-11-11T01:00:00.000Z" });
  });
  const loaded = await readDesign(fetchImpl, "token", "file-1");
  assert.equal(loaded.house.name, "Sample house");
  assert.equal(loaded.modifiedTime, "2026-11-11T01:00:00.000Z");
});

await check("share invites an editor by email", async () => {
  const { fetchImpl } = mockFetch((url, options) => {
    assert.match(url, /\/file-1\/permissions/);
    assert.match(url, /sendNotificationEmail=true/);
    assert.deepEqual(JSON.parse(options.body), {
      type: "user",
      role: "writer",
      emailAddress: "sophie@example.com",
    });
    return jsonResponse({ id: "perm-1" });
  });
  await shareDesign(fetchImpl, "token", "file-1", "sophie@example.com");
  await assert.rejects(
    () => shareDesign(fetchImpl, "token", "file-1", "not-an-email"),
    (error) => error instanceof DriveError,
  );
});

await check("an expired token is reported as auth", async () => {
  const { fetchImpl } = mockFetch(() => jsonResponse({ error: { message: "Invalid Credentials" } }, 401));
  await assert.rejects(() => getUser(fetchImpl, "stale"), (error) => error.code === "auth");
});

await check("a dropped network is offline", async () => {
  const fetchImpl = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(() => getUser(fetchImpl, "token"), (error) => error.code === "offline");
});

await check("about.get supplies the account name without another scope", async () => {
  const { fetchImpl } = mockFetch((url) => {
    assert.match(url, /\/about\?/);
    return jsonResponse({ user: { displayName: "James", emailAddress: "james@example.com", photoLink: "https://example.com/a.jpg" } });
  });
  const user = await getUser(fetchImpl, "token");
  assert.equal(user.displayName, "James");
});

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("drive ok");
