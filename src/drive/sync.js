/** When to load a remembered Drive file, and when an edit may be uploaded. */

export const DRIVE_DEBOUNCE_MS = 4_000;
export const DRIVE_INTERVAL_MS = 30_000;

/**
 * Page load. A remembered file is read from Drive, or the user is asked to
 * reconnect. The house on this device is not uploaded over that file.
 */
export function driveBootAction({ fileId, signedIn }) {
  if (!fileId) return { action: "keep-local" };
  if (signedIn) return { action: "load", fileId };
  return { action: "prompt", fileId };
}

/** True only after the Drive copy has been loaded (or just saved) and still has edits. */
export function shouldUploadToDrive({ dirty, loaded, signedIn, paused, saving }) {
  return Boolean(dirty && loaded && signedIn && !paused && !saving);
}
