import {
  clearLocalState,
  readLocalState,
  readSyncMeta,
} from "./storage/local-store.js?v=homealacarte-79";
import { createRemoteClient } from "./storage/remote-client.js?v=homealacarte-79";
import { createRowSync } from "./storage/row-sync.js?v=homealacarte-81";

let syncStatus = { state: "local", email: "", message: "" };

function emitStatus(next) {
  syncStatus = {
    ...syncStatus,
    ...next,
    email: next.email ?? remoteClient.getSession()?.user?.email ?? syncStatus.email ?? "",
  };
  globalThis.dispatchEvent?.(
    new CustomEvent("homealacarte-storage-status", { detail: { ...syncStatus } }),
  );
}

function notifyRemoteChange(value) {
  globalThis.dispatchEvent?.(
    new CustomEvent("homealacarte-private-state-changed", { detail: value }),
  );
}

const remoteClient = createRemoteClient({ emitStatus });
const rowSync = createRowSync({ remoteClient, emitStatus, notifyRemoteChange });
syncStatus.email = remoteClient.getSession()?.user?.email || "";

const {
  authRequest,
  ensureSession,
  fetchRemoteSnapshot,
  getSession,
  isNetworkError,
  loadConfig,
  normalizeSession,
  restRequest,
  saveSession,
} = remoteClient;

export function getStorageStatus() {
  return { ...syncStatus };
}

export function onStorageStatus(listener) {
  const handler = (event) => listener(event.detail);
  globalThis.addEventListener("homealacarte-storage-status", handler);
  listener(getStorageStatus());
  return () => globalThis.removeEventListener("homealacarte-storage-status", handler);
}

export function onPrivateStateChange(listener) {
  const handler = (event) => listener(event.detail);
  globalThis.addEventListener("homealacarte-private-state-changed", handler);
  return () => globalThis.removeEventListener("homealacarte-private-state-changed", handler);
}

function jsonSize(value) {
  return value === undefined ? 0 : new TextEncoder().encode(JSON.stringify(value)).length;
}

export async function loadPrivateState() {
  const value = await rowSync.load();
  rowSync.startPolling();
  return value;
}

export async function savePrivateState(value) {
  return rowSync.save(value);
}

export async function deletePrivateData() {
  rowSync.stop();
  const hadSession = Boolean(getSession());
  const activeSession = await ensureSession();
  if (hadSession && !activeSession) throw new Error("delete_data_online_required");
  if (activeSession) {
    const deleted = await restRequest("rpc/request_account_deletion", {
      method: "POST",
      body: "{}",
    });
    if (deleted !== true) throw new Error("delete_data_account_not_found");
    const accessToken = activeSession.access_token;
    saveSession(null);
    authRequest("logout", null, accessToken).catch(() => {});
  }
  await clearLocalState();
  emitStatus({
    state: (await loadConfig()) ? "signed-out" : "local",
    email: "",
    message: "",
  });
  return { accountDeleted: Boolean(activeSession) };
}

export async function loadPrivacyRequests() {
  const activeSession = await ensureSession();
  if (!activeSession?.user?.id) return [];
  return restRequest(
    "privacy_requests"
      + "?select=id,request_type,message,status,response_message,created_at,updated_at,resolved_at"
      + "&order=created_at.desc",
  );
}

export async function submitPrivacyRequest(requestType, message) {
  const created = await restRequest("rpc/submit_privacy_request", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      requested_type: requestType,
      requested_message: message,
    }),
  });
  return Array.isArray(created) ? created[0] : created;
}

export async function getStorageDiagnostics() {
  const local = await readLocalState();
  const meta = await readSyncMeta();
  const config = await loadConfig();
  let remote = null;
  let remoteError = "";
  if (config && getSession()) {
    try {
      remote = await fetchRemoteSnapshot();
    } catch (error) {
      remoteError = error?.message || String(error);
    }
  }
  let estimate = {};
  try {
    estimate = await navigator.storage?.estimate?.() || {};
  } catch {
    estimate = {};
  }
  return {
    configured: Boolean(config),
    email: getSession()?.user?.email || "",
    userId: getSession()?.user?.id || "",
    controllerName: config?.controllerName || "",
    privacyContact: config?.privacyContact || "",
    lawfulBasis: config?.lawfulBasis || "",
    retentionPolicy: config?.retentionPolicy || "",
    localBytes: jsonSize(local),
    localUpdatedAt: meta.locallyUpdatedAt || "",
    originBytes: Number(estimate.usage || 0),
    originQuotaBytes: Number(estimate.quota || 0),
    remoteBytes: jsonSize(remote?.records),
    remoteCursor: remote?.cursor ?? null,
    remoteUpdatedAt: remote?.updated_at || "",
    remoteError,
  };
}

export async function getPrivateStateCopy() {
  return readLocalState();
}

export async function signIn(email, password) {
  emitStatus({ state: "connecting", message: "" });
  const data = await authRequest("token?grant_type=password", { email, password });
  const nextSession = normalizeSession(data);
  if (!nextSession) throw new Error("Supabase returned an invalid session");
  saveSession(nextSession);
  emitStatus({ state: "connecting", email: nextSession.user?.email || email, message: "" });
  return nextSession;
}

export async function signUp(email, password) {
  emitStatus({ state: "connecting", message: "" });
  const redirectTo = `${location.origin}${location.pathname}`;
  const data = await authRequest(`signup?redirect_to=${encodeURIComponent(redirectTo)}`, {
    email,
    password,
    data: {
      privacy_accepted: true,
      health_data_consent: true,
      authority_confirmed: true,
    },
  });
  const nextSession = normalizeSession(data);
  if (nextSession) {
    saveSession(nextSession);
    emitStatus({ state: "connecting", email: nextSession.user?.email || email, message: "" });
  } else {
    emitStatus({ state: "signed-out", email, message: "confirmation_required" });
  }
  return { confirmationRequired: !nextSession };
}

export async function signOut() {
  rowSync.stop();
  const activeSession = getSession();
  saveSession(null);
  emitStatus({ state: "signed-out", email: "", message: "" });
  if (activeSession?.access_token) {
    await authRequest("logout", null, activeSession.access_token).catch(() => {});
  }
}

export async function synchronizePrivateState() {
  return rowSync.synchronize(true);
}

export async function resolveSyncConflict(choice) {
  return rowSync.resolve(choice);
}

globalThis.addEventListener?.("online", () => rowSync.queueSynchronization());
globalThis.addEventListener?.("offline", () => emitStatus({ state: "offline", message: "" }));

globalThis.addEventListener?.("focus", () => {
  rowSync.synchronize(true).catch((error) => {
    if (!isNetworkError(error)) console.warn("Unable to refresh synchronized data", error);
  });
});
