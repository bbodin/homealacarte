use crate::engine::Engine;
use crate::grocery::{food_identity, ingredient_requirements_from};
use crate::model::*;
use crate::price_history::preserve_price_history;
use std::collections::{BTreeMap, HashMap, HashSet};

const EPSILON: f64 = 1e-6;

fn preserve_or_replace_note(
    notes: &mut BTreeMap<String, String>,
    previous: &BTreeMap<String, String>,
    key: &str,
    edited: Option<&str>,
) {
    match edited {
        Some(value) if !value.trim().is_empty() => {
            notes.insert(key.to_string(), value.trim().to_string());
        }
        Some(_) => {
            notes.remove(key);
        }
        None => {
            if let Some(value) = previous.get(key) {
                notes.insert(key.to_string(), value.clone());
            }
        }
    }
}

fn preserve_or_set_added_at(
    added: &mut BTreeMap<String, String>,
    previous: &BTreeMap<String, String>,
    key: &str,
    edited: Option<&str>,
) {
    if let Some(value) = edited.map(str::trim).filter(|value| !value.is_empty()) {
        added.insert(key.to_string(), value.to_string());
    } else if let Some(value) = previous.get(key) {
        added.insert(key.to_string(), value.clone());
    }
}

impl Engine {
    pub fn replace_stock(&mut self, inputs: Vec<StockUpdate>) -> Result<AppSnapshot, String> {
        let dataset = self.dataset.as_mut().ok_or("no dataset loaded")?;
        let ingredients: HashMap<String, (f64, String)> = dataset
            .ingredients
            .iter()
            .map(|item| {
                (
                    item.key.clone(),
                    (item.grams_per_measure_unit, item.measure_unit.clone()),
                )
            })
            .collect();
        let household_items = dataset
            .household_items
            .iter()
            .map(|item| item.key.clone())
            .collect::<HashSet<_>>();
        let mut stock = BTreeMap::new();
        let mut stock_units = BTreeMap::new();
        let mut household_stock = BTreeMap::new();
        let previous_notes = dataset.stock_notes.clone();
        let previous_added_at = dataset.stock_added_at.clone();
        let mut stock_notes = BTreeMap::new();
        let mut stock_added_at = BTreeMap::new();
        for (index, input) in inputs.into_iter().enumerate() {
            let key = input.item_key.trim();
            if input.household {
                if !household_items.contains(key) {
                    return Err(format!(
                        "household stock item {} references unknown item: {key}",
                        index + 1
                    ));
                }
                if !input.quantity.is_finite() || input.quantity < 0.0 {
                    return Err(format!(
                        "household stock item {} quantity must not be negative",
                        index + 1
                    ));
                }
                if input.quantity_unit.trim().to_lowercase() != "unit" {
                    return Err(format!(
                        "household stock item {} has invalid unit: {}",
                        index + 1,
                        input.quantity_unit
                    ));
                }
                if input.quantity > EPSILON {
                    *household_stock.entry(key.to_string()).or_insert(0.0) += input.quantity;
                    preserve_or_replace_note(
                        &mut stock_notes,
                        &previous_notes,
                        key,
                        input.notes.as_deref(),
                    );
                    preserve_or_set_added_at(
                        &mut stock_added_at,
                        &previous_added_at,
                        key,
                        input.added_at.as_deref(),
                    );
                }
                continue;
            }
            let (grams_per_unit, _) = ingredients
                .get(key)
                .ok_or_else(|| format!("stock item {} references unknown ingredient: {key}", index + 1))?;
            if !input.quantity.is_finite() || input.quantity < 0.0 {
                return Err(format!("stock item {} quantity must not be negative", index + 1));
            }
            let quantity_unit = input.quantity_unit.trim().to_lowercase();
            let grams = match quantity_unit.as_str() {
                "g" => input.quantity,
                "unit" => input.quantity * grams_per_unit,
                unit => return Err(format!("stock item {} has invalid unit: {unit}", index + 1)),
            };
            if grams > EPSILON {
                stock_units.insert(key.to_string(), quantity_unit);
                *stock.entry(key.to_string()).or_insert(0.0) += grams;
                preserve_or_replace_note(
                    &mut stock_notes,
                    &previous_notes,
                    key,
                    input.notes.as_deref(),
                );
                preserve_or_set_added_at(
                    &mut stock_added_at,
                    &previous_added_at,
                    key,
                    input.added_at.as_deref(),
                );
            }
        }
        dataset.stock = stock;
        dataset.stock_units = stock_units;
        dataset.stock_notes = stock_notes;
        dataset.stock_added_at = stock_added_at;
        dataset.household_stock = household_stock;
        self.snapshot()
    }

