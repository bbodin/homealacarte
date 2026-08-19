import {
  deletePrivateData,
  getStorageStatus,
  getStorageDiagnostics,
  getPrivateStateCopy,
  loadPrivacyRequests,
  loadPrivateState,
  onPrivateStateChange,
  onStorageStatus,
  resolveSyncConflict,
  savePrivateState,
  signIn,
  signOut,
  signUp,
  submitPrivacyRequest,
  synchronizePrivateState,
} from "./storage.js?v=homealacarte-80";
import { translations } from "./translations.js?v=homealacarte-77";
import {
  defaultLocale,
  hasTranslation,
  translate as translateUi,
} from "./core/ui-i18n.js?v=homealacarte-80";
import {
  createFormatters,
  displayCategory,
  externalHttpUrl,
  formatInputNumber,
  normalizedCategory,
  options,
} from "./core/format.js?v=homealacarte-77";
import { buildZip, downloadBytes, downloadText } from "./core/downloads.js?v=homealacarte-77";
import { createThemeController } from "./core/theme.js?v=homealacarte-77";
import { createAppState } from "./core/app-state.js?v=homealacarte-84";
import { createWorkerClient } from "./core/worker-client.js?v=homealacarte-77";
import { createWorkerResponseHandler } from "./core/worker-responses.js?v=homealacarte-77";
import { bootstrapApplication } from "./core/bootstrap.js?v=homealacarte-77";
import { createDom, escapeHtml } from "./core/dom.js?v=homealacarte-77";
import {
  createDishNutriScoreDetail,
  ingredientNutriScoreMissing,
} from "./core/nutrition.js?v=homealacarte-77";
import { createFeatureComposition } from "./app/feature-composition.js?v=homealacarte-91";
import { createAiDishFeature } from "./features/ai-dish.js?v=homealacarte-78";
import { createAiListFeature } from "./features/ai-list.js?v=homealacarte-82";
import { installUiConsistency } from "./features/ui-consistency.js?v=homealacarte-1";

document.documentElement.dataset.appModuleLoaded = "true";

const STORAGE_PREFIX = "homealacarte-";
const DATA_SCHEMA_VERSION = 11;
const EMPTY_DATABASE_CONTENT = `${JSON.stringify({
  items: [],
  dishes: [],
  people: [],
  menu: [],
  stock: [],
  extra_needs: [],
}, null, 2)}\n`;
const worker = new Worker("./worker.js?v=homealacarte-93", { type: "module" });
const state = createAppState(localStorage, getStorageStatus, defaultLocale(translations));
const themeController = createThemeController(state, localStorage, document.documentElement.style);
const applyColorTheme = themeController.apply;
const randomizeColorTheme = themeController.randomize;
const uiText = (language, key) => translateUi(translations, language, key);
const hasUiText = (language, key) => hasTranslation(translations, language, key);

const { select: $, selectAll: $$, optionalInputNumber } = createDom(document);
const {
  formatBytes,
  formatDateTime,
  formatMoney,
  formatNumber,
  translatedTemplate,
} = createFormatters(
  () => state.language,
  (key) => uiText(state.language, key),
);
const dishNutriScoreDetail = createDishNutriScoreDetail(translatedTemplate);

function setBusy(busy, message = "") {
  const status = $("#status");
  status.classList.toggle("ready", !busy);
  const busyMessage = message || uiText(state.language, "loading");
  if (busy) status.lastElementChild.textContent = busyMessage;
  state.engineBusy = busy;
  state.engineMessage = busy ? busyMessage : "";
  application?.renderHeaderStatus();
  const saveState = $("#save-state");
  if (saveState) {
    saveState.textContent = busy
      ? uiText(state.language, "saving")
      : uiText(state.language, "saved");
  }
  $$("#grocery-grid input[data-id]").forEach((input) => {
    input.disabled = busy;
  });
}

