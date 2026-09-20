import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applyPurchaseToDocument,
  collectPurchaseHistory,
  parsePurchaseBatch,
  parsePurchaseDescription,
  purchaseDetails,
} from "../www/core/purchases.js";
import { groupPurchaseHistoryByDate } from "../www/features/grocery.js";
import {
  matchReceiptLabelFromHistory,
  purchaseReviewState,
  PURCHASE_LAYOUT_CSS,
} from "../www/features/purchase-review-enhancements.js";
import { parseSupermarketReceipt } from "../www/features/receipt-purchases.js";

const snapshot = {
  ingredients: [{
    key: "tomato",
    name: "Tomato",
    price_history: [{ date: "2026-08-01", price: 2, price_basis: "kg", description: "Market check" }],
  }],
  household_items: [{
    key: "soap",
    name: "Hand soap",
    purchase_unit: "bottle",
    price_history: [],
  }],
  stock_options: [
    {
      item_key: "tomato",
      name: "Tomato",
      measure_unit: "piece",
      grams_per_measure_unit: 120,
      household: false,
    },
    {
      item_key: "soap",
      name: "Hand soap",
      measure_unit: "bottle",
      grams_per_measure_unit: 1,
      household: true,
    },
  ],
};

const document = {
  items: [
    {
      key: "tomato",
      name: "Tomato",
      grams: 100,
      kcal: 20,
      protein_g: 1,
      carbs_g: 4,
      fat_g: 0,
      fiber_g: 1,
      category: "Produce",
      source: "test",
      url: "",
      price: 2,
      price_basis: "kg",
      price_source: "old",
      price_checked_at: "2026-08-01",
      price_history: [{ date: "2026-08-01", price: 2, price_basis: "kg", description: "Market check" }],
      measure_unit: "piece",
      grams_per_measure_unit: 120,
      purchase_unit: "500 g",
      purchase_quantity: 500,
      purchase_quantity_unit: "g",
    },
    {
      key: "soap",
      name: "Hand soap",
      category: "Household",
      purchase_unit: "bottle",
      purchase_quantity: 1,
      estimated_price: 1.2,
      price_history: [],
      measure_unit: "bottle",
      last_bought_at: "",
      lasting_days: null,
      notes: "Bathroom",
      custom: false,
    },
  ],
  stock: [
    { item_key: "tomato", quantity: 1, quantity_unit: "unit", notes: "ripe" },
    { item_key: "soap", quantity: 1, quantity_unit: "unit" },
  ],
  dishes: [],
  people: [],
  menu: [],
  extra_needs: [],
};

const updated = applyPurchaseToDocument(document, {
  date: "2026-08-18",
  store: "Market",
  purchase_id: "purchase-test",
  lines: [
    {
      item_key: "tomato",
      quantity: 2,
      quantity_unit: "unit",
      display_unit: "piece",
      total_price: 3,
    },
    {
      item_key: "soap",
      quantity: 2,
      quantity_unit: "unit",
      display_unit: "bottle",
      total_price: 4.4,
    },
  ],
});

assert.equal(updated.items.find((item) => item.key === "tomato").price, 12.5);
assert.equal(updated.items.find((item) => item.key === "tomato").price_basis, "kg");
assert.equal(updated.stock.find((row) => row.item_key === "tomato").quantity, 3);
assert.equal(updated.items.find((item) => item.key === "soap").estimated_price, 2.2);
assert.equal(updated.stock.find((row) => row.item_key === "soap").quantity, 3);
const tomatoObservation = updated.items.find((item) => item.key === "tomato").price_history.at(-1);
assert.equal(tomatoObservation.description, "Market");
assert.deepEqual(tomatoObservation.purchase, {
  quantity: 2,
  unit: "piece",
  total_paid: 3,
  store: "Market",
  purchase_id: "purchase-test-1",
});
assert.deepEqual(purchaseDetails(tomatoObservation), {
    quantity: 2,
    unit: "piece",
    totalPrice: 3,
    store: "Market",
    purchaseId: "purchase-test-1",
});
assert.deepEqual(parsePurchaseDescription(
  "Purchase · qty=2 piece · total=3 EUR · store=Market · id=legacy-1",
), {
  quantity: 2,
  unit: "piece",
  totalPrice: 3,
  store: "Market",
  purchaseId: "legacy-1",
});