    pub fn set_grocery_stock(
        &mut self,
        item_ids: Vec<String>,
        stocked: bool,
    ) -> Result<AppSnapshot, String> {
        let current_date = self.current_date.clone();
        let dataset = self.dataset.as_mut().ok_or("no dataset loaded")?;
        let requirements = ingredient_requirements_from(dataset, &current_date);
        let ingredients = dataset
            .ingredients
            .iter()
            .map(|item| (item.key.clone(), item))
            .collect::<HashMap<_, _>>();

        for item_id in item_ids {
            if let Some(key) = item_id.strip_prefix("household-") {
                let needed = dataset
                    .household_needs
                    .get(key)
                    .copied()
                    .ok_or_else(|| format!("unknown grocery item: {item_id}"))?;
                if stocked {
                    let quantity = dataset.household_stock.entry(key.to_string()).or_default();
                    *quantity = quantity.max(needed);
                } else {
                    dataset.household_stock.remove(key);
                    dataset.stock_notes.remove(key);
                    dataset.stock_added_at.remove(key);
                }
                continue;
            }

            // Grocery rows identify the purchasable form, which can differ from the
            // ingredient in a recipe (for example cooked rice versus dry rice).
            let mut matching = HashMap::<String, f64>::new();
            let mut recipe_keys = Vec::new();
            for (key, needed) in &requirements {
                let Some(ingredient) = ingredients.get(key) else {
                    continue;
                };
                let purchase_key = if ingredient.purchase_item_key.is_empty() {
                    key.as_str()
                } else {
                    ingredient.purchase_item_key.as_str()
                };
                let Some(purchase_item) = ingredients.get(purchase_key) else {
                    continue;
                };
                if format!("food-{}", food_identity(purchase_item)) != item_id {
                    continue;
                }
                let factor = if ingredient.purchase_item_key.is_empty() {
                    1.0
                } else {
                    ingredient.purchase_grams_per_gram
                };
                *matching.entry(purchase_key.to_string()).or_default() += needed * factor;
                recipe_keys.push(key.clone());
            }
            if matching.is_empty() {
                return Err(format!("unknown grocery item: {item_id}"));
            }
            if !stocked {
                for key in recipe_keys {
                    dataset.stock.remove(&key);
                    dataset.stock_units.remove(&key);
                    dataset.stock_notes.remove(&key);
                    dataset.stock_added_at.remove(&key);
                }
            }
            for (key, needed) in matching {
                if stocked {
                    let quantity = dataset.stock.entry(key.clone()).or_default();
                    *quantity = quantity.max(needed);
                    dataset.stock_units.entry(key.clone()).or_insert_with(|| "g".to_string());
                } else {
                    dataset.stock.remove(&key);
                    dataset.stock_units.remove(&key);
                    dataset.stock_notes.remove(&key);
                    dataset.stock_added_at.remove(&key);
                }
            }
        }
        self.snapshot()
    }

    pub fn replace_custom_grocery(
        &mut self,
        inputs: Vec<CustomGroceryItem>,
    ) -> Result<AppSnapshot, String> {
        let dataset = self.dataset.as_mut().ok_or("no dataset loaded")?;
        let mut keys = HashSet::new();
        let mut needs = BTreeMap::new();
        let previous_notes = dataset.household_need_notes.clone();
        let mut need_notes = BTreeMap::new();
        let existing = dataset
            .household_items
            .iter()
            .enumerate()
            .map(|(index, item)| (item.key.clone(), index))
            .collect::<HashMap<_, _>>();
        let item_keys = dataset
            .ingredients
            .iter()
            .map(|item| item.key.as_str())
            .collect::<HashSet<_>>();

        for (index, input) in inputs.into_iter().enumerate() {
            let key = input.key.trim().to_string();
            if key.is_empty() || !keys.insert(key.clone()) {
                return Err(format!("additional grocery item {} has an empty or duplicate key", index + 1));
            }
            if input.name.trim().is_empty()
                || input.category.trim().is_empty()
                || input.measure_unit.trim().is_empty()
                || input.purchase_unit.trim().is_empty()
            {
                return Err(format!("additional grocery item {} has a missing label", index + 1));
            }
            if !input.quantity.is_finite()
                || input.quantity <= 0.0
                || !input.purchase_quantity.is_finite()
                || input.purchase_quantity <= 0.0
                || !input.estimated_price.is_finite()
                || input.estimated_price < 0.0
            {
                return Err(format!("additional grocery item {} has an invalid quantity or price", index + 1));
            }

            if item_keys.contains(key.as_str()) {
                preserve_or_replace_note(
                    &mut need_notes,
                    &previous_notes,
                    &key,
                    input.notes.as_deref(),
                );
                needs.insert(key, input.quantity);
                continue;
            }

            let previous = existing
                .get(&key)
                .and_then(|item_index| dataset.household_items.get(*item_index));
            let mut item = HouseholdItem {
                key: key.clone(),
                name: input.name.trim().to_string(),
                category: crate::locale::canonical_category(&input.category),
                purchase_unit: input.purchase_unit.trim().to_string(),
                purchase_quantity: input.purchase_quantity,
                estimated_price: input.estimated_price,
                price_history: previous
                    .map(|item| item.price_history.clone())
                    .unwrap_or_default(),
                measure_unit: input.measure_unit.trim().to_string(),
                last_bought_at: previous.map(|item| item.last_bought_at.clone()).unwrap_or_default(),
                lasting_days: previous.and_then(|item| item.lasting_days),
                notes: previous.map(|item| item.notes.clone()).unwrap_or_default(),
                custom: input.custom || previous.is_some_and(|item| item.custom),
            };
            preserve_price_history(
                &mut item.price_history,
                &[],
                &item.last_bought_at,
                item.estimated_price,
                "purchase_unit",
                &item.notes,
            );
            if let Some(item_index) = existing.get(&key) {
                dataset.household_items[*item_index] = item;
            } else {
                dataset.household_items.push(item);
            }
            preserve_or_replace_note(
                &mut need_notes,
                &previous_notes,
                &key,
                input.notes.as_deref(),
            );
            needs.insert(key, input.quantity);
        }
        dataset.household_needs = needs;
        dataset.household_need_notes = need_notes;
        self.snapshot()
    }
}
