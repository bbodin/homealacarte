import assert from "node:assert/strict";

const origin = process.argv[2] || "http://127.0.0.1:18082";
const port = process.argv[3] || "9224";
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === "page");
assert.ok(target?.webSocketDebuggerUrl, "Chromium page target is available");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function command(method, params = {}) {
  const id = nextId;
  nextId += 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const expectedLabels = ["Fruit", "Vegetables"];
const labelsExpression = `[...document.querySelectorAll(".spending-donut-labels text")]
  .map((node) => node.textContent.trim()).sort()`;

await command("Page.enable");
await command("Runtime.enable");
await command("Page.navigate", { url: `${origin}/#grocery` });
await waitFor(
  `document.documentElement?.dataset.appModuleLoaded === "true"
    && document.querySelector("#grocery-spending-tab")
    && globalThis.homealacarteState?.snapshot
    && !globalThis.homealacarteState.engineBusy`,
  "the loaded grocery view",
);

await evaluate(`(() => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const date = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  const observation = (total, id) => ({
    date,
    price: total,
    price_basis: "purchase_unit",
    description: "Browser test",
    purchase: {
      quantity: 1,
      unit: "unit",
      total_paid: total,
      store: "Browser test",
      purchase_id: id,
    },
  });
  globalThis.homealacarteState.snapshot = {
    ingredients: [
      { key: "apple", name: "Apple", category: "Produce::Fruit", price_history: [observation(10, "fruit")] },
      { key: "carrot", name: "Carrot", category: "Produce::Vegetables", price_history: [observation(6, "veg")] },
      { key: "milk", name: "Milk", category: "Dairy::Milk", price_history: [observation(4, "milk")] },
    ],
    household_items: [],
  };
  document.querySelector("#grocery-spending-tab").click();
})()`);

await waitFor(
  `document.querySelector('.spending-donut-category-segment[data-donut-category="Produce"]')`,
  "the Produce category segment",
);

await evaluate(`document.querySelector('.spending-donut-category-segment[data-donut-category="Produce"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
await waitFor(
  `JSON.stringify(${labelsExpression}) === JSON.stringify(${JSON.stringify(expectedLabels)})`,
  "Produce subcategory labels after clicking the category",
);
const categoryLabels = await evaluate(labelsExpression);
assert.deepEqual(categoryLabels, expectedLabels);

await evaluate(`document.querySelector('.spending-donut-subcategory-segment[data-donut-category="Produce"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
await waitFor(
  `JSON.stringify(${labelsExpression}) === JSON.stringify(${JSON.stringify(expectedLabels)})`,
  "Produce subcategory labels after clicking a subcategory",
);
const subcategoryLabels = await evaluate(labelsExpression);
assert.deepEqual(subcategoryLabels, expectedLabels);
assert.deepEqual(subcategoryLabels, categoryLabels);

socket.close();
console.log("Category and subcategory clicks both reveal the full parent-category subcategory label set in Chromium.");
