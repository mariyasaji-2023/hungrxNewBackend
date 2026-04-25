const mongoose = require("mongoose");

const restaurantSchema = new mongoose.Schema(
  { restaurantName: String, logo: String },
  { strict: false, collection: "restaurants" }
);

module.exports = mongoose.model("Restaurant", restaurantSchema);