function localizeError(message, code = "") {
  if (code && hasUiText(state.language, code)) return uiText(state.language, code);
  const rawMessage = String(message || "");
  if (hasUiText(state.language, rawMessage)) return uiText(state.language, rawMessage);
  const prefixedKey = rawMessage.match(/^([a-z0-9_]+)(?::|$)/)?.[1];
  if (prefixedKey && hasUiText(state.language, prefixedKey)) {
    return uiText(state.language, prefixedKey);
  }
  const failedAsset = rawMessage.match(/Cannot load\s+(.+)/i);
  if (failedAsset) {
    return translatedTemplate("asset_load_error", { path: failedAsset[1] });
  }
  if (/failed to fetch|load failed|networkerror|network request failed/i.test(rawMessage)) {
    return uiText(state.language, "network_error");
  }
  if (/script error|module script|worker/i.test(rawMessage)) {
    return uiText(state.language, "worker_error");
  }
  if (/account deletion is (?:already )?pending/i.test(rawMessage)) {
    return uiText(state.language, "delete_data_already_pending");
  }
  if (/account not found/i.test(rawMessage)) {
    return uiText(state.language, "delete_data_account_not_found");
  }
  return rawMessage;
}

function showError(message, code = "") {
  state.lastError = { message, code };
  const panel = $("#error-panel");
  panel.textContent = localizeError(message, code);
  panel.title = String(message || code || "");
  panel.hidden = false;
  setBusy(false);
}

function clearError() {
  state.lastError = null;
  $("#error-panel").hidden = true;
  application?.renderStorageStatus(state.storageStatus);
}

const handleWorkerMessage = createWorkerResponseHandler({
  state,
  select: $,
  translate: (key) => uiText(state.language, key),
  setBusy,
  showError,
  clearError,
  downloadText,
  downloadBytes,
  buildZip,
  documentRef: document,
  urlApi: URL,
  BlobClass: Blob,
  persistDraft: (...args) => application.persistDraft(...args),
  render: (...args) => application.render(...args),
  renderAutoMenuResult: (...args) => application.renderAutoMenuResult(...args),
  send: (...args) => workerClient.send(...args),
});

const workerClient = createWorkerClient({
  worker,
  state,
  setBusy,
  handleMessage: handleWorkerMessage,
  handleError: showError,
});
const send = workerClient.send;

const application = createFeatureComposition({
  state,
  select: $,
  selectAll: $$,
  documentRef: document,
  historyRef: history,
  locationRef: location,
  storage: localStorage,
  translate: (key) => uiText(state.language, key),
  translations,
  randomizeColorTheme,
  applyColorTheme,
  displayCategory,
  normalizedCategory,
  escapeHtml,
  externalHttpUrl,
  formatInputNumber,
  options,
  optionalInputNumber,
  formatBytes,
  formatDateTime,
  formatMoney,
  formatNumber,
  translatedTemplate,
  ingredientNutriScoreMissing,
  dishNutriScoreDetail,
  downloadText,
  getStorageStatus,
  getStorageDiagnostics,
  getPrivateStateCopy,
  loadPrivacyRequests,
  deletePrivateData,
  resolveSyncConflict,
  savePrivateState,
  signIn,
  signOut,
  signUp,
  submitPrivacyRequest,
  synchronizePrivateState,
  storagePrefix: STORAGE_PREFIX,
  dataSchemaVersion: DATA_SCHEMA_VERSION,
  emptyDatabaseContent: EMPTY_DATABASE_CONTENT,
  setBusy,
  send,
  showError,
  localizeError,
});
const aiDishFeature = createAiDishFeature({
  state,
  select: $,
  documentRef: document,
  storage: localStorage,
  locationRef: location,
  send,
});
const aiListFeature = createAiListFeature({
  state,
  select: $,
  documentRef: document,
  storage: localStorage,
  locationRef: location,
  send,
});
application.mount();
aiDishFeature.mount();
aiListFeature.mount();
installUiConsistency({
  state,
  documentRef: document,
  formatInputNumber,
  translate: (key) => uiText(state.language, key),
});

onStorageStatus(application.renderStorageStatus);
onPrivateStateChange(() => location.reload());
bootstrapApplication({
  state,
  requestedTab: location.hash.slice(1),
  loadPrivateState,
  applyColorTheme,
  applyTranslations: application.applyTranslations,
  switchTab: application.switchTab,
  send,
});