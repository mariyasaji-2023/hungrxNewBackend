const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const authMiddleware = require("../middleware/auth");
const FoodLog = require("../models/FoodLog");

router.post("/addFoodLog", authMiddleware, async (req, res) => {
  try {
    const { restaurantId, itemName, emoji, sizeLabel, kcal, meal, time } = req.body;

    if (!restaurantId || !itemName || !kcal || !meal || !time) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const today = new Date().toISOString().split("T")[0];

    const entry = {
      id: `log_${uuidv4().replace(/-/g, "").slice(0, 9)}`,
      restaurantId,
      emoji,
      name: itemName,
      meal,
      time,
      date: today,
      kcal,
      sizeLabel,
    };

    await FoodLog.findOneAndUpdate(
      { userId: req.user.id },
      { $push: { history: entry } },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      data: {
        id:    entry.id,
        emoji: entry.emoji,
        name:  entry.name,
        meal:  entry.meal,
        time:  entry.time,
        kcal:  entry.kcal,
      },
    });
  } catch (error) {
    console.error("Food log error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.delete("/deleteFoodLog/:logId", authMiddleware, async (req, res) => {
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
