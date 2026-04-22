const mongoose = require("mongoose");

const restaurantSuggestionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name:   { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RestaurantSuggestion", restaurantSuggestionSchema);
