const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const adminAuth = require("../middleware/adminAuth");
const PromoCode = require("../models/PromoCode");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // excludes 0/O/1/I to avoid typos
const CODE_LENGTH = 6;
const CODE_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

function generateCode() {
  let suffix = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    suffix += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  }
  return `HUNX-${suffix}`;
}

router.post("/promo-codes", adminAuth, async (req, res) => {
  try {
    const { note } = req.body;

    let code;
    for (let attempts = 0; attempts < 5; attempts++) {
      const candidate = generateCode();
      if (!(await PromoCode.findOne({ code: candidate }))) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      return res.status(500).json({ success: false, message: "Something went wrong" });
    }

    const createdAt = new Date();
    const codeExpiresAt = new Date(createdAt.getTime() + CODE_VALIDITY_MS);

    const promo = await PromoCode.create({ code, note, createdAt, codeExpiresAt });

    return res.status(200).json({
      success: true,
      code: promo.code,
      createdAt: promo.createdAt.toISOString(),
      codeExpiresAt: promo.codeExpiresAt.toISOString(),
    });
  } catch (error) {
    console.error("Generate promo code error:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

router.get("/promo-codes", adminAuth, async (req, res) => {
  try {
    const codes = await PromoCode.find().sort({ createdAt: -1 }).populate("redeemedBy", "name");
    const now = new Date();

    return res.status(200).json({
      success: true,
      data: codes.map((c) => ({
        code: c.code,
        note: c.note || "",
        createdAt: c.createdAt.toISOString(),
        codeExpiresAt: c.codeExpiresAt.toISOString(),
        status: c.redeemedBy ? "redeemed" : now > c.codeExpiresAt ? "expired" : "unused",
        redeemedBy: c.redeemedBy ? { userId: c.redeemedBy._id, name: c.redeemedBy.name } : null,
        redeemedAt: c.redeemedAt ? c.redeemedAt.toISOString() : null,
      })),
    });
  } catch (error) {
    console.error("List promo codes error:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

module.exports = router;
