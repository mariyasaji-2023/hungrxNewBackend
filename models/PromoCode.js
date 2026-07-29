const mongoose = require("mongoose");

const promoCodeSchema = new mongoose.Schema({
  code:          { type: String, required: true, unique: true, uppercase: true },
  note:          { type: String },
  createdAt:     { type: Date, default: Date.now },
  codeExpiresAt: { type: Date, required: true },
  accessDurationDays: { type: Number, required: true, default: 7 },
  redeemedBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  redeemedAt:    { type: Date, default: null },
});

module.exports = mongoose.model("PromoCode", promoCodeSchema);
