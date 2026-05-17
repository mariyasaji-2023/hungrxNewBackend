const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const Restaurant = require("../models/Restaurant");

const SEARCHBOX_BASE = "https://api.mapbox.com/search/searchbox/v1";

const CATEGORY_CUISINE_MAP = {
  fast_food_restaurant:   "Fast Food",
  coffee_shop:            "Coffee & Drinks",
  pizza_restaurant:       "Pizza",
  mexican_restaurant:     "Mexican",
  chinese_restaurant:     "Chinese",
  japanese_restaurant:    "Japanese",
  italian_restaurant:     "Italian",
  burger_restaurant:      "Burgers",
  sandwich_restaurant:    "Sandwiches",
  seafood_restaurant:     "Seafood",
  steakhouse:             "Steakhouse",
  bakery:                 "Bakery",
  ice_cream_shop:         "Ice Cream",
  bar:                    "Bar & Grill",
};

// ── Mapbox Search Box helpers ──────────────────────────────────────────────

const MAPBOX_CATEGORIES =
  "fast_food_restaurant,burger_restaurant,sandwich_restaurant," +
  "ice_cream_shop,pizza_restaurant,mexican_restaurant," +
  "chinese_restaurant,steakhouse";

async function fetchNearbyPOIs(lat, lon) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) { console.log("[Mapbox] MAPBOX_TOKEN missing"); return []; }
  const url =
    `${SEARCHBOX_BASE}/category/${MAPBOX_CATEGORIES}` +
    `?proximity=${lon},${lat}` +
    `&limit=25` +
    `&radius=5` +
    `&access_token=${token}`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    console.log("[Mapbox] POI status:", resp.status, "| features:", data.features?.length ?? 0);
    if (!resp.ok) { console.log("[Mapbox] POI error:", JSON.stringify(data.message)); return []; }
    const features = data.features || [];
    features.forEach((f, i) => console.log(`[Mapbox] POI ${i + 1}: ${f.properties?.name ?? "unknown"} | categories: ${JSON.stringify(f.properties?.poi_category)}`));
    return features;
  } catch (e) {
    console.log("[Mapbox] POI fetch failed:", e.message);
    return [];
  }
}

async function fetchLocationLabel(lat, lon) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return "";
  const url =
    `${SEARCHBOX_BASE}/reverse` +
    `?longitude=${lon}&latitude=${lat}` +
    `&access_token=${token}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return "";
    const data = await resp.json();
    const ctx = data.features?.[0]?.properties?.context || {};
    const city      = ctx.place?.name || "";
    const stateCode = ctx.region?.region_code_full?.replace(/^US-/, "") ||
                      ctx.region?.region_code || "";
    return stateCode ? `${city}, ${stateCode}` : city;
  } catch {
    return "";
  }
}

// ── Name matching ──────────────────────────────────────────────────────────

function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[''`]/g, "")        // remove apostrophes
    .replace(/[^a-z0-9\s]/g, " ") // other punctuation → space
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(mapboxName, dbName) {
  const a = normalizeName(mapboxName);
  const b = normalizeName(dbName);
  const aNoSpace = a.replace(/\s+/g, "");
  const bNoSpace = b.replace(/\s+/g, "");
  return a === b || a.startsWith(b) || b.startsWith(a) ||
    aNoSpace === bNoSpace || aNoSpace.startsWith(bNoSpace) || bNoSpace.startsWith(aNoSpace);
}

// ── DB data → API response mappers ────────────────────────────────────────

function mapSizes(servingInfos) {
  if (!Array.isArray(servingInfos)) return [];
  return servingInfos.map((entry) => {
    const si = entry.servingInfo || entry;
    const nf = si.nutritionFacts || {};
    const rawSize = si.size || "";
    const label = rawSize && rawSize !== "1" ? rawSize : "Regular";
    return {
      label,
      kcal:    Math.round(Number(nf.calories?.value)  || 0),
      protein: Math.round(Number(nf.protein?.value)   || 0),
      carbs:   Math.round(Number(nf.carbs?.value)      || 0),
      fat:     Math.round(Number(nf.totalFat?.value)   || 0),
    };
  });
}

