use homealacarte_web::{
    AppConfig, CustomGroceryItem, Engine, exclude_grocery_items, generate_grocery_pdf,
};
use std::collections::HashSet;

use crate::support::synthetic_dataset;

#[test]
fn groceries_ignore_menu_requirements_before_the_current_date() {
    let mut source = synthetic_dataset();
    source.content = source
        .content
        .replacen(
            r#""date": "2026-08-31",
              "day": "monday",
              "meal": "lunch""#,
            r#""date": "2026-08-28",
              "day": "friday",
              "meal": "lunch""#,
            1,
        )
        .replacen(
            r#""date": "2026-08-31",
              "day": "monday",
              "meal": "breakfast""#,
            r#""date": "2026-08-29",
              "day": "saturday",
              "meal": "breakfast""#,
            1,
        )
        .replacen(
            r#"{"item_key": "bread_test", "quantity": 50, "quantity_unit": "g"}"#,
            r#"{"item_key": "bread_test", "quantity": 0, "quantity_unit": "g"}"#,
            1,
        );
    let mut engine = Engine::default();
    engine.set_current_date("2026-08-29".to_string()).unwrap();
    let snapshot = engine
        .load(
            vec![source],
            AppConfig {
                language: "en".to_string(),
            },
        )
        .unwrap();

    assert!(snapshot.grocery.items.iter().any(|item| item.name == "Test bread"));
    assert!(!snapshot.grocery.items.iter().any(|item| item.name == "Test tomato"));
    assert_eq!(snapshot.planner.len(), 2);
}

#[test]
fn purchased_dishes_keep_nutrition_but_skip_their_components_in_groceries() {
    let mut source = synthetic_dataset();
    source.content = source.content.replacen(
        r#""name": "Synthetic salad","#,
        r#""name": "Synthetic salad", "grocery_exempt": true,"#,
        1,
    );
    let mut engine = Engine::default();
    let snapshot = engine
        .load(
            vec![source],
            AppConfig {
                language: "en".to_string(),
            },
        )
        .unwrap();

    let dish = snapshot.dishes.iter().find(|dish| dish.key == "test_salad").unwrap();
    assert!(dish.grocery_exempt);
    assert!(dish.per_serving.kcal > 0.0);
    assert!(!snapshot.grocery.items.iter().any(|item| item.name == "Test tomato"));
}

#[test]
fn cooked_recipe_items_use_their_raw_purchase_reference_and_conversion() {
    let mut source = synthetic_dataset();
    source.content = source
        .content
        .replacen(
            r#""key": "tomato_test","#,
            r#""key": "tomato_test",
              "purchase_item_key": "raw_tomato_test",
              "purchase_grams_per_gram": 0.3333333333333333,"#,
            1,
        )
        .replacen(
            r#"{
              "key": "cleaner_test","#,
            r#"{
              "key": "raw_tomato_test",
              "name": "Raw purchase test",
              "grams": 100,
              "kcal": 54,
              "protein_g": 2.7,
              "carbs_g": 11.7,
              "fat_g": 0.6,
              "fiber_g": 3.6,
              "category": "Produce::Vegetables",
              "source": "Synthetic test fixture",
              "url": "",
              "price": 6,
              "price_basis": "kg",
              "measure_unit": "g",
              "grams_per_measure_unit": 1,
              "purchase_unit": "100 g pack",
              "purchase_quantity": 100,
              "purchase_quantity_unit": "g"
            },
            {
              "key": "cleaner_test","#,
            1,
        )
        .replacen(
            r#"{"item_key": "tomato_test", "quantity": 50, "quantity_unit": "g"},"#,
            r#"{"item_key": "tomato_test", "quantity": 50, "quantity_unit": "g"},
            {"item_key": "raw_tomato_test", "quantity": 20, "quantity_unit": "g"},"#,
            1,
        );
    let mut engine = Engine::default();
    let snapshot = engine
        .load(
            vec![source],
            AppConfig {
                language: "en".to_string(),
            },
        )
        .unwrap();

    assert!(!snapshot.grocery.items.iter().any(|item| item.name == "Test tomato"));
    let purchase = snapshot
        .grocery
        .items
        .iter()
        .find(|item| item.name == "Raw purchase test")
        .unwrap();
    assert!((purchase.needed_quantity - 13.3333333333).abs() < 0.001);
    let planned = snapshot
        .grocery_plan
        .items
        .iter()
        .find(|item| item.name == "Raw purchase test")
        .unwrap();
    assert!((planned.needed_quantity - 50.0).abs() < 0.001);

    let purchase_id = planned.id.clone();
    let stocked = engine.set_grocery_stock(vec![purchase_id.clone()], true).unwrap();
    assert!(!stocked.grocery.items.iter().any(|item| item.id == purchase_id));
    assert!(stocked
        .grocery_plan
        .items
        .iter()
        .find(|item| item.id == purchase_id)
        .unwrap()
        .stock_sufficient);

    let unstocked = engine.set_grocery_stock(vec![purchase_id.clone()], false).unwrap();
    assert!(unstocked.grocery.items.iter().any(|item| item.id == purchase_id));
}

