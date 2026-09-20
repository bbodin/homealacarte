import { collectPurchaseHistory } from "../core/purchases.js?v=homealacarte-110";

const STRINGS = {
  en: {
    tab: "Spending",
    eyebrow: "Purchase insights",
    title: "Grocery spending analysis",
    intro: "Track recorded grocery spending over time and see where the budget goes.",
    thisWeek: "This week",
    thisMonth: "This month",
    recordedSpend: "Recorded spend",
    purchaseLines: "Purchase lines",
    weekly: "Weekly spending",
    weeklyIntro: "Last 8 weeks",
    monthly: "Monthly spending",
    monthlyIntro: "Last 6 months",
    categories: "Spending by category",
    categoriesIntro: "Selected period",
    stores: "Spending by store",
    storesIntro: "Selected period",
    selectMonth: "Select period",
    entirePeriod: "Entire period",
    frequent: "Frequently purchased products",
    frequentIntro: "Across recorded purchase history",
    product: "Product",
    purchases: "Purchases",
    spend: "Spend",
    noPurchases: "No recorded purchases yet.",
    noPeriodPurchases: "No purchases recorded for this period.",
    unknownCategory: "Uncategorized",
    unknownSubcategory: "Other",
    categoryRing: "Categories",
    subcategoryRing: "Subcategories",
    total: "Total",
    unknownStore: "Store not specified",
  },
  fr: {
    tab: "Dépenses",
    eyebrow: "Analyse des achats",
    title: "Analyse des dépenses de courses",
    intro: "Suivez les dépenses de courses enregistrées dans le temps et leur répartition.",
    thisWeek: "Cette semaine",
    thisMonth: "Ce mois-ci",
    recordedSpend: "Dépenses enregistrées",
    purchaseLines: "Lignes d’achat",
    weekly: "Dépenses hebdomadaires",
    weeklyIntro: "8 dernières semaines",
    monthly: "Dépenses mensuelles",
    monthlyIntro: "6 derniers mois",
    categories: "Dépenses par catégorie",
    categoriesIntro: "Période sélectionnée",
    stores: "Dépenses par magasin",
    storesIntro: "Période sélectionnée",
    selectMonth: "Sélectionner la période",
    entirePeriod: "Toute la période",
    frequent: "Produits achetés fréquemment",
    frequentIntro: "Sur l’historique des achats enregistrés",
    product: "Produit",
    purchases: "Achats",
    spend: "Dépenses",
    noPurchases: "Aucun achat enregistré pour le moment.",
    noPeriodPurchases: "Aucun achat enregistré sur cette période.",
    unknownCategory: "Sans catégorie",
    unknownSubcategory: "Autre",
    categoryRing: "Catégories",
    subcategoryRing: "Sous-catégories",
    total: "Total",
    unknownStore: "Magasin non renseigné",
  },
};

function stringsFor(language) {
  const requested = String(language || "").toLowerCase();
  return STRINGS[requested] || STRINGS[requested.split("-")[0]] || STRINGS.en;
}

function dateKey(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function mondayStart(date) {
  const day = date.getUTCDay();
  return addUtcDays(date, -(day === 0 ? 6 : day - 1));
}

function monthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function sum(rows) {
  return rows.reduce((total, row) => total + row.totalPrice, 0);
}

function aggregate(rows, keyFor) {
  const totals = new Map();
  rows.forEach((row) => {
    const key = keyFor(row);
    const current = totals.get(key) || { key, spend: 0, count: 0 };
    current.spend += row.totalPrice;
    current.count += 1;
    totals.set(key, current);
  });
  return [...totals.values()].sort((left, right) => (
    right.spend - left.spend || right.count - left.count || left.key.localeCompare(right.key)
  ));
}

function catalogueCategoryMap(snapshot, fallback) {
  const map = new Map();
  [...(snapshot?.ingredients || []), ...(snapshot?.household_items || [])].forEach((item) => {
    map.set(String(item?.key || ""), String(item?.category || "").trim() || fallback);
  });
  return map;
}

function categoryParts(value, fallbackCategory, fallbackSubcategory) {
  const parts = String(value || "").split("::")
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    category: parts[0] || fallbackCategory,
    subcategory: parts.slice(1).join(" › ") || fallbackSubcategory,
  };
}

