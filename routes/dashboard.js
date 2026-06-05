const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const User = require("../models/User");
const FoodLog = require("../models/FoodLog");
const Restaurant = require("../models/Restaurant");

function findDish(restaurant, dishName) {
  if (!restaurant?.categories) return null;
  const target = (dishName || "").toLowerCase().trim();
  for (const cat of restaurant.categories) {
    for (const dish of cat.dishes || cat.items || []) {
      if ((dish.dishName || dish.name || "").toLowerCase().trim() === target) return dish;
    }
    for (const sub of cat.subcategories || []) {
      for (const dish of sub.dishes || sub.items || []) {
        if ((dish.dishName || dish.name || "").toLowerCase().trim() === target) return dish;
      }
    }
  }
  return null;
}

function extractNutrition(dish, sizeLabel) {
  const empty = { protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 };
  if (!dish) return empty;
  const servingInfos = dish.servingInfos || dish.sizes || [];
  let entry = sizeLabel
    ? servingInfos.find((e) => ((e.servingInfo || e).size || "").toLowerCase() === sizeLabel.toLowerCase())
    : null;
  if (!entry) entry = servingInfos[0];
  if (!entry) return empty;
  const nf = (entry.servingInfo || entry).nutritionFacts || {};
  return {
    protein: Math.round(Number(nf.protein?.value)        || 0),
    carbs:   Math.round(Number(nf.carbs?.value)           || 0),
    fat:     Math.round(Number(nf.totalFat?.value)        || 0),
    fiber:   Math.round(Number(nf.fiber?.value ?? nf.dietaryFiber?.value) || 0),
    sodium:  Math.round(Number(nf.sodium?.value)          || 0),
  };
}

function extractLocation(restaurant) {
  if (!restaurant) return null;
  const loc = restaurant.location || null;
  if (loc?.latitude != null && loc?.longitude != null) {
    return { latitude: loc.latitude, longitude: loc.longitude, address: loc.address || "" };
  }
  if (restaurant.latitude != null && restaurant.longitude != null) {
    return { latitude: restaurant.latitude, longitude: restaurant.longitude, address: restaurant.address || "" };
  }
  return null;
}

router.get("/", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const today = new Date().toISOString().split("T")[0];

    const foodLogDoc = await FoodLog.findOne({ userId: user._id });
    const todayEntries = foodLogDoc
      ? foodLogDoc.history.filter((e) => e.date === today)
      : [];

    const restaurantIds = [...new Set(todayEntries.map((e) => e.restaurantId).filter(Boolean))];
    const dbRestaurants = restaurantIds.length
      ? await Restaurant.find({ _id: { $in: restaurantIds } }).lean()
      : [];
    const restaurantMap = new Map(dbRestaurants.map((r) => [r._id.toString(), r]));

    const caloriesConsumed = todayEntries.reduce((sum, e) => sum + (e.kcal    || 0), 0);
    const proteinConsumed  = todayEntries.reduce((sum, e) => sum + (e.protein || 0), 0);
    const carbsConsumed    = todayEntries.reduce((sum, e) => sum + (e.carbs   || 0), 0);
    const fatConsumed      = todayEntries.reduce((sum, e) => sum + (e.fat     || 0), 0);

    const onboardingComplete = !!(
      user.onboarding?.goal &&
      user.onboarding?.sex &&
      user.onboarding?.age &&
      user.onboarding?.bodyMetrics?.height &&
      user.onboarding?.bodyMetrics?.weight
    );

    const sub = user.subscription || {};
    let trialDaysLeft = 0;
    if (sub.trialStartDate && !sub.freeTrailExpired) {
      const elapsed = Math.floor(
        (Date.now() - new Date(sub.trialStartDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      trialDaysLeft = Math.max(0, (sub.trialDays || 7) - elapsed);
      if (trialDaysLeft === 0) {
        user.subscription.freeTrailExpired = true;
        await user.save();
      }
    }

    const goals = user.nutritionGoals || {};

    return res.status(200).json({
      success: true,
      data: {
        user: {
          name:                user.name,
          userId:              user._id,
          isNewUser:           !onboardingComplete,
          onboardingComplete,
          eligibleFreeTrail:   sub.eligibleFreeTrail ?? true,
          freeTrailExpired:    sub.freeTrailExpired ?? false,
          subscriptionExpired: sub.subscriptionExpired ?? false,
          subscriptionPlan:    sub.plan || "free",
          trialDaysLeft,
        },
        calories: {
          consumed: caloriesConsumed,
          goal:     goals.calories || 2000,
          protein: {
            consumed: proteinConsumed,
            goal:     goals.protein || 150,
          },
          carbs: {
            consumed: carbsConsumed,
            goal:     goals.carbs || 250,
          },
          fat: {
            consumed: fatConsumed,
            goal:     goals.fat || 65,
          },
        },
        foodLog: todayEntries.map((e) => {
          const restaurant = restaurantMap.get(e.restaurantId) || null;
          const dish = findDish(restaurant, e.name);
          const dishImageUrl =
            dish?.servingInfos?.[0]?.servingInfo?.Url ||
            dish?.servingInfos?.[0]?.servingInfo?.imageUrl ||
            dish?.imageUrl || "";
          const restaurantLocation = extractLocation(restaurant) ||
            (e.location?.latitude != null ? { latitude: e.location.latitude, longitude: e.location.longitude, address: e.location.address || "" } : null);
          return {
            id:                  e.id,
            name:                e.name,
            meal:                e.meal,
            time:                e.time,
            kcal:                e.kcal,
            restaurantId:        e.restaurantId    ?? "",
            restaurantName:      e.restaurantName  ?? "",
            restaurantEmoji:     e.restaurantEmoji ?? "🍽️",
            restaurantImageUrl:  restaurant?.logo || restaurant?.imageUrl || "",
            dishImageUrl,
            restaurantLocation,
            nutrition:           extractNutrition(dish, e.sizeLabel),
          };
        }),
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
