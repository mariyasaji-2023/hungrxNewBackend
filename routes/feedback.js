const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const Feedback = require("../models/Feedback");

router.post("/", authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Message cannot be empty" });
    }

    await Feedback.create({ userId: req.user.id, message: message.trim() });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Feedback error:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

module.exports = router;
