const express = require("express");
const router = express.Router();
const { sendCustomNotification } = require("../services/notificationService");

// POST /api/v1/notifications/send
// Body: { title, body, userId? }
// If userId is omitted, sends to all registered devices
router.post("/send", async (req, res) => {
  try {
    const { title, body, userId } = req.body;

    if (!title) return res.status(400).json({ success: false, message: "title is required" });
    if (!body)  return res.status(400).json({ success: false, message: "body is required" });

    const result = await sendCustomNotification({ userId, title, body });

    if (result.total === 0) {
      return res.status(404).json({ success: false, message: "No registered devices found" });
    }

    res.status(200).json({
      success: true,
      message: `Notification sent to ${result.sent}/${result.total} device(s)`,
      ...result,
    });
  } catch (err) {
    console.error("Send notification error:", err);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

module.exports = router;