function aggregateCategoryBreakdown(rows) {
  const byCategory = aggregate(rows, (row) => row.category);
  const categoryOrder = new Map(byCategory.map((row, index) => [row.key, index]));
  const totals = new Map();
  rows.forEach((row) => {
    const id = `${row.category}::${row.subcategory}`;
    const current = totals.get(id) || {
      key: row.subcategory,
      category: row.category,
      spend: 0,
      count: 0,
    };
    current.spend += row.totalPrice;
    current.count += 1;
    totals.set(id, current);
  });
  const bySubcategory = [...totals.values()].sort((left, right) => (
    (categoryOrder.get(left.category) ?? Number.MAX_SAFE_INTEGER)
      - (categoryOrder.get(right.category) ?? Number.MAX_SAFE_INTEGER)
    || right.spend - left.spend
    || right.count - left.count
    || left.key.localeCompare(right.key)
  ));
  return { byCategory, bySubcategory };
}

function purchaseRecords(snapshot, language) {
  const strings = stringsFor(language);
  const categories = catalogueCategoryMap(snapshot, strings.unknownCategory);
  return collectPurchaseHistory(snapshot)
    .filter((row) => row?.purchase && Number.isFinite(Number(row.purchase.totalPrice)))
    .map((row) => {
      const parts = categoryParts(
        categories.get(String(row.itemKey || "")) || strings.unknownCategory,
        strings.unknownCategory,
        strings.unknownSubcategory,
      );
      return {
        date: String(row.date || ""),
        itemKey: String(row.itemKey || ""),
        itemName: String(row.itemName || ""),
        category: parts.category,
        subcategory: parts.subcategory,
        store: String(row.purchase.store || "").trim() || strings.unknownStore,
        totalPrice: Math.max(0, Number(row.purchase.totalPrice)),
      };
    });
}