function mapItems(dishes) {
  if (!Array.isArray(dishes)) return [];
  return dishes.map((dish) => ({
    name:        dish.dishName || dish.name || "",
    description: dish.description || "",
    imageUrl:    dish.servingInfos?.[0]?.servingInfo?.Url ||
                 dish.servingInfos?.[0]?.servingInfo?.imageUrl ||
                 dish.imageUrl || "",
    sizes: mapSizes(dish.servingInfos || dish.sizes || []),
  }));
}

function mapCategories(categories) {
  if (!Array.isArray(categories)) return [];
  return categories.map((cat) => {
    const rawSubs = cat.subcategories || [];
    if (rawSubs.length > 0) {
      return {
        name: cat.categoryName || cat.name || "",
        subcategories: rawSubs.map((sub) => ({
          name:  sub.subcategoryName || sub.name || "",
          items: mapItems(sub.dishes || sub.items || []),
        })),
        items: [],
      };
    }
    return {
      name:          cat.categoryName || cat.name || "",
      subcategories: [],
      items:         mapItems(cat.dishes || cat.items || []),
    };
  });
}

function cuisineFromCategories(poiCategories) {
  if (!Array.isArray(poiCategories)) return "Restaurant";
  for (const cat of poiCategories) {
    if (CATEGORY_CUISINE_MAP[cat]) return CATEGORY_CUISINE_MAP[cat];
  }
  return "Restaurant";
}

function formatDistance(meters) {
  return `${(meters / 1000).toFixed(1)} km`;
}

// ── Route ─────────────────────────────────────────────────────────────────

router.post("/nearby", authMiddleware, async (req, res) => {
  const { latitude, longitude } = req.body;

  if (latitude == null || longitude == null) {
    return res.status(400).json({
      success: false,
      message: "latitude and longitude are required",
    });
  }

  const userLat = Number(latitude);
  const userLon = Number(longitude);

  if (isNaN(userLat) || isNaN(userLon)) {
    return res.status(400).json({
      success: false,
      message: "latitude and longitude are required",
    });
  }

  try {
    const [poiFeatures, locationLabel, dbRestaurants] = await Promise.all([
      fetchNearbyPOIs(userLat, userLon),
      fetchLocationLabel(userLat, userLon),
      Restaurant.find({}).lean(),
    ]);

    console.log("[Debug] Mapbox POIs found:", poiFeatures.length, "| DB count:", dbRestaurants.length);
    console.log("[Debug] DB restaurant names:", dbRestaurants.map(r => r.restaurantName || r.name));

    const restaurants = [];

    for (const feature of poiFeatures) {
      const props      = feature.properties || {};
      const mapboxName = props.name || "";
      if (!mapboxName) continue;

      const dbMatch = dbRestaurants.find((r) =>
        namesMatch(mapboxName, r.restaurantName || r.name || "")
      );
      if (!dbMatch) continue;
      console.log(`[Match] "${mapboxName}" → DB: "${dbMatch.restaurantName || dbMatch.name}"`)

      const [rLon, rLat] = feature.geometry?.coordinates || [];
      const distanceMeters = typeof props.distance === "number"
        ? props.distance
        : null;

      restaurants.push({
        id:       dbMatch._id.toString(),
        name:     dbMatch.restaurantName || dbMatch.name || mapboxName,
        imageUrl: dbMatch.logo || dbMatch.imageUrl || "",
        cuisine:  dbMatch.cuisine || cuisineFromCategories(props.poi_category),
        rating:   dbMatch.rating ?? 0,
        distance: distanceMeters != null ? formatDistance(distanceMeters) : "",
        location: {
          latitude:  rLat   ?? props.coordinates?.latitude  ?? 0,
          longitude: rLon   ?? props.coordinates?.longitude ?? 0,
          address:   props.full_address || props.address || "",
        },
        categories: mapCategories(dbMatch.categories),
      });
    }

    // keep only the nearest branch per DB restaurant
    const nearest = new Map();
    for (const r of restaurants) {
      const prev = nearest.get(r.id);
      const d = parseFloat(r.distance) || Infinity;
      if (!prev || d < (parseFloat(prev.distance) || Infinity)) nearest.set(r.id, r);
    }
    const deduped = Array.from(nearest.values()).sort((a, b) => {
      const da = parseFloat(a.distance) || Infinity;
      const db = parseFloat(b.distance) || Infinity;
      return da - db;
    });

    return res.status(200).json({
      success: true,
      data: { locationLabel, restaurants: deduped },
    });
  } catch (error) {
    console.error("Nearby restaurants error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch restaurants" });
  }
});

module.exports = router;
