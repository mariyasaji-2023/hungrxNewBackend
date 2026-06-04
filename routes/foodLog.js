const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const authMiddleware = require("../middleware/auth");
const FoodLog = require("../models/FoodLog");

router.post("/", authMiddleware, async (req, res) => {
  try {
    const { restaurantId, restaurantName, restaurantEmoji, itemName, emoji, sizeLabel, kcal, protein, carbs, fat, meal, time, location } = req.body;

    if (!itemName || !kcal || !meal || !time) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const today = new Date().toISOString().split("T")[0];

    const entry = {
      id: `log_${uuidv4().replace(/-/g, "").slice(0, 9)}`,
      restaurantId:    restaurantId    ?? "",
      restaurantName:  restaurantName  ?? "",
      restaurantEmoji: restaurantEmoji ?? "🍽️",
      emoji,
      name: itemName,
      meal,
      time,
      date: today,
      kcal,
      sizeLabel,
      protein: protein ?? 0,
      carbs:   carbs   ?? 0,
      fat:     fat     ?? 0,
      ...(location?.latitude != null && location?.longitude != null
        ? { location: { latitude: location.latitude, longitude: location.longitude, address: location.address ?? "" } }
        : {}),
    };

    await FoodLog.findOneAndUpdate(
      { userId: req.user.id },
      { $push: { history: entry } },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      data: {
        id:              entry.id,
        emoji:           entry.emoji,
        name:            entry.name,
        meal:            entry.meal,
        time:            entry.time,
        kcal:            entry.kcal,
        restaurantId:    entry.restaurantId,
        restaurantName:  entry.restaurantName,
        restaurantEmoji: entry.restaurantEmoji,
        nutrition: {
          protein: entry.protein,
          carbs:   entry.carbs,
          fat:     entry.fat,
          fiber:   0,
          sodium:  0,
        },
      },
    });
  } catch (error) {
    console.error("Food log error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.delete("/:logId", authMiddleware, async (req, res) => {
  try {
    const { logId } = req.params;

    const result = await FoodLog.findOneAndUpdate(
      { userId: req.user.id },
      { $pull: { history: { id: logId } } },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({ success: false, message: "Food log not found" });
    }

    return res.status(200).json({ success: true, message: "Food log deleted successfully" });
  } catch (error) {
    console.error("Delete food log error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
