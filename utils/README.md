# utils/

Only `nutrition.js` — pure functions, no I/O. Used by `routes/auth.js` (signup) and `routes/profile.js` (PUT).

## Exports
- `calculateNutritionGoals({ weightKg, targetWeightKg, heightCm, age, sex, activityLevel, goal, paceKgPerWeek })` → `{ calories, protein, carbs, fat, clamped, weeksToGoal }`. **Inputs must be metric.**
- `toMetric({ height, weight, targetWeight, pace, unitSystem })` → `{ heightCm, weightKg, targetWeightKg, paceKgPerWeek }`. Imperial: height value × 30.48 (value treated as decimal **feet**), weight × 0.453592, pace `lb_per_week` × 0.453592.
- `normalizePace(pace)` → `{ value, unit:"kg_per_week" }` snapped to nearest tier 0.25 / 0.5 / 1.0 (default 0.5 if missing).
- `PACE_LABELS` (`0.25→"Slow (0.25 kg/wk)"`, `0.5→"Moderate (0.5 kg/wk)"`, `1→"Fast (1 kg/wk)"`) used to render profile `pace`.
- `PACE_VALUES` — label → `{value, unit}`; also accepts imperial aliases ("Slow (0.5 lb/wk)", "Moderate (1 lb/wk)", "Fast (2 lb/wk)") mapping to the same kg tiers. Keys define the valid `pace` values for `PUT /profile`.

## Algorithm
1. **BMR** Mifflin-St Jeor: `10·kg + 6.25·cm − 5·age + (5 male/other | −161 female)`.
2. **TDEE** = BMR × activity (Sedentary 1.2, Lightly active 1.375, Moderately active 1.55, Very active 1.725; unknown → 1.2).
3. **Calories**: Lose weight → `TDEE − pace·7700/7`, floored at 1200 (female) / 1500 (else) with `clamped=true`; Gain muscle / Gain weight → `TDEE + pace·7700/7`; otherwise TDEE. Rounded.
4. **Macros** fixed split: protein 30% /4, carbs 45% /4, fat 25% /9 (grams).
5. **weeksToGoal** = `|weightKg − targetWeightKg| / pace` (1 decimal) for weight-change goals only, else `null`.

Input normalization maps snake_case / lowercase goal and activity strings (`lose_weight`, `very_active`, …) to canonical labels via `GOAL_NORMALIZE` / `ACTIVITY_NORMALIZE`; sex is capitalized. Canonical goals: "Lose weight", "Gain weight", "Gain muscle", "Maintain weight", "Maintain". Canonical activity: the four above.

Gotchas: "Other" sex uses the male constant. No age/height/weight sanity validation. If you change the formula, existing users keep stored goals until they next edit their profile.

## menuMapper.js
Maps raw `Restaurant.categories` (schemaless, several shapes) to the API menu shape: `mapCategories(categories)` → `[{ name, subcategories:[{name,items}], items }]`, items `{ name, description, imageUrl, sizes:[{label,kcal,protein,carbs,fat}] }`. Handles `dishName|name`, `dishes|items`, `subCategories|subcategories`, `servingInfos|sizes`, drops empty/same-name wrapper subcategories. Used by `routes/restaurants.js` (menu endpoint) and `routes/restaurantPreview.js`. Change menu field handling here, once.
