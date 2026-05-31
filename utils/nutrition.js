const ACTIVITY_MULTIPLIERS = {
  "Sedentary":          1.2,
  "Lightly active":     1.375,
  "Moderately active":  1.55,
  "Very active":        1.725,
};

const PACE_LABELS = {
  0.25: "Slow (0.25 kg/wk)",
  0.5:  "Moderate (0.5 kg/wk)",
  1:    "Fast (1 kg/wk)",
};

const PACE_VALUES = {
  "Slow (0.25 kg/wk)":    { value: 0.25, unit: "kg_per_week" },
  "Moderate (0.5 kg/wk)": { value: 0.5,  unit: "kg_per_week" },
  "Fast (1 kg/wk)":       { value: 1,    unit: "kg_per_week" },
};

// Convert raw onboarding bodyMetrics / pace to metric for calculation.
// unitSystem "imperial" → ft→cm, lb→kg, lb_per_week→kg_per_week
function toMetric({ height, weight, targetWeight, pace, unitSystem }) {
  const isImperial = unitSystem === "imperial";

  const heightCm = isImperial
    ? (height?.value ?? 0) * 30.48
    : (height?.value ?? 0);

  const weightKg = isImperial
    ? (weight?.value ?? 0) * 0.453592
    : (weight?.value ?? 0);

  const targetWeightKg = isImperial
    ? (targetWeight?.value ?? 0) * 0.453592
    : (targetWeight?.value ?? 0);

  let paceKgPerWeek = pace?.value ?? 0;
  if (isImperial && pace?.unit === "lb_per_week") {
    paceKgPerWeek = paceKgPerWeek * 0.453592;
  }

  return { heightCm, weightKg, targetWeightKg, paceKgPerWeek };
}

// All inputs must be in metric (cm, kg).
// Returns { calories, protein, carbs, fat, clamped, weeksToGoal }
function calculateNutritionGoals({ weightKg, targetWeightKg, heightCm, age, sex, activityLevel, goal, paceKgPerWeek }) {
  // Step 1 — BMR (Mifflin-St Jeor)
  const bmrConstant = sex === "Female" ? -161 : 5;
  const bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) + bmrConstant;

  // Step 2 — TDEE
  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel] || 1.2;
  const tdee = bmr * multiplier;

  // Step 3 — Daily calorie target
  // 7700 kcal ≈ 1 kg of body fat
  const minCalories = sex === "Female" ? 1200 : 1500;
  let dailyCalories;
  let clamped = false;

  if (goal === "Lose weight") {
    const dailyDelta = (paceKgPerWeek * 7700) / 7;
    const target = tdee - dailyDelta;
    if (target < minCalories) {
      dailyCalories = minCalories;
      clamped = true;
    } else {
      dailyCalories = target;
    }
  } else if (goal === "Gain muscle" || goal === "Gain weight") {
    const dailyDelta = (paceKgPerWeek * 7700) / 7;
    dailyCalories = tdee + dailyDelta;
  } else {
    // "Maintain" / "Maintain weight"
    dailyCalories = tdee;
  }

  dailyCalories = Math.round(dailyCalories);

  // Step 4 — Macros
  const protein = Math.round((dailyCalories * 0.30) / 4);
  const carbs   = Math.round((dailyCalories * 0.45) / 4);
  const fat     = Math.round((dailyCalories * 0.25) / 9);

  // Step 5 — Weeks to goal
  let weeksToGoal = null;
  const isWeightChangeGoal = goal === "Lose weight" || goal === "Gain muscle" || goal === "Gain weight";
  if (isWeightChangeGoal && paceKgPerWeek > 0 && targetWeightKg) {
    weeksToGoal = Math.round((Math.abs(weightKg - targetWeightKg) / paceKgPerWeek) * 10) / 10;
  }

  return { calories: dailyCalories, protein, carbs, fat, clamped, weeksToGoal };
}

module.exports = { calculateNutritionGoals, toMetric, PACE_LABELS, PACE_VALUES };