const withNewItems = applyPurchaseToDocument(updated, {
  date: "2026-08-18",
  purchase_id: "purchase-new",
  lines: [
    {
      quantity: 750,
      quantity_unit: "g",
      display_unit: "g",
      total_price: 2.25,
      new_item: { name: "Lentils", kind: "food" },
    },
    {
      quantity: 6,
      quantity_unit: "unit",
      display_unit: "roll",
      total_price: 3.6,
      new_item: { name: "Kitchen roll", kind: "household", measure_unit: "roll" },
    },
  ],
});
assert.equal(withNewItems.items.find((item) => item.name === "Lentils").price, 2.25);
assert.equal(withNewItems.items.find((item) => item.name === "Lentils").price_basis, "purchase_unit");
assert.equal(withNewItems.items.find((item) => item.name === "Kitchen roll").estimated_price, 3.6);

assert.throws(
  () => applyPurchaseToDocument(document, {
    date: "2026-08-18",
    lines: [{
      quantity: 1,
      quantity_unit: "unit",
      total_price: 2,
      new_item: { name: "Unknown fruit", kind: "food" },
    }],
  }),
  /purchase_new_food_requires_grams/,
);

const parsedReceipt = parseSupermarketReceipt(`ENTRETIEN DE LA MAISON
LING.DESINF.MULTI-US.SANYT.X72 4,41 € 13
3 x 1,47 EUR
ENTRETIEN DU LINGE
LESS.LIQ.SKIP PX SENS.2X1,554L 21,99 € 13
1 x 21,99 EUR
EAUX
EAU SRCE GAZ.CRISTALINE 6X1,5L 1,92 € 11
1 x 1,92 EUR
BOULANGERIE
PAIN NORDIQUE 1,90 € 11
1 x 1,90 EUR`, [
  { value: "pain_nordique", name: "Pain nordique", purchaseQuantityGrams: 450 },
  { value: "eau_petillante", name: "EAU SRCE GAZ.CRISTALINE", measureUnit: "L" },
]);
assert.deepEqual(
  parsedReceipt.map(({ quantity, unit, kind }) => ({ quantity, unit, kind })),
  [
    { quantity: 3, unit: "unit", kind: "household" },
    { quantity: 2, unit: "unit", kind: "household" },
    { quantity: 9, unit: "L", kind: "food" },
    { quantity: 450, unit: "g", kind: "food" },
  ],
);

const batch = parsePurchaseBatch([
  "name;quantity;unit;total;kind",
  "Tomato;2;piece;3.00",
  "Hand soap | 3 | bottle | 6.30",
  "Lentils\t1.5\tkg\t4,20\tfood",
  "Sponges;2;pack;3.50;household",
].join("\n"), snapshot);
assert.equal(batch.length, 4);
assert.equal(batch[0].item_key, "tomato");
assert.equal(batch[1].item_key, "soap");
assert.equal(batch[2].quantity, 1500);
assert.equal(batch[2].new_item.kind, "food");
assert.equal(batch[3].new_item.kind, "household");

const liquidBatch = parsePurchaseBatch("Olive oil;1;L;8.99", {
  ingredients: [{ key: "olive_oil", name: "Olive oil" }],
  household_items: [],
  stock_options: [{
    item_key: "olive_oil",
    name: "Olive oil",
    measure_unit: "ml",
    grams_per_measure_unit: 0.92,
    household: false,
  }],
});
assert.equal(liquidBatch[0].quantity, 1000);
assert.equal(liquidBatch[0].quantity_unit, "unit");
assert.equal(liquidBatch[0].display_unit, "ml");

