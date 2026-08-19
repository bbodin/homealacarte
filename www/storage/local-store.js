import {
  normalizeRemoteRecord,
  privateStateToRecords,
  recordsToPrivateState,
  sameRecordContent,
} from "./row-codec.js?v=homealacarte-78";

const DB_NAME = "homealacarte-private";
const DB_VERSION = 2;
const LEGACY_STORE = "state";
const LEGACY_ACTIVE_KEY = "active";
const LEGACY_META_KEY = "sync-meta";
const RECORDS_STORE = "records";
const OUTBOX_STORE = "outbox";
const META_STORE = "metadata";
const SYNC_META_KEY = "sync";

let writeChain = Promise.resolve();

function operationId() {
  return globalThis.crypto?.randomUUID?.()
    || `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LEGACY_STORE)) database.createObjectStore(LEGACY_STORE);
      if (!database.objectStoreNames.contains(RECORDS_STORE)) {
        database.createObjectStore(RECORDS_STORE, { keyPath: "recordKey" });
      }
      if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
        database.createObjectStore(OUTBOX_STORE, { keyPath: "recordKey" });
      }
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

async function readStores(storeNames) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeNames, "readonly");
    const completed = transactionDone(transaction);
    const values = await Promise.all(storeNames.map((name) => {
      const store = transaction.objectStore(name);
      return requestValue(name === META_STORE ? store.get(SYNC_META_KEY) : store.getAll());
    }));
    await completed;
    return Object.fromEntries(storeNames.map((name, index) => [name, values[index]]));
  } finally {
    database.close();
  }
}

async function readLegacy() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(LEGACY_STORE, "readonly");
    const completed = transactionDone(transaction);
    const store = transaction.objectStore(LEGACY_STORE);
    const [value, meta] = await Promise.all([
      requestValue(store.get(LEGACY_ACTIVE_KEY)),
      requestValue(store.get(LEGACY_META_KEY)),
    ]);
    await completed;
    return { value, meta: meta || {} };
  } finally {
    database.close();
  }
}

function enqueueWrite(operation) {
  const next = writeChain.then(operation, operation);
  writeChain = next.catch(() => {});
  return next;
}

async function writeStateNow(value, metaPatch = {}) {
  const desired = privateStateToRecords(value);
  const currentState = await readStores([RECORDS_STORE, OUTBOX_STORE, META_STORE]);
  const current = new Map(currentState[RECORDS_STORE].map((row) => [row.recordKey, row]));
  const outbox = new Map(currentState[OUTBOX_STORE].map((row) => [row.recordKey, row]));
  const desiredKeys = new Set(desired.map((row) => row.recordKey));
  const puts = [];
  const deletes = [];

  for (const row of desired) {
    const existing = current.get(row.recordKey);
    if (existing && sameRecordContent(existing, row)) continue;
    const pending = outbox.get(row.recordKey);
    const nextRow = { ...row, version: Number(existing?.version || 0) };
    puts.push({ row: nextRow, operation: {
      recordKey: row.recordKey,
      operationId: pending?.operationId || operationId(),
      operation: "upsert",
      entityType: row.entityType,
      entityId: row.entityId,
      position: row.position,
      payload: row.payload,
      expectedVersion: Number(pending?.expectedVersion ?? existing?.version ?? 0),
      createdAt: pending?.createdAt || new Date().toISOString(),
    } });
  }

  for (const existing of current.values()) {
    if (desiredKeys.has(existing.recordKey)) continue;
    const pending = outbox.get(existing.recordKey);
    if (pending?.operation === "upsert" && Number(pending.expectedVersion) === 0) {
      deletes.push({ recordKey: existing.recordKey, cancelPending: true });
    } else {
      deletes.push({ recordKey: existing.recordKey, operation: {
        recordKey: existing.recordKey,
        operationId: pending?.operationId || operationId(),
        operation: "delete",
        entityType: existing.entityType,
        entityId: existing.entityId,
        expectedVersion: Number(pending?.expectedVersion ?? existing.version ?? 0),
        createdAt: pending?.createdAt || new Date().toISOString(),
      } });
    }
  }

  if (!puts.length && !deletes.length) return { changed: false, pending: outbox.size };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [RECORDS_STORE, OUTBOX_STORE, META_STORE, LEGACY_STORE],
      "readwrite",
    );
    const completed = transactionDone(transaction);
    const recordsStore = transaction.objectStore(RECORDS_STORE);
    const outboxStore = transaction.objectStore(OUTBOX_STORE);
    puts.forEach(({ row, operation }) => {
      recordsStore.put(row);
      outboxStore.put(operation);
    });
    deletes.forEach(({ recordKey, operation, cancelPending }) => {
      recordsStore.delete(recordKey);
      if (cancelPending) outboxStore.delete(recordKey);
      else outboxStore.put(operation);
    });
    const pendingCount = outbox.size
      + puts.filter(({ row }) => !outbox.has(row.recordKey)).length
      + deletes.filter(({ recordKey, operation }) => operation && !outbox.has(recordKey)).length
      - deletes.filter(({ cancelPending }) => cancelPending).length;
    transaction.objectStore(META_STORE).put({
      ...(currentState[META_STORE] || {}),
      ...metaPatch,
      dirty: pendingCount > 0,
      locallyUpdatedAt: new Date().toISOString(),
    }, SYNC_META_KEY);
    transaction.objectStore(LEGACY_STORE).delete(LEGACY_ACTIVE_KEY);
    transaction.objectStore(LEGACY_STORE).delete(LEGACY_META_KEY);
    await completed;
    return { changed: true, pending: Math.max(0, pendingCount) };
  } finally {
    database.close();
  }
}

async function ensureLegacyMigrated() {
  const { [RECORDS_STORE]: records } = await readStores([RECORDS_STORE]);
  if (records.length) return;
  const legacy = await readLegacy();
  if (legacy.value !== undefined) {
    await enqueueWrite(() => writeStateNow(legacy.value, {
      userId: legacy.meta.userId || null,
      legacyRemoteRevision: legacy.meta.remoteRevision ?? null,
      legacyDirty: Boolean(legacy.meta.dirty),
    }));
  }
}

export async function readLocalState() {
  await ensureLegacyMigrated();
  const { [RECORDS_STORE]: records } = await readStores([RECORDS_STORE]);
  return records.length ? recordsToPrivateState(records) : undefined;
}

export async function readLocalRecords() {
  await ensureLegacyMigrated();
  return (await readStores([RECORDS_STORE]))[RECORDS_STORE];
}

export async function readSyncMeta() {
  await ensureLegacyMigrated();
  return (await readStores([META_STORE]))[META_STORE] || {};
}

export function writeLocalState(value, meta = {}) {
  return enqueueWrite(() => writeStateNow(value, meta));
}

export async function readPendingOperations() {
  await ensureLegacyMigrated();
  return (await readStores([OUTBOX_STORE]))[OUTBOX_STORE]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function operationMatches(left, right) {
  return left.operationId === right.operationId
    && left.operation === right.operation
    && left.position === right.position
    && JSON.stringify(left.payload) === JSON.stringify(right.payload);
}

function sameJsonValue(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJsonValue(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && sameJsonValue(left[key], right[key])
    ));
}

export function classifyPendingRemote(pending, change) {
  const remote = normalizeRemoteRecord(change);
  const remoteOperation = change.operation || "upsert";
  if (!pending) return "apply";
  if (pending.operation === "delete" && remoteOperation === "delete") return "reconcile";
  if (pending.operation === "upsert"
    && remoteOperation === "upsert"
    && Number(pending.position || 0) === remote.position
    && sameJsonValue(pending.payload, remote.payload)) {
    return "reconcile";
  }
  if (remoteOperation === "upsert"
    && remote.version === Number(pending.expectedVersion || 0)) {
    return "keep-local";
  }
  return "conflict";
}

export function acknowledgeOperations(sentOperations, appliedChanges, cursor, userId) {
  return enqueueWrite(async () => {
    const currentState = await readStores([RECORDS_STORE, OUTBOX_STORE, META_STORE]);
    const pending = new Map(currentState[OUTBOX_STORE].map((row) => [row.recordKey, row]));
    const sent = new Map(sentOperations.map((row) => [row.recordKey, row]));
    const database = await openDatabase();
    try {
      const transaction = database.transaction([RECORDS_STORE, OUTBOX_STORE, META_STORE], "readwrite");
      const completed = transactionDone(transaction);
      const recordsStore = transaction.objectStore(RECORDS_STORE);
      const outboxStore = transaction.objectStore(OUTBOX_STORE);
      for (const change of appliedChanges) {
        const remote = normalizeRemoteRecord(change);
        const currentPending = pending.get(remote.recordKey);
        const sentOperation = sent.get(remote.recordKey);
        if (change.operation === "delete") recordsStore.delete(remote.recordKey);
        else if (!currentPending || operationMatches(currentPending, sentOperation)) recordsStore.put(remote);
        else {
          const local = currentState[RECORDS_STORE].find((row) => row.recordKey === remote.recordKey);
          if (local) recordsStore.put({ ...local, version: remote.version });
        }
        if (currentPending && operationMatches(currentPending, sentOperation)) {
          outboxStore.delete(remote.recordKey);
          pending.delete(remote.recordKey);
        } else if (currentPending) {
          outboxStore.put({
            ...currentPending,
            operationId: operationId(),
            expectedVersion: remote.version,
          });
        }
      }
      transaction.objectStore(META_STORE).put({
        ...(currentState[META_STORE] || {}),
        cursor: Number(cursor || 0),
        userId,
        dirty: pending.size > 0,
        lastSyncedAt: new Date().toISOString(),
      }, SYNC_META_KEY);
      await completed;
    } finally {
      database.close();
    }
  });
}

export function applyRemoteChanges(changes, cursor, userId, replace = false) {
  return enqueueWrite(async () => {
    const currentState = await readStores([RECORDS_STORE, OUTBOX_STORE, META_STORE]);
    const pending = new Map(currentState[OUTBOX_STORE].map((row) => [row.recordKey, row]));
    const remoteKeys = new Set();
    const conflicts = [];
    const database = await openDatabase();
    try {
      const transaction = database.transaction(
        [RECORDS_STORE, OUTBOX_STORE, META_STORE],
        "readwrite",
      );
      const completed = transactionDone(transaction);
      const recordsStore = transaction.objectStore(RECORDS_STORE);
      const outboxStore = transaction.objectStore(OUTBOX_STORE);
      for (const change of changes) {
        const remote = normalizeRemoteRecord(change);
        remoteKeys.add(remote.recordKey);
        const pendingOperation = pending.get(remote.recordKey);
        const action = classifyPendingRemote(pendingOperation, change);
        if (action === "reconcile") {
          if (change.operation === "delete") recordsStore.delete(remote.recordKey);
          else recordsStore.put(remote);
          outboxStore.delete(remote.recordKey);
          pending.delete(remote.recordKey);
        } else if (action === "keep-local") {
          continue;
        } else if (action === "conflict") {
          conflicts.push({ remote, operation: change.operation || "upsert" });
        } else if (change.operation === "delete") {
          recordsStore.delete(remote.recordKey);
        } else {
          recordsStore.put(remote);
        }
      }
      if (replace) {
        for (const local of currentState[RECORDS_STORE]) {
          if (!remoteKeys.has(local.recordKey) && !pending.has(local.recordKey)) {
            recordsStore.delete(local.recordKey);
          }
        }
      }
      transaction.objectStore(META_STORE).put({
        ...(currentState[META_STORE] || {}),
        cursor: Number(cursor || 0),
        userId,
        dirty: pending.size > 0,
        lastSyncedAt: new Date().toISOString(),
      }, SYNC_META_KEY);
      await completed;
    } finally {
      database.close();
    }
    return conflicts;
  });
}

export function resolveLocalConflicts(conflicts, choice) {
  return enqueueWrite(async () => {
    const currentState = await readStores([RECORDS_STORE, OUTBOX_STORE, META_STORE]);
    const database = await openDatabase();
    try {
      const transaction = database.transaction([RECORDS_STORE, OUTBOX_STORE, META_STORE], "readwrite");
      const completed = transactionDone(transaction);
      const recordsStore = transaction.objectStore(RECORDS_STORE);
      const outboxStore = transaction.objectStore(OUTBOX_STORE);
      for (const conflict of conflicts) {
        const remote = normalizeRemoteRecord(conflict.remote);
        if (choice === "remote") {
          outboxStore.delete(remote.recordKey);
          if (conflict.operation === "delete") recordsStore.delete(remote.recordKey);
          else recordsStore.put(remote);
        } else {
          const pending = currentState[OUTBOX_STORE].find((row) => row.recordKey === remote.recordKey);
          if (pending) outboxStore.put({
            ...pending,
            operationId: operationId(),
            expectedVersion: conflict.operation === "delete" ? 0 : remote.version,
          });
        }
      }
      const remaining = choice === "remote"
        ? Math.max(0, currentState[OUTBOX_STORE].length - conflicts.length)
        : currentState[OUTBOX_STORE].length;
      transaction.objectStore(META_STORE).put({
        ...(currentState[META_STORE] || {}),
        dirty: remaining > 0,
      }, SYNC_META_KEY);
      await completed;
    } finally {
      database.close();
    }
  });
}

export async function clearLocalState() {
  await enqueueWrite(async () => {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(
        [RECORDS_STORE, OUTBOX_STORE, META_STORE, LEGACY_STORE],
        "readwrite",
      );
      const completed = transactionDone(transaction);
      transaction.objectStore(RECORDS_STORE).clear();
      transaction.objectStore(OUTBOX_STORE).clear();
      transaction.objectStore(META_STORE).clear();
      transaction.objectStore(LEGACY_STORE).clear();
      await completed;
    } finally {
      database.close();
    }
  });
}
