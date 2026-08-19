import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [index, entry, app, feature, dialogs] = await Promise.all([
  readFile(new URL("../www/index.html", import.meta.url), "utf8"),
  readFile(new URL("../www/app.js", import.meta.url), "utf8"),
  readFile(new URL("../www/app/feature-composition.js", import.meta.url), "utf8"),
  readFile(new URL("../www/features/dish-editor.js", import.meta.url), "utf8"),
  readFile(new URL("../www/views/dialogs.html", import.meta.url), "utf8"),
]);

assert.match(app, /createDishEditorFeature/);
assert.match(app, /dishEditorFeature\.mount\(\)/);
assert.doesNotMatch(app, /selectAll: \$,/);
assert.doesNotMatch(app, /#new-dish-form.*addEventListener/);
assert.match(feature, /#new-dish-form.*addEventListener/);
assert.match(feature, /send\("save-dish"/);
assert.match(feature, /customIngredients/);
assert.match(feature, /setDishComponentMode/);
assert.match(feature, /#new-dish-intro"\)\.textContent = translate\(/);
assert.match(feature, /localizedFormValues/);
assert.match(feature, /renderLocalizedInputs/);
assert.match(feature, /name_i18n: nameI18n/);
assert.match(feature, /origin_country: normalizeOriginCountry/);
assert.doesNotMatch(feature, /new-dish-name-(?:en|fr)/);
assert.doesNotMatch(feature, /\bt\s*\(/);
assert.match(dialogs, /id="new-dish-name-fields"/);
assert.doesNotMatch(dialogs, /id="new-dish-name-(?:en|fr)"/);
assert.match(dialogs, /id="new-dish-origin-country"/);
assert.match(dialogs, /class="show-only-control new-dish-auto-menu-control"/);
assert.doesNotMatch(dialogs, /dialog-field-wide show-only-control/);
assert.match(app, /const locales = Object\.keys\(translations\)/);
assert.match(index, /app\.js\?v=homealacarte-95/);
assert.match(entry, /app\/feature-composition\.js\?v=homealacarte-91/);
assert.match(entry, /worker\.js\?v=homealacarte-93/);
assert.match(app, /features\/dish-editor\.js\?v=homealacarte-80/);

console.log("Dish editor generates localized name fields from the shared locale list and keeps country metadata separate.");