const mongoose = require("mongoose");

const foodLogEntrySchema = new mongoose.Schema(
  {
    id:           { type: String, required: true },
    restaurantId: { type: String, required: true },
    emoji:        { type: String },
    name:         { type: String, required: true },
    meal:         { type: String, enum: ["Breakfast", "Lunch", "Dinner", "Snack"], required: true },
    time:         { type: String, required: true },
    date:         { type: String, required: true }, // "YYYY-MM-DD"
    kcal:         { type: Number, required: true },
    sizeLabel:    { type: String },
  },
  { _id: false }
);

const foodLogSchema = new mongoose.Schema(
  {
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    history: [foodLogEntrySchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("FoodLog", foodLogSchema);
