import { googleClientId, googleConfigured } from "../auth/config.js";
import { createGoogleAuth } from "../auth/google.js";
import {
  createDesign,
  designNameFromFile,
  ensureAppFolder,
  getUser,
  listDesigns,
  readDesign,
  shareDesign,
  updateDesign,
  validShareEmail,
  DriveError,
} from "../drive/client.js";
import { DRIVE_DEBOUNCE_MS, DRIVE_INTERVAL_MS, driveBootAction, shouldUploadToDrive } from "../drive/sync.js";

const DRIVE_KEY = "house-builder.drive.v1";

const PREVIEW_FILES = [
  { id: "preview-1", name: "Sample house.house.json", modifiedTime: "2026-11-10T18:04:00.000Z" },
  { id: "preview-2", name: "Phase 1 only.house.json", modifiedTime: "2026-11-08T15:30:00.000Z" },
];

/**
 * Header account control and the Drive entries in the File menu.
 * localStorage still autosaves every edit. Drive autosave waits until a file is open.
 */
export function attachAccount({ editor }) {
  const account = document.querySelector("#account");
  const statusEl = document.querySelector("#save-status");
  const dialog = document.querySelector("#drive-dialog");
  const auth = googleConfigured ? createGoogleAuth({ clientId: googleClientId }) : null;
  let user = null;
  let currentFile = null;
  let remembered = readBinding();
  let folderId = null;
  let timer = 0;
  let paused = false;
  let saving = false;
  let driveLoaded = false;
  let dirty = false;
  let dirtyGen = 0;

  const linked = new URLSearchParams(window.location.search).get("file");
  renderAccount();
  wireMenu();
  bootDrive();
  window.setInterval(() => {
    if (shouldUploadToDrive({ dirty, loaded: driveLoaded, signedIn: Boolean(user && auth), paused, saving })) {
      saveNow({ auto: true });
    }
  }, DRIVE_INTERVAL_MS);

  function renderAccount() {
    if (!googleConfigured) {
      account.innerHTML = `<button type="button" class="sign-in" id="sign-in" aria-disabled="true">Google sign-in not configured yet</button>`;
      account.querySelector("#sign-in").addEventListener("click", () => {
        message("Google sign-in not configured yet", "Add the OAuth client ID in config/google.json. Until then, Export and Import JSON still work on this device.");
      });
      return;
    }
    if (!user) {
      account.innerHTML = `<button type="button" class="sign-in" id="sign-in">Sign in with Google</button>`;
      account.querySelector("#sign-in").addEventListener("click", () => signIn(true));
      return;
    }
    const photo = user.photoLink
      ? `<img class="avatar" alt="" src="${escapeAttr(user.photoLink)}" referrerpolicy="no-referrer" />`
      : "";
    account.innerHTML = `<span class="account-chip">${photo}<span class="account-name">${escapeHtml(user.displayName || user.emailAddress || "Signed in")}</span></span><button type="button" class="sign-out" id="sign-out">Sign out</button>`;
    account.querySelector("#sign-out").addEventListener("click", () => {
      auth.signOut();
      user = null;
      window.clearTimeout(timer);
      dirty = false;
      if (remembered?.id) showDrivePrompt();
      else setStatus("", "");
      renderAccount();
    });
  }

  function wireMenu() {
    document.querySelector("#drive-save").addEventListener("click", () => { closeMenu(); saveToDrive(); });
    document.querySelector("#drive-save-as").addEventListener("click", () => { closeMenu(); saveAs(); });
    document.querySelector("#drive-open").addEventListener("click", () => { closeMenu(); openFromDrive(); });
    document.querySelector("#drive-share").addEventListener("click", () => { closeMenu(); shareWith(); });
    document.querySelector("#drive-banner-load")?.addEventListener("click", () => loadRemembered());
    statusEl.addEventListener("click", () => {
      if (statusEl.dataset.state !== "reconnect") return;
      if ((remembered?.id || linked) && !driveLoaded) loadRemembered();
      else signIn(true);
    });
  }

  function bootDrive() {
    const fileId = remembered?.id || linked;
    if (!auth || driveBootAction({ fileId, signedIn: false }).action === "keep-local") return;
    if (auth.hadSession()) restoreSession();
    else showDrivePrompt();
  }

  function showDrivePrompt() {
    const banner = document.querySelector("#drive-banner");
    if (banner) banner.hidden = false;
    setStatus("reconnect", "Reconnect to load your Drive plan");
  }

  function hideDrivePrompt() {
    const banner = document.querySelector("#drive-banner");
    if (banner) banner.hidden = true;
  }

  function onDocument(source) {
    if (source === "import" || source === "reset") {
      currentFile = null;
      remembered = null;
      driveLoaded = false;
      dirty = false;
      folderId = null;
      paused = false;
      window.clearTimeout(timer);
      writeBinding(null);
      hideDrivePrompt();
      if (source === "reset") setStatus("", "");
      return;
    }
    if (source !== "edit") return;
    if (!shouldUploadToDrive({ dirty: true, loaded: driveLoaded, signedIn: Boolean(auth && user), paused, saving: false })) return;
    dirty = true;
    dirtyGen += 1;
    setStatus("saving", "Saving to Drive...");
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { saveNow({ auto: true }); }, DRIVE_DEBOUNCE_MS);
  }

  async function restoreSession() {
    try {
      await auth.token({ interactive: false });
      await refreshUser();
      const fileId = linked || remembered?.id;
      const action = driveBootAction({ fileId, signedIn: true });
      if (linked) await openFileId(linked, { fromLink: true });
      else if (action.action === "load") await openFileId(action.fileId, { confirm: false });
    } catch {
      if (remembered?.id || linked) showDrivePrompt();
      else setStatus("reconnect", "Sign in to Google again");
    }
  }

  async function loadRemembered() {
    const fileId = remembered?.id || linked;
    if (!fileId || !auth) return;
    if (!user) {
      const ok = await signIn(true);
      if (!ok) return;
    }
    if (driveLoaded && currentFile?.id === fileId) return;
    await openFileId(fileId, { confirm: false });
  }

  async function signIn(interactive) {
    if (!auth) return false;
    try {
      await auth.token({ interactive, force: interactive });
      await refreshUser();
      if (driveLoaded) setStatus("saved", "Saved to Drive");
      return true;
    } catch (error) {
      if (interactive && (error.code === "access_denied" || String(error.message || "").includes("access_denied"))) {
        message("Google sign-in", "Only invited testers can sign in while this app is in Testing. An account that is not on the tester list is turned away.");
      } else if (interactive && /popup_closed|popup_failed/.test(String(error.message || ""))) {
        message("Google sign-in", "The Google window closed before sign-in finished.");
      } else if (interactive) message("Google sign-in", error.message || "Google sign-in failed.");
      else if (remembered?.id) showDrivePrompt();
      else setStatus("reconnect", "Sign in to Google again");
      return false;
    }
  }

  async function refreshUser() {
    const access = await auth.token();
    user = await withAuth((token) => getUser(fetch, token), access);
    renderAccount();
  }

  async function withAuth(fn, access) {
    try {
      return await fn(access || await auth.token());
    } catch (error) {
      if (error?.code !== "auth") throw error;
      const next = await auth.token({ force: true, interactive: false });
      return fn(next);
    }
  }

  async function requireSignedIn() {
    if (!googleConfigured) {
      message("Google sign-in not configured yet", "Add the OAuth client ID in config/google.json. Export and Import JSON still work on this device.");
      return false;
    }
    if (user && auth) return true;
    return signIn(true);
  }

  async function saveToDrive() {
    if (!await requireSignedIn()) return;
    paused = false;
    if (!currentFile) {
      await saveAs();
      return;
    }
    await saveNow({ auto: false });
  }

  async function saveAs() {
    if (!await requireSignedIn()) return;
    const suggested = editor.house().name || "Untitled";
    const name = await askText("Save as", "Design name", suggested);
    if (!name) return;
    paused = false;
    currentFile = null;
    remembered = null;
    driveLoaded = false;
    dirty = false;
    writeBinding(null);
    editor.setDesignName(name);
    await saveNow({ create: true });
  }

  async function saveNow({ auto = false, create = false, force = false } = {}) {
    if (!auth || !user) return;
    if (saving) return;
    window.clearTimeout(timer);
    const house = editor.house();
    if (!create && !currentFile) return;
    if (auto && !shouldUploadToDrive({ dirty, loaded: driveLoaded, signedIn: true, paused, saving: false })) return;
    const gen = dirtyGen;
    saving = true;
    setStatus("saving", "Saving to Drive...");
    try {
      const saved = await withAuth(async (token) => {
        if (!folderId) folderId = await ensureAppFolder(fetch, token);
        if (!currentFile || create) {
          return createDesign(fetch, token, { folderId, designName: house.name, house });
        }
        return updateDesign(fetch, token, {
          fileId: currentFile.id,
          designName: house.name,
          house,
          modifiedTime: currentFile.modifiedTime,
          force,
        });
      });
      currentFile = { id: saved.id, name: saved.name, modifiedTime: saved.modifiedTime };
      remembered = currentFile;
      driveLoaded = true;
      if (dirtyGen === gen) dirty = false;
      writeBinding(currentFile);
      paused = false;
      hideDrivePrompt();
      setStatus("saved", "Saved to Drive");
    } catch (error) {
      if (error instanceof DriveError && error.code === "conflict") {
        const overwrite = window.confirm("This file changed in Drive since you opened it. Overwrite it?");
        if (overwrite) {
          saving = false;
          await saveNow({ auto, create, force: true });
          return;
        }
        paused = true;
        setStatus("conflict", "Drive copy is newer");
        return;
      }
      if (error?.code === "auth" || error?.code === "reconnect") {
        setStatus("reconnect", remembered?.id && !driveLoaded ? "Reconnect to load your Drive plan" : "Sign in to Google again");
        if (remembered?.id && !driveLoaded) showDrivePrompt();
        return;
      }
      if (error?.code === "offline" || navigator.onLine === false) {
        setStatus("offline", "Offline");
        return;
      }
      setStatus("offline", "Not saved");
    } finally {
      saving = false;
    }
  }

  async function openFromDrive() {
    if (!googleConfigured) {
      showList(PREVIEW_FILES, { preview: true });
      return;
    }
    if (!await requireSignedIn()) return;
    try {
      const files = await withAuth((token) => listDesigns(fetch, token));
      showList(files, { preview: false });
    } catch (error) {
      handleListError(error);
    }
  }

  function showList(files, { preview }) {
    const rows = files.length
      ? `<ul class="drive-list">${files.map((file) => `<li><button type="button" data-file="${escapeAttr(file.id)}"><span>${escapeHtml(file.name)}</span><time datetime="${escapeAttr(file.modifiedTime || "")}">${escapeHtml(formatWhen(file.modifiedTime))}</time></button></li>`).join("")}</ul>`
      : `<p class="fine">No designs in Drive yet.</p>`;
    const note = preview
      ? `<p class="fine">Google sign-in not configured yet. This list is a preview of files the app would show.</p>`
      : `<p class="fine">Designs this app saved to the House Builder folder, newest first.</p>`;
    const dialogEl = message("Open from Drive", `${note}${rows}`, { html: true });
    dialogEl.querySelectorAll("[data-file]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (preview) {
          message("Google sign-in not configured yet", "Add the OAuth client ID in config/google.json before opening a Drive file.");
          return;
        }
        dialog.close();
        await openFileId(button.dataset.file, { fromLink: false });
      });
    });
  }

  async function openFileId(fileId, { fromLink = false, confirm = fromLink } = {}) {
    if (!fileId || !auth) return false;
    if (!user) {
      const ok = await signIn(true);
      if (!ok) return false;
    }
    if (confirm && !window.confirm("Open this Drive design? It replaces the house saved on this device.")) return false;
    try {
      const loaded = await withAuth((token) => readDesign(fetch, token, fileId));
      if (!editor.loadHouse(loaded.house)) {
        message("Open from Drive", "That file is not a house this app can read.");
        return false;
      }
      currentFile = { id: loaded.id, name: loaded.name, modifiedTime: loaded.modifiedTime };
      remembered = currentFile;
      driveLoaded = true;
      dirty = false;
      const title = designNameFromFile(loaded.name);
      if (loaded.house.name !== title) editor.setDesignName(title);
      writeBinding(currentFile);
      paused = false;
      hideDrivePrompt();
      setStatus("saved", "Saved to Drive");
      return true;
    } catch (error) {
      if (error?.code === "not-found") {
        message(
          "Can't open that Drive file",
          "drive.file only sees files this app created or that you opened with it. A file Sophie shared from her own sign-in stays hidden until Google Picker is added (that needs an API key). She can also use Export JSON and you can Import it.",
        );
        if (remembered?.id === fileId) {
          remembered = null;
          writeBinding(null);
          hideDrivePrompt();
          setStatus("", "");
        }
        return false;
      }
      if (error?.code === "auth" || error?.code === "reconnect") {
        showDrivePrompt();
        return false;
      }
      handleListError(error);
      return false;
    }
  }

  async function shareWith() {
    if (!await requireSignedIn()) return;
    if (!currentFile) {
      message("Share with…", "Save to Drive first. Then you can invite someone by email.");
      return;
    }
    const email = await askText("Share with…", "Email", "");
    if (!email) return;
    if (!validShareEmail(email)) {
      message("Share with…", "Enter an email address.");
      return;
    }
    try {
      await withAuth((token) => shareDesign(fetch, token, currentFile.id, email));
      const link = shareLink(currentFile.id);
      message(
        "Shared",
        `<p>Invited ${escapeHtml(email)} as an editor. They get a Drive email.</p><p class="fine">The link below opens this app. With drive.file, the other person can open a file this app created for them only after a Google Picker step, which needs an API key we have not added. Until then, Export JSON is the sure handoff.</p><input class="share-link" readonly value="${escapeAttr(link)}" />`,
        { html: true },
      );
    } catch (error) {
      message("Share with…", error.message || "Drive did not share that file.");
    }
  }

  function handleListError(error) {
    if (error?.code === "auth" || error?.code === "reconnect") {
      if (remembered?.id && !driveLoaded) showDrivePrompt();
      else setStatus("reconnect", "Sign in to Google again");
      return;
    }
    if (error?.code === "offline") {
      setStatus("offline", "Offline");
      return;
    }
    message("Drive", error.message || "Drive did not answer.");
  }

  function askText(title, label, value) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (text) => {
        if (settled) return;
        settled = true;
        resolve(text);
      };
      const dialogEl = message(
        title,
        `<label class="ask">${escapeHtml(label)} <input id="drive-ask" value="${escapeAttr(value)}" /></label><p class="dialog-actions"><button type="button" data-close>Cancel</button><button type="button" id="drive-ask-ok">Save</button></p>`,
        { html: true, keep: true },
      );
      const input = dialogEl.querySelector("#drive-ask");
      input.focus();
      input.select();
      dialogEl.querySelector("#drive-ask-ok").addEventListener("click", () => {
        const text = input.value.trim();
        finish(text);
        dialog.close();
      });
      dialogEl.addEventListener("close", () => finish(""), { once: true });
    });
  }

  function message(title, body, { html = false, keep = false } = {}) {
    dialog.innerHTML = `<h2>${escapeHtml(title)}</h2>${html ? body : `<p>${escapeHtml(body)}</p>`}${keep ? "" : `<button type="button" data-close>Close</button>`}`;
    dialog.querySelectorAll("[data-close]").forEach((button) => {
      button.addEventListener("click", () => dialog.close());
    });
    if (!dialog.open) dialog.showModal();
    return dialog;
  }

  function setStatus(state, label) {
    if (!state) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      statusEl.dataset.state = "";
      return;
    }
    statusEl.hidden = false;
    statusEl.dataset.state = state;
    statusEl.textContent = label;
  }

  async function saveUnsavedCopy() {
    if (!auth || !user) return false;
    const doc = editor.house();
    try {
      await withAuth(async (token) => {
        if (!folderId) folderId = await ensureAppFolder(fetch, token);
        return createDesign(fetch, token, {
          folderId,
          designName: `${doc.name || "Plan"} copy`,
          house: doc,
        });
      });
      currentFile = null;
      remembered = null;
      driveLoaded = false;
      dirty = false;
      writeBinding(null);
      hideDrivePrompt();
      setStatus("saved", "Saved a copy to Drive");
      return true;
    } catch {
      setStatus("offline", "Not saved");
      return false;
    }
  }

  function unbind() {
    currentFile = null;
    remembered = null;
    driveLoaded = false;
    dirty = false;
    window.clearTimeout(timer);
    writeBinding(null);
    hideDrivePrompt();
  }

  return {
    onDocument,
    isSignedIn: () => Boolean(user && auth),
    saveUnsavedCopy,
    unbind,
  };
}

function shareLink(fileId) {
  const link = new URL(window.location.href);
  link.search = "";
  link.hash = "";
  link.searchParams.set("file", fileId);
  return link.toString();
}

function readBinding() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRIVE_KEY) || "null");
    if (!parsed?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBinding(file) {
  try {
    if (!file) localStorage.removeItem(DRIVE_KEY);
    else localStorage.setItem(DRIVE_KEY, JSON.stringify(file));
  } catch {
    // The house itself is still in the document key.
  }
}

function closeMenu() {
  const menu = document.querySelector("#file-menu");
  if (menu) menu.open = false;
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}
