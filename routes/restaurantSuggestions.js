const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const RestaurantSuggestion = require("../models/RestaurantSuggestion");

router.post("/", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Name cannot be empty" });
    }

    await RestaurantSuggestion.create({ userId: req.user.id, name: name.trim() });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Restaurant suggestion error:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

module.exports = router;