#[test]
fn synthetic_data_supports_groceries_stock_export_and_pdf() {
    let mut engine = Engine::default();
    let snapshot = engine
        .load(
            vec![synthetic_dataset()],
            AppConfig {
                language: "fr".to_string(),
            },
        )
        .unwrap();

    assert_eq!(snapshot.counts.ingredients, 2);
    assert_eq!(snapshot.counts.dishes, 1);
    assert_eq!(snapshot.counts.people, 1);
    assert_eq!(snapshot.people[0].kind, "child");
    assert_eq!(snapshot.counts.menu, 2);
    assert_eq!(snapshot.stock.len(), snapshot.counts.stock);
    assert_eq!(snapshot.grocery.items.len(), 2);
    assert!((snapshot.grocery.estimated_purchase_total - 4.0).abs() < 0.005);
    let dish = &snapshot.dishes[0];
    assert_eq!(dish.recipe_url, "https://example.com/synthetic-recipe");
    assert_eq!(dish.source, "Synthetic cookbook");
    assert_eq!(dish.source_notes, ["Synthetic preparation note."]);
    assert_eq!(dish.components[0].source_quantity, "300 g test tomato");
    assert!(snapshot.grocery_plan.items.len() > snapshot.grocery.items.len());
    assert!(
        snapshot
            .grocery_plan
            .items
            .iter()
            .any(|item| item.stock_sufficient)
    );
    let partial_food = snapshot
        .grocery_plan
        .items
        .iter()
        .find(|item| item.name == "Test tomato")
        .unwrap();
    assert!(!partial_food.stock_sufficient);
    assert!((partial_food.stock_quantity - 50.0).abs() < 0.005);
    assert_eq!(partial_food.stock_quantity_text, "0.3 pieces");
    let partial_household = snapshot
        .grocery_plan
        .items
        .iter()
        .find(|item| item.name == "Test cleaner")
        .unwrap();
    assert!(!partial_household.stock_sufficient);
    assert!((partial_household.stock_quantity - 1.0).abs() < 0.005);
    assert_eq!(partial_household.stock_quantity_text, "1 bottles");
    assert!(
        (snapshot.grocery_plan.estimated_purchase_total
            - snapshot.grocery.estimated_purchase_total)
            .abs()
            < 0.005
    );
    assert!(
        snapshot.grocery_plan.estimated_full_purchase_total
            > snapshot.grocery_plan.estimated_purchase_total
    );

    assert_eq!(snapshot.custom_grocery.len(), 2);
    assert_eq!(snapshot.household_options.len(), 4);
    assert_eq!(snapshot.stock_options.len(), 4);
    assert!(
        snapshot
            .stock_options
            .iter()
            .any(|item| {
                item.name == "Test cleaner"
                    && item.category == "Household"
                    && item.household
            })
    );
    assert!(snapshot.stock.iter().any(|item| {
        item.name == "Test tomato" && item.category == "Fruits et légumes::Légumes"
    }));
    let consolidated: serde_json::Value =
        serde_json::from_str(&engine.export_data("consolidated").unwrap()).unwrap();
    assert!(consolidated.get("items").is_some());
    assert!(consolidated.get("stock").is_some());
    assert!(consolidated.get("extra_needs").is_some());
    assert_eq!(consolidated.as_object().unwrap().len(), 6);
    let folder = engine.export_folder().unwrap();
    assert_eq!(folder.len(), 6);
    assert!(folder.iter().any(|file| file.path == "items.json"));
    assert!(folder.iter().any(|file| file.path == "extra_needs.json"));
    let mut roundtrip = Engine::default();
    let roundtrip_snapshot = roundtrip
        .load(
            folder,
            AppConfig {
                language: "fr".to_string(),
            },
        )
        .unwrap();
    assert_eq!(roundtrip_snapshot.grocery.items.len(), snapshot.grocery.items.len());
    assert!(
        (roundtrip_snapshot.grocery.estimated_purchase_total
            - snapshot.grocery.estimated_purchase_total)
            .abs()
            < 0.005
    );

    let food_target = roundtrip_snapshot
        .grocery_plan
        .items
        .iter()
        .find(|item| !item.household && !item.stock_sufficient)
        .unwrap()
        .clone();
    let household_target = roundtrip_snapshot
        .grocery_plan
        .items
        .iter()
        .find(|item| item.household && !item.stock_sufficient)
        .unwrap()
        .clone();
    let stocked = roundtrip
        .set_grocery_stock(
            vec![food_target.id.clone(), household_target.id.clone()],
            true,
        )
        .unwrap();
    assert!(
        stocked
            .grocery_plan
            .items
            .iter()
            .filter(|item| item.id == food_target.id || item.id == household_target.id)
            .all(|item| item.stock_sufficient)
    );
    assert!(stocked.stock.iter().any(|item| item.household));
    assert!(
        stocked.grocery.estimated_purchase_total
            < roundtrip_snapshot.grocery.estimated_purchase_total
    );
    let unstocked = roundtrip
        .set_grocery_stock(vec![food_target.id, household_target.id], false)
        .unwrap();
    assert!(
        unstocked
            .grocery_plan
            .items
            .iter()
            .filter(|item| item.name == food_target.name || item.name == household_target.name)
            .all(|item| !item.stock_sufficient)
    );

    let custom = roundtrip
        .replace_custom_grocery(vec![CustomGroceryItem {
            key: "custom_test".to_string(),
            name: "Article test".to_string(),
            category: "Autres".to_string(),
            quantity: 2.0,
            measure_unit: "unités".to_string(),
            purchase_unit: "unité".to_string(),
            purchase_quantity: 1.0,
            estimated_price: 1.25,
            notes: Some("Prendre la version recyclée".to_string()),
            custom: true,
        }])
        .unwrap();
    assert_eq!(custom.custom_grocery.len(), 1);
    assert_eq!(
        custom.custom_grocery[0].notes.as_deref(),
        Some("Prendre la version recyclée")
    );
    assert!(custom.grocery.items.iter().any(|item| item.name == "Article test"));

    let without_stock = roundtrip.replace_stock(Vec::new()).unwrap();
    assert!(without_stock.stock.is_empty());
    assert!(without_stock.grocery.items.len() > custom.grocery.items.len());
    assert!(
        without_stock.grocery.estimated_purchase_total
            > custom.grocery.estimated_purchase_total
    );

    let pdf = generate_grocery_pdf(&snapshot.grocery, "fr");
    assert!(pdf.starts_with(b"%PDF-1.7"));
    assert!(pdf.ends_with(b"%%EOF\n"));
    assert!(pdf.len() > 1_000);
    let text = String::from_utf8_lossy(&pdf);
    assert!(text.contains("/MediaBox [0 0 595.28 841.89]"));
    assert!(text.contains("/Count 1"));
    assert!(text.contains("Fruits et l"));
    assert!(!text.contains("Produce"));

    let excluded_item = snapshot.grocery.items.first().unwrap();
    let excluded_price = excluded_item.estimated_purchase_price;
    let filtered = exclude_grocery_items(
        snapshot.grocery.clone(),
        &HashSet::from([excluded_item.id.clone()]),
    );
    assert_eq!(filtered.items.len(), snapshot.grocery.items.len() - 1);
    assert!(
        (filtered.estimated_purchase_total
            - (snapshot.grocery.estimated_purchase_total - excluded_price))
            .abs()
            < 0.005
    );
    assert!(filtered.categories.iter().all(|category| {
        category.subcategories.iter().all(|subcategory| {
            subcategory
                .items
                .iter()
                .all(|item| item.id != excluded_item.id)
        })
    }));
    let filtered_pdf = generate_grocery_pdf(&filtered, "fr");
    let filtered_text = String::from_utf8_lossy(&filtered_pdf);
    let filtered_total =
        format!("{:.2} EUR", filtered.estimated_purchase_total).replace('.', ",");
    assert!(filtered_text.contains(&filtered_total));
}
