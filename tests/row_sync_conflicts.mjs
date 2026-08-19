import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyPendingRemote } from "../www/storage/local-store.js";
import { partitionOperationConflicts } from "../www/storage/row-sync.js";

const pendingUpsert = {
  recordKey: "items\u0000milk",
  operationId: "operation-milk-0001",
  operation: "upsert",
  entityType: "items",
  entityId: "milk",
  position: 2,
  payload: { key: "milk", name: "Milk" },
  expectedVersion: 5,
  createdAt: "2026-08-19T09:00:00.000Z",
};

assert.equal(
  classifyPendingRemote(pendingUpsert, {
    entity_type: "items",
    entity_id: "milk",
    position: 1,
    payload: { key: "milk", name: "Old milk" },
    record_version: 5,
    operation: "upsert",
  }),
  "keep-local",
  "a snapshot at the pending edit's base version must not become a conflict",
);

const equivalentRemote = {
  entity_type: "items",
  entity_id: "milk",
  position: 2,
  payload: { name: "Milk", key: "milk" },
  version: 6,
  operation: "upsert",
};
assert.equal(
  classifyPendingRemote(pendingUpsert, equivalentRemote),
  "reconcile",
  "an already-applied equivalent edit must clear the pending operation regardless of JSON object key order",
);

assert.equal(
  classifyPendingRemote(pendingUpsert, {
    ...equivalentRemote,
    payload: { key: "milk", name: "Oat milk" },
  }),
  "conflict",
  "a newer divergent edit must remain a real conflict",
);

assert.equal(
  classifyPendingRemote({
    ...pendingUpsert,
    operation: "delete",
    payload: null,
  }, {
    entity_type: "items",
    entity_id: "milk",
    position: 0,
    payload: null,
    record_version: 5,
    operation: "delete",
  }),
  "reconcile",
  "concurrent deletes with the same outcome are idempotent",
);

const semantic = partitionOperationConflicts([pendingUpsert], [equivalentRemote]);
assert.equal(semantic.reconciled.length, 1);
assert.equal(semantic.unresolved.length, 0);
assert.equal(semantic.reconciled[0].record_version, 6);

const genuine = partitionOperationConflicts([pendingUpsert], [{
  ...equivalentRemote,
  payload: { key: "milk", name: "Oat milk" },
}]);
assert.equal(genuine.reconciled.length, 0);
assert.equal(genuine.unresolved.length, 1);

const [rowSyncSource, storageSource, appSource, indexSource] = await Promise.all([
  readFile(new URL("../www/storage/row-sync.js", import.meta.url), "utf8"),
  readFile(new URL("../www/storage.js", import.meta.url), "utf8"),
  readFile(new URL("../www/app.js", import.meta.url), "utf8"),
  readFile(new URL("../www/index.html", import.meta.url), "utf8"),
]);
assert.match(rowSyncSource, /local-store\.js\?v=homealacarte-79/);
assert.match(storageSource, /local-store\.js\?v=homealacarte-79/);
assert.match(storageSource, /row-sync\.js\?v=homealacarte-81/);
assert.match(appSource, /storage\.js\?v=homealacarte-80/);
assert.match(indexSource, /app\.js\?v=homealacarte-95/);

console.log("Synchronization preserves pending base edits, reconciles identical outcomes, keeps divergent edits as conflicts, and refreshes the full cache chain.");