const apricotMatch = matchReceiptLabelFromHistory("ABRICOT PRIX MINI BARQ.500G", [
  {
    value: "apricot",
    name: "Apricot",
    history: ["Ticket de caisse 2026-08-15 — ABRICOT PRIX MINI BARQ.500G, 1,99 EUR"],
  },
  {
    value: "peach",
    name: "Peach",
    history: ["Old market note about peaches"],
  },
]);
assert.equal(apricotMatch?.value, "apricot");
assert.equal(matchReceiptLabelFromHistory("UNKNOWN PRODUCT", [
  { value: "apricot", name: "Apricot", history: ["Some unrelated description"] },
]), null);
assert.equal(purchaseReviewState({ matched: true }), "known-item");
assert.equal(purchaseReviewState({ matched: false }), "new-item");
assert.equal(purchaseReviewState({ matched: true, warning: true }), "problem-item");
assert.match(PURCHASE_LAYOUT_CSS, /known-item\{[^}]*background:#dfeee4/);
assert.match(PURCHASE_LAYOUT_CSS, /new-item\{[^}]*background:#ddeaf6/);
assert.match(PURCHASE_LAYOUT_CSS, /problem-item\{[^}]*background:#f5ddd5/);
assert.match(PURCHASE_LAYOUT_CSS, /known-item \.receipt-review-field input[^}]*background:#eef7f1/);
assert.match(PURCHASE_LAYOUT_CSS, /new-item \.receipt-review-field input[^}]*background:#edf4fb/);
assert.match(PURCHASE_LAYOUT_CSS, /problem-item \.receipt-review-field input[^}]*background:#fbeeea/);
assert.match(PURCHASE_LAYOUT_CSS, /receipt-review-weight/);

const history = collectPurchaseHistory({
  ingredients: withNewItems.items.filter((item) => Object.hasOwn(item, "kcal")),
  household_items: withNewItems.items.filter((item) => Object.hasOwn(item, "estimated_price")),
});
assert.ok(history.some((row) => row.description === "Market check"));
assert.ok(history.some((row) => row.purchase?.purchaseId === "purchase-test-1"));
const groupedHistory = groupPurchaseHistoryByDate([
  { date: "2026-08-18", itemName: "Tomato" },
  { date: "2026-08-18", itemName: "Hand soap" },
  { date: "2026-08-01", itemName: "Tomato" },
  { date: "", itemName: "Undated" },
]);
assert.deepEqual(groupedHistory.map((group) => [group.date, group.purchases.length]), [
  ["2026-08-18", 2],
  ["2026-08-01", 1],
  ["", 1],
]);

const [groceryView, groceryFeature, shell, worker, app, composition, index, receiptFeature] = await Promise.all([
  readFile(new URL("../www/views/grocery.html", import.meta.url), "utf8"),
  readFile(new URL("../www/features/grocery.js", import.meta.url), "utf8"),
  readFile(new URL("../www/features/shell.js", import.meta.url), "utf8"),
  readFile(new URL("../www/worker.js", import.meta.url), "utf8"),
  readFile(new URL("../www/app.js", import.meta.url), "utf8"),
  readFile(new URL("../www/app/feature-composition.js", import.meta.url), "utf8"),
  readFile(new URL("../www/index.html", import.meta.url), "utf8"),
  readFile(new URL("../www/features/receipt-purchases.js", import.meta.url), "utf8"),
]);
assert.match(groceryView, /data-grocery-mode="purchases"/);
assert.match(groceryView, /id="purchase-add-form"/);
assert.match(groceryView, /id="purchase-batch-form"/);
assert.match(shell, /\["list", "stock", "needs", "purchases"\]/);
assert.match(worker, /type === "record-purchase"/);
assert.match(worker, /core\/purchases\.js\?v=homealacarte-110/);
assert.match(worker, /homealacarte_web\.js\?v=homealacarte-97/);
assert.match(groceryFeature, /core\/purchases\.js\?v=homealacarte-110/);
assert.match(composition, /features\/grocery\.js\?v=homealacarte-110/);
assert.match(composition, /features\/shell\.js\?v=homealacarte-91/);
const appVersion = index.match(/class="app-version"[^>]*>v(\d+)</)?.[1];
assert.ok(appVersion, "index.html must expose a numeric app version");
assert.match(app, new RegExp(`feature-composition\\.js\\?v=homealacarte-${appVersion}`));
assert.match(app, /worker\.js\?v=homealacarte-110/);
assert.match(index, new RegExp(`app\\.js\\?v=homealacarte-${appVersion}`));
assert.match(index, new RegExp(`features\\/receipt-purchases\\.js\\?v=homealacarte-${appVersion}`));
assert.match(index, new RegExp(`features\\/purchase-review-enhancements\\.js\\?v=homealacarte-${appVersion}`));
assert.match(index, /Incomplete catalogue items/);
assert.match(receiptFeature, /parseSupermarketReceipt/);

console.log("Purchases update stock and price history, color full review rows, make unresolved weights actionable, and keep cache versions aligned.");
