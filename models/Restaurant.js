const mongoose = require("mongoose");

const restaurantSchema = new mongoose.Schema(
  {
    restaurantName: String,
    logo:           String,
    cuisine:        String,
    rating:         Number,
  },
  { strict: false, collection: "restaurants" }
);

module.exports = mongoose.model("Restaurant", restaurantSchema);
