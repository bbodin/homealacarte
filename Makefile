WASM_PACK ?= $(HOME)/.cargo/bin/wasm-pack
DATA_DIR ?= ./sample-data
PERSONAL_DATA_DIR ?= ./data
PERSONAL_IMPORT ?= ./private-import/homealacarte.json
PERSONAL_BASE_DIR ?= ./dataweb
PERSONAL_OVERLAY_DIR ?= ./perso-data
PERSONAL_MERGED_IMPORT ?= ./private-import/homealacarte-merged.json
PERSONAL_MERGE_AUDIT ?= ./private-import/homealacarte-merge-audit.json

.PHONY: build rust-build web-build personal-data merge-personal-data serve test test-domain test-web test-architecture test-browser-startup test-row-sync-browser test-reset-demo test-personal-data test-personal-import test-item-details test-item-usage-people test-grocery-item-click test-grocery-total test-dish-ingredient-details test-dish-nutriscore-filter test-dish-scheduling test-catalogue-filters test-add-to-needs-button test-catalogue-add test-price-history-labels release-check clean

build: rust-build web-build

rust-build:
	$(WASM_PACK) build --target web --out-dir pkg

web-build:
	DATA_DIR="$(DATA_DIR)" python3 scripts/build.py

personal-data:
	cargo run --quiet --bin personal-data -- "$(PERSONAL_DATA_DIR)" "$(PERSONAL_IMPORT)"

merge-personal-data:
	cargo run --quiet --bin personal-data -- merge "$(PERSONAL_BASE_DIR)" "$(PERSONAL_OVERLAY_DIR)" "$(PERSONAL_MERGED_IMPORT)" "$(PERSONAL_MERGE_AUDIT)"

serve:
	python3 -m http.server 8080 --directory dist

test:
	cargo test

test-domain:
	cargo test --test domain

test-web:
	python3 scripts/check_source_boundaries.py
	node --check www/app.js
	node --check www/app/feature-composition.js
	node --check www/storage.js
	node --check www/core/data-localization.js
	node --check www/core/ui-i18n.js
	node --check www/core/stock-availability.js
	node --check www/core/purchases.js
	node --check www/translations.js
	node --check www/worker.js
	node --check www/features/ai-dish.js
	node --check www/features/ai-dish/ollama.js
	node --check www/features/ai-list.js
	node --check www/features/ai-list/dialog.js
	node --check www/features/ai-list/strings.js
	node --check www/features/ai-list/ollama.js
	node --check www/features/ai-list/payload.js
	node --check www/features/grocery.js
	node --check www/features/receipt-purchases.js
	node --check www/features/ui-consistency.js
	node tests/menu_rows.mjs
	node tests/food_rules.mjs
	node tests/profile_rules.mjs
	node tests/format.mjs
	node tests/data_localization_ui.mjs
	node tests/ui_i18n.mjs
	node tests/locale_registry.mjs
	node tests/locale_independence.mjs
	node tests/downloads.mjs
	node tests/theme.mjs
	node tests/app_state.mjs
	node tests/bootstrap.mjs
	node tests/worker_client.mjs
	node tests/worker_responses.mjs
	node tests/local_store.mjs
	node tests/row_codec.mjs
	node tests/row_sync_schema.mjs
	node tests/row_sync_batching.mjs
	node tests/row_sync_conflicts.mjs
	node tests/remote_client.mjs
	node tests/stock_availability.mjs
	node tests/stock_feature.mjs
	node tests/extra_needs_feature.mjs
	node tests/grocery_total.mjs
	node tests/purchases_feature.mjs
	node tests/receipt_purchases.mjs
	node tests/ui_consistency.mjs
	node tests/dishes_feature.mjs
	node tests/dish_editor_feature.mjs
	node tests/ai_dish_ollama.mjs
	node tests/ai_dish_feature.mjs
	node tests/ai_list_ollama.mjs
	node tests/ai_list_feature.mjs
	node tests/auto_menu_feature.mjs
	node tests/menu_feature.mjs
	node tests/data_account_feature.mjs
	node tests/shell_feature.mjs
	node tests/style_layers.mjs
	node tests/html_partials.mjs

test-browser-startup: web-build
	bash tests/browser_startup.sh

test-row-sync-browser:
	bash tests/row_sync_browser.sh

test-reset-demo:
	node tests/reset_demo.mjs

test-personal-data:
	cargo test --test personal_data

test-personal-import:
	node tests/personal_import.mjs "$(PERSONAL_IMPORT)"

test-item-details:
	node tests/item_details.mjs
	node --check www/app.js

test-item-usage-people:
	node tests/item_usage_people.mjs
	node --check www/app.js

test-grocery-item-click:
	node tests/grocery_item_click.mjs
	node --check www/app.js

test-grocery-total:
	node tests/grocery_total.mjs
	node --check www/app.js

test-dish-ingredient-details:
	node tests/dish_ingredient_details.mjs
	node --check www/app.js

test-dish-nutriscore-filter:
	node tests/dish_nutriscore_filter.mjs
	node --check www/app.js

test-dish-scheduling:
	node tests/dish_scheduling.mjs
	node --check www/app.js

test-catalogue-filters:
	node tests/catalogue_filters.mjs
	node --check www/app.js

test-add-to-needs-button:
	node tests/add_to_needs_button.mjs

test-catalogue-add:
	cargo test --test domain catalogue::the_item_catalogue_edits_general_items_and_deletes_safely
	node tests/catalogue_add.mjs
	node --check www/app.js

test-price-history-labels:
	node tests/price_history_labels.mjs

test-architecture:
	python3 scripts/check_source_boundaries.py

release-check: test test-web build
	python3 scripts/release_check.py

clean:
	rm -rf pkg dist