export function buildSpendingAnalysis(snapshot, referenceDate = new Date(), language, selectedMonths = {}) {
  const strings = stringsFor(language);
  const records = purchaseRecords(snapshot, language);
  const today = parseDateKey(dateKey(referenceDate));
  const weekStart = mondayStart(today);
  const nextWeek = addUtcDays(weekStart, 7);
  const currentMonth = monthStart(today);
  const nextMonth = addUtcMonths(currentMonth, 1);
  const dated = records.map((row) => ({ ...row, parsedDate: parseDateKey(row.date) }))
    .filter((row) => row.parsedDate);
  const inRange = (row, start, end) => row.parsedDate >= start && row.parsedDate < end;
  const currentWeekRows = dated.filter((row) => inRange(row, weekStart, nextWeek)), currentMonthRows = dated.filter((row) => inRange(row, currentMonth, nextMonth));
  const currentMonthKey = isoDate(currentMonth).slice(0, 7);
  const availableMonths = [...new Set(dated.map((row) => row.date.slice(0, 7)))]
    .filter((key) => /^\d{4}-\d{2}$/.test(key))
    .sort((left, right) => right.localeCompare(left));
  if (!availableMonths.includes(currentMonthKey)) availableMonths.unshift(currentMonthKey);
  const selectedMonth = (requested) => requested === "all" || availableMonths.includes(requested) ? requested : currentMonthKey;
  const categoryMonth = selectedMonth(selectedMonths.category), storeMonth = selectedMonth(selectedMonths.store);
  const rowsForMonth = (key) => {
    if (key === "all") return dated;
    const start = parseDateKey(`${key}-01`);
    return dated.filter((row) => inRange(row, start, addUtcMonths(start, 1)));
  };

  const weekly = [];
  for (let offset = -7; offset <= 0; offset += 1) {
    const start = addUtcDays(weekStart, offset * 7);
    const end = addUtcDays(start, 7);
    weekly.push({ start: isoDate(start), spend: sum(dated.filter((row) => inRange(row, start, end))) });
  }

  const monthly = [];
  for (let offset = -5; offset <= 0; offset += 1) {
    const start = addUtcMonths(currentMonth, offset);
    const end = addUtcMonths(start, 1);
    monthly.push({ start: isoDate(start), spend: sum(dated.filter((row) => inRange(row, start, end))) });
  }

  const categoryBreakdown = aggregateCategoryBreakdown(rowsForMonth(categoryMonth));
  return {
    currentWeek: sum(currentWeekRows),
    currentMonth: sum(currentMonthRows),
    totalRecorded: sum(records),
    purchaseCount: records.length,
    weekly,
    monthly,
    availableMonths,
    categoryMonth,
    storeMonth,
    byCategory: categoryBreakdown.byCategory,
    bySubcategory: categoryBreakdown.bySubcategory,
    byStore: aggregate(rowsForMonth(storeMonth), (row) => row.store),
    frequentProducts: aggregate(records, (row) => row.itemName).sort((left, right) => (
      right.count - left.count || right.spend - left.spend || left.key.localeCompare(right.key)
    )),
    strings,
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatMoney(value, language) {
  return new Intl.NumberFormat(language || undefined, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatWeek(start, language) {
  const date = parseDateKey(start);
  return new Intl.DateTimeFormat(language || undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatMonth(start, language) {
  const date = parseDateKey(start);
  return new Intl.DateTimeFormat(language || undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function monthSelect(kind, selected, months, language, strings) {
  return `<label class="spending-month-control">
    <span class="sr-only">${escapeHtml(strings.selectMonth)}</span>
    <select data-spending-month="${kind}" aria-label="${escapeHtml(strings.selectMonth)}">
      <option value="all" ${selected === "all" ? "selected" : ""}>${escapeHtml(strings.entirePeriod)}</option>
      ${months.map((month) => `<option value="${month}" ${month === selected ? "selected" : ""}>${escapeHtml(formatMonth(`${month}-01`, language))}</option>`).join("")}
    </select>
  </label>`;
}

function barRows(rows, language, labelFor) {
  const maximum = Math.max(0, ...rows.map((row) => row.spend));
  return rows.map((row) => {
    const width = maximum > 0 ? row.spend / maximum * 100 : 0;
    return `<div class="spending-bar-row">
      <span>${escapeHtml(labelFor(row.start, language))}</span>
      <div class="spending-bar-track"><i style="width:${width.toFixed(2)}%"></i></div>
      <strong>${escapeHtml(formatMoney(row.spend, language))}</strong>
    </div>`;
  }).join("");
}

function breakdownRows(rows, language, emptyLabel) {
  if (!rows.length) return `<p class="spending-empty">${escapeHtml(emptyLabel)}</p>`;
  const total = rows.reduce((value, row) => value + row.spend, 0);
  return rows.map((row) => {
    const width = total > 0 ? row.spend / total * 100 : 0;
    return `<div class="spending-breakdown-row">
      <div><strong>${escapeHtml(row.key)}</strong><span>${row.count}</span></div>
      <div class="spending-breakdown-track"><i style="width:${width.toFixed(2)}%"></i></div>
      <strong>${escapeHtml(formatMoney(row.spend, language))}</strong>
    </div>`;
  }).join("");
}

const DONUT_HUES = [14, 82, 205, 318, 43, 164, 262, 352, 124, 226];
const DONUT_VIEWBOX = { width: 520, height: 440, cx: 260, cy: 220 };
const DONUT_OUTER_RADIUS = 142;
const DONUT_INNER_RADIUS = 88;

function donutSlices(rows, total) {
  let cursor = 0;
  return rows.filter((row) => row.spend > 0).map((row) => {
    const size = total > 0 ? row.spend / total * 100 : 0;
    const slice = {
      ...row,
      start: cursor,
      size,
      midpoint: cursor + size / 2,
    };
    cursor += size;
    return slice;
  });
}

function donutPoint(percent, radius) {
  const angle = percent / 100 * Math.PI * 2 - Math.PI / 2;
  return { x: DONUT_VIEWBOX.cx + Math.cos(angle) * radius, y: DONUT_VIEWBOX.cy + Math.sin(angle) * radius, side: Math.cos(angle) >= 0 ? 1 : -1 };
}

function donutSeparators(slices, radius, strokeWidth) {
  return slices.map((row) => {
    const inner = donutPoint(row.start, radius - strokeWidth / 2 - 1), outer = donutPoint(row.start, radius + strokeWidth / 2 + 1);
    return `<line class="spending-donut-separator" x1="${inner.x.toFixed(1)}" y1="${inner.y.toFixed(1)}" x2="${outer.x.toFixed(1)}" y2="${outer.y.toFixed(1)}"></line>`;
  }).join("");
}

function spreadDonutLabels(rows) {
  const minimumY = 34;
  const maximumY = DONUT_VIEWBOX.height - 34;
  const gap = 16;
  const sorted = [...rows].sort((left, right) => left.y - right.y);
  for (let index = 1; index < sorted.length; index += 1) {
    sorted[index].y = Math.max(sorted[index].y, sorted[index - 1].y + gap);
  }
  if (sorted.length && sorted.at(-1).y > maximumY) {
    const overflow = sorted.at(-1).y - maximumY;
    sorted.forEach((row) => { row.y -= overflow; });
  }
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    sorted[index].y = Math.min(sorted[index].y, sorted[index + 1].y - gap);
  }
  if (sorted.length && sorted[0].y < minimumY) {
    const underflow = minimumY - sorted[0].y;
    sorted.forEach((row) => { row.y += underflow; });
  }
  return sorted;
}

function donutLabels(subcategorySlices, selectedCategory) {
  if (!selectedCategory) return "";
  const selected = subcategorySlices.filter((row) => row.category === selectedCategory).map((row) => {
    const edge = donutPoint(row.midpoint, DONUT_OUTER_RADIUS + 24);
    const elbow = donutPoint(row.midpoint, DONUT_OUTER_RADIUS + 39);
    return { ...row, edge, elbow, side: edge.side, y: elbow.y };
  });
  if (!selected.length) return "";

  const laidOut = [
    ...spreadDonutLabels(selected.filter((row) => row.side < 0)),
    ...spreadDonutLabels(selected.filter((row) => row.side > 0)),
  ];
  return `<g class="spending-donut-labels">${laidOut.map((row) => {
    const lineEndX = row.side > 0 ? 420 : 100;
    const textX = row.side > 0 ? 426 : 94;
    const anchor = row.side > 0 ? "start" : "end";
    return `<polyline points="${row.edge.x.toFixed(1)},${row.edge.y.toFixed(1)} ${row.elbow.x.toFixed(1)},${row.elbow.y.toFixed(1)} ${lineEndX},${row.y.toFixed(1)}"></polyline>
      <text x="${textX}" y="${(row.y + 3).toFixed(1)}" text-anchor="${anchor}">${escapeHtml(row.key)}</text>`;
  }).join("")}</g>`;
}

function donutSegment(row, radius, strokeWidth, kind, language, selectedCategory) {
  const nested = kind === "subcategory";
  const categoryKey = nested ? row.category : row.key;
  const label = nested ? `${row.category} › ${row.key}` : row.key;
  const tooltip = `${label} — ${formatMoney(row.spend, language)}`;
  const selected = selectedCategory === categoryKey;
  return `<circle
    class="spending-donut-segment spending-donut-${kind}-segment${selected && !nested ? " is-selected" : ""}"
    cx="${DONUT_VIEWBOX.cx}" cy="${DONUT_VIEWBOX.cy}" r="${radius}"
    fill="none" stroke="${row.color}" stroke-width="${strokeWidth}" stroke-linecap="butt"
    pathLength="100" stroke-dasharray="${row.size.toFixed(3)} ${(100 - row.size).toFixed(3)}"
    stroke-dashoffset="${(-row.start).toFixed(3)}"
    transform="rotate(-90 ${DONUT_VIEWBOX.cx} ${DONUT_VIEWBOX.cy})"
    tabindex="0" role="button" aria-label="${escapeHtml(tooltip)}" aria-pressed="${selected ? "true" : "false"}"
    data-donut-category="${escapeHtml(categoryKey)}" data-donut-tooltip="${escapeHtml(tooltip)}"></circle>`;
}

function categoryDonut(categories, subcategories, language, strings, selectedCategory = "") {
  const total = categories.reduce((value, row) => value + row.spend, 0);
  if (!categories.length || total <= 0) {
    return `<p class="spending-empty">${escapeHtml(strings.noPeriodPurchases)}</p>`;
  }
  const colorByCategory = new Map();
  const categoriesWithColors = categories.map((row, index) => {
    const hue = DONUT_HUES[index % DONUT_HUES.length];
    const color = `hsl(${hue} 46% 48%)`;
    colorByCategory.set(row.key, { hue, color });
    return { ...row, color };
  });
  const subcategoryIndex = new Map();
  const subcategoriesWithColors = subcategories.map((row) => {
    const parent = colorByCategory.get(row.category) || { hue: 0 };
    const index = subcategoryIndex.get(row.category) || 0;
    subcategoryIndex.set(row.category, index + 1);
    const lightness = 36 + (index % 5) * 9;
    return { ...row, color: `hsl(${parent.hue} 48% ${lightness}%)` };
  });
  const categorySlices = donutSlices(categoriesWithColors, total);
  const subcategorySlices = donutSlices(subcategoriesWithColors, total);
  const percent = (value) => new Intl.NumberFormat(language || undefined, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value / total);
  const legend = (rows, nested = false) => rows.map((row) => {
    const content = `<i class="spending-donut-swatch" style="--donut-color:${row.color}"></i>
      <span title="${escapeHtml(nested ? `${row.category} › ${row.key}` : row.key)}">${escapeHtml(row.key)}</span>
      <small>${escapeHtml(percent(row.spend))}</small>
      <strong>${escapeHtml(formatMoney(row.spend, language))}</strong>`;
    if (nested) {
      const selected = selectedCategory === row.category; return `<button type="button" class="spending-donut-legend-row is-subcategory${selected ? " is-selected" : ""}" data-donut-category="${escapeHtml(row.category)}" aria-pressed="${selected ? "true" : "false"}">${content}</button>`;
    }
    const selected = selectedCategory === row.key;
    return `<button type="button" class="spending-donut-legend-row is-category${selected ? " is-selected" : ""}" data-donut-category="${escapeHtml(row.key)}" aria-pressed="${selected ? "true" : "false"}">${content}</button>`;
  }).join("");
  return `<div class="spending-donut-layout">
    <div class="spending-double-donut" data-donut-chart>
      <svg class="spending-donut-svg" viewBox="0 0 ${DONUT_VIEWBOX.width} ${DONUT_VIEWBOX.height}" role="group" aria-label="${escapeHtml(`${strings.categoryRing} / ${strings.subcategoryRing}`)}">
        <circle class="spending-donut-track" cx="${DONUT_VIEWBOX.cx}" cy="${DONUT_VIEWBOX.cy}" r="${DONUT_OUTER_RADIUS}" fill="none" stroke-width="44"></circle>
        ${subcategorySlices.map((row) => donutSegment(row, DONUT_OUTER_RADIUS, 44, "subcategory", language, selectedCategory)).join("")}
        ${donutSeparators(subcategorySlices, DONUT_OUTER_RADIUS, 44)}
        <circle class="spending-donut-track" cx="${DONUT_VIEWBOX.cx}" cy="${DONUT_VIEWBOX.cy}" r="${DONUT_INNER_RADIUS}" fill="none" stroke-width="42"></circle>
        ${categorySlices.map((row) => donutSegment(row, DONUT_INNER_RADIUS, 42, "category", language, selectedCategory)).join("")}
        ${donutSeparators(categorySlices, DONUT_INNER_RADIUS, 48)}
        ${donutLabels(subcategorySlices, selectedCategory)}
      </svg>
      <div class="spending-donut-hole"><span>${escapeHtml(strings.total)}</span><strong>${escapeHtml(formatMoney(total, language))}</strong></div>
      <div class="spending-donut-tooltip" data-donut-tooltip-box role="status"></div>
    </div>
    <div class="spending-donut-legend">
      <section><h3>${escapeHtml(strings.categoryRing)}</h3><div class="spending-donut-legend-grid">${legend(categoriesWithColors)}</div></section>
      <section><h3>${escapeHtml(strings.subcategoryRing)}</h3><div class="spending-donut-legend-grid">${legend(subcategoriesWithColors, true)}</div></section>
    </div>
  </div>`;
}

function frequentRows(rows, language, strings) {
  if (!rows.length) return `<p class="spending-empty">${escapeHtml(strings.noPurchases)}</p>`;
  return `<div class="spending-products-head" aria-hidden="true">
    <span>${escapeHtml(strings.product)}</span><span>${escapeHtml(strings.purchases)}</span><span>${escapeHtml(strings.spend)}</span>
  </div>${rows.slice(0, 10).map((row) => `<div class="spending-product-row">
    <strong>${escapeHtml(row.key)}</strong>
    <span>${row.count}</span>
    <span>${escapeHtml(formatMoney(row.spend, language))}</span>
  </div>`).join("")}`;
}

function renderPanel(panel, state, selectedMonths = {}, selectedCategory = "") {
  const language = state?.language || document.documentElement.lang || "en";
  const analysis = buildSpendingAnalysis(state?.snapshot, new Date(), language, selectedMonths);
  const strings = analysis.strings;
  const tabLabel = document.querySelector("#grocery-spending-tab-label");
  if (tabLabel) tabLabel.textContent = strings.tab;
  panel.innerHTML = `<div class="page-heading spending-heading">
    <div>
      <p class="eyebrow">${escapeHtml(strings.eyebrow)}</p>
      <h1>${escapeHtml(strings.title)}</h1>
      <p class="spending-intro">${escapeHtml(strings.intro)}</p>
    </div>
  </div>
  <div class="spending-summary-grid">
    <article class="spending-stat"><span>${escapeHtml(strings.thisWeek)}</span><strong>${escapeHtml(formatMoney(analysis.currentWeek, language))}</strong></article>
    <article class="spending-stat"><span>${escapeHtml(strings.thisMonth)}</span><strong>${escapeHtml(formatMoney(analysis.currentMonth, language))}</strong></article>
    <article class="spending-stat"><span>${escapeHtml(strings.recordedSpend)}</span><strong>${escapeHtml(formatMoney(analysis.totalRecorded, language))}</strong></article>
    <article class="spending-stat"><span>${escapeHtml(strings.purchaseLines)}</span><strong>${analysis.purchaseCount}</strong></article>
  </div>
  <div class="spending-analysis-grid spending-trend-grid">
    <section class="panel spending-card">
      <header><div><h2>${escapeHtml(strings.weekly)}</h2><p>${escapeHtml(strings.weeklyIntro)}</p></div></header>
      <div class="spending-bars">${barRows(analysis.weekly, language, formatWeek)}</div>
    </section>
    <section class="panel spending-card">
      <header><div><h2>${escapeHtml(strings.monthly)}</h2><p>${escapeHtml(strings.monthlyIntro)}</p></div></header>
      <div class="spending-bars">${barRows(analysis.monthly, language, formatMonth)}</div>
    </section>
  </div>
  <div class="spending-analysis-grid">
    <section class="panel spending-card">
      <header><div><h2>${escapeHtml(strings.categories)}</h2><p>${escapeHtml(strings.categoriesIntro)}</p></div>${monthSelect("category", analysis.categoryMonth, analysis.availableMonths, language, strings)}</header>
      <div class="spending-category-donut">${categoryDonut(analysis.byCategory, analysis.bySubcategory, language, strings, selectedCategory)}</div>
    </section>
    <section class="panel spending-card">
      <header><div><h2>${escapeHtml(strings.stores)}</h2><p>${escapeHtml(strings.storesIntro)}</p></div>${monthSelect("store", analysis.storeMonth, analysis.availableMonths, language, strings)}</header>
      <div class="spending-breakdown">${breakdownRows(analysis.byStore, language, strings.noPeriodPurchases)}</div>
    </section>
  </div>
  <section class="panel spending-card spending-products-card">
    <header><div><h2>${escapeHtml(strings.frequent)}</h2><p>${escapeHtml(strings.frequentIntro)}</p></div></header>
    <div class="spending-products">${frequentRows(analysis.frequentProducts, language, strings)}</div>
  </section>`;
}

function createUi() {
  const switcher = document.querySelector(".grocery-mode-switch");
  const groceryView = document.querySelector("#grocery-view");
  if (!switcher || !groceryView) return null;

  let button = document.querySelector("#grocery-spending-tab");
  if (!button) {
    button = document.createElement("button");
    button.id = "grocery-spending-tab";
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.innerHTML = '<span id="grocery-spending-tab-label">Spending</span>';
    switcher.append(button);
  }

  let panel = document.querySelector("#grocery-spending-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "grocery-spending-panel";
    panel.className = "grocery-subview spending-analysis-subview";
    panel.hidden = true;
    groceryView.append(panel);
  }
  return { button, panel };
}

export function mountGrocerySpendingAnalysis() {
  const ui = createUi();
  if (!ui) return;
  const { button, panel } = ui;
  let active = false;
  const selectedMonths = { category: "", store: "" };
  let selectedCategory = "";

  const deactivate = () => {
    active = false;
    button.classList.remove("active");
    button.setAttribute("aria-selected", "false");
    panel.classList.remove("active");
    panel.hidden = true;
  };

  const enforce = () => {
    if (!active) return;
    document.querySelectorAll("[data-grocery-mode]").forEach((tab) => {
      tab.classList.remove("active");
      tab.setAttribute("aria-selected", "false");
    });
    document.querySelectorAll("[data-grocery-panel]").forEach((candidate) => {
      candidate.classList.remove("active");
      if (!candidate.hidden) candidate.hidden = true;
    });
    button.classList.add("active");
    button.setAttribute("aria-selected", "true");
    panel.hidden = false;
    panel.classList.add("active");
  };

  const activate = (event) => {
    event?.preventDefault();
    event?.stopPropagation();
    active = true;
    renderPanel(panel, globalThis.homealacarteState, selectedMonths, selectedCategory);
    enforce();
  };

  const rerender = () => {
    renderPanel(panel, globalThis.homealacarteState, selectedMonths, selectedCategory);
    enforce();
  };

  const donutTooltipFor = (target) => target?.closest?.("[data-donut-chart]")?.querySelector?.("[data-donut-tooltip-box]");

  const hideDonutTooltip = (target) => {
    const tooltip = donutTooltipFor(target);
    tooltip?.classList.remove("is-visible");
  };

  const showDonutTooltip = (target, event) => {
    const tooltip = donutTooltipFor(target);
    const chart = target?.closest?.("[data-donut-chart]");
    if (!tooltip || !chart) return;
    tooltip.textContent = target.dataset.donutTooltip || "";
    tooltip.classList.add("is-visible");
    if (event?.clientX == null || event?.clientY == null) {
      tooltip.style.left = "50%";
      tooltip.style.top = "10px";
      return;
    }
    const bounds = chart.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - bounds.left, 72), bounds.width - 72);
    const y = Math.min(Math.max(event.clientY - bounds.top - 14, 20), bounds.height - 20);
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  };

  button.addEventListener("click", activate);
  panel.addEventListener("click", (event) => {
    const category = event.target.closest?.("[data-donut-category]");
    if (!category) return;
    const key = category.dataset.donutCategory || "";
    selectedCategory = key;
    rerender();
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const category = event.target.closest?.("[data-donut-category]");
    if (!category) return;
    event.preventDefault();
    category.click();
  });
  panel.addEventListener("pointerover", (event) => {
    const target = event.target.closest?.("[data-donut-tooltip]");
    if (target) showDonutTooltip(target, event);
  });
  panel.addEventListener("pointermove", (event) => {
    const target = event.target.closest?.("[data-donut-tooltip]");
    if (target) showDonutTooltip(target, event);
  });
  panel.addEventListener("pointerout", (event) => {
    const target = event.target.closest?.("[data-donut-tooltip]");
    if (target && !target.contains(event.relatedTarget)) hideDonutTooltip(target);
  });
  panel.addEventListener("focusin", (event) => {
    const target = event.target.closest?.("[data-donut-tooltip]");
    if (target) showDonutTooltip(target);
  });
  panel.addEventListener("focusout", (event) => {
    const target = event.target.closest?.("[data-donut-tooltip]");
    if (target) hideDonutTooltip(target);
  });
  panel.addEventListener("change", (event) => {
    const select = event.target.closest?.("[data-spending-month]");
    if (!select) return;
    selectedMonths[select.dataset.spendingMonth] = select.value;
    if (select.dataset.spendingMonth === "category") selectedCategory = "";
    rerender();
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-grocery-mode], [data-tab]")) deactivate();
  });

  const purchaseList = document.querySelector("#purchase-list");
  if (purchaseList && typeof MutationObserver !== "undefined") {
    new MutationObserver(() => {
      if (!active) return;
      renderPanel(panel, globalThis.homealacarteState, selectedMonths, selectedCategory);
      enforce();
    }).observe(purchaseList, { childList: true, subtree: true });
  }

  const languageSelect = document.querySelector("#language-select");
  languageSelect?.addEventListener("change", () => {
    if (!active) return;
    queueMicrotask(() => {
      renderPanel(panel, globalThis.homealacarteState, selectedMonths, selectedCategory);
      enforce();
    });
  });
}

if (typeof document !== "undefined") {
  mountGrocerySpendingAnalysis();
}
