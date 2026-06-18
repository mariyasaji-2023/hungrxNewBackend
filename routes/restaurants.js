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

const MAPBOX_CATEGORIES_1 =
  "fast_food_restaurant,burger_restaurant,sandwich_restaurant,ice_cream_shop,coffee_shop";

const MAPBOX_CATEGORIES_2 =
  "pizza_restaurant,mexican_restaurant,chinese_restaurant,steakhouse";

async function fetchPOIGroup(lat, lon, categories, groupLabel) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) { console.log("[Mapbox] MAPBOX_TOKEN missing"); return []; }
  const url =
    `${SEARCHBOX_BASE}/category/${categories}` +
    `?proximity=${lon},${lat}` +
    `&limit=25` +
    `&radius=0.04` +
    `&access_token=${token}`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    console.log(`[Mapbox] ${groupLabel} status:`, resp.status, "| features:", data.features?.length ?? 0);
    if (!resp.ok) { console.log(`[Mapbox] ${groupLabel} error:`, JSON.stringify(data.message)); return []; }
    const features = data.features || [];
    features.forEach((f, i) => console.log(`[Mapbox] ${groupLabel} POI ${i + 1}: ${f.properties?.name ?? "unknown"} | categories: ${JSON.stringify(f.properties?.poi_category)}`));
    return features;
  } catch (e) {
    console.log(`[Mapbox] ${groupLabel} fetch failed:`, e.message);
    return [];
  }
}

async function fetchNearbyPOIs(lat, lon) {
  const [group1, group2] = await Promise.all([
    fetchPOIGroup(lat, lon, MAPBOX_CATEGORIES_1, "Group1"),
    fetchPOIGroup(lat, lon, MAPBOX_CATEGORIES_2, "Group2"),
  ]);

  const seen = new Set();
  const merged = [];
  for (const f of [...group1, ...group2]) {
    const id = f.properties?.mapbox_id || f.properties?.place_id || f.properties?.name;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    merged.push(f);
  }
  console.log(`[Mapbox] Merged POIs: ${merged.length} (group1: ${group1.length}, group2: ${group2.length})`);
  return merged;
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
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
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

function isMultilevelRestaurant(categories) {
  if (!Array.isArray(categories)) return false;
  return categories.some((cat) => {
    const subs = cat.subCategories || cat.subcategories || [];
    return subs.length > 0 && subs.some((sub) => (sub.dishes || sub.items || []).length > 0);
  });
}

function mapCategoriesFlat(categories) {
  if (!Array.isArray(categories)) return [];
  const result = [];
  for (const cat of categories) {
    const rawSubs = cat.subCategories || cat.subcategories || [];
    let items;
    if (rawSubs.length > 0) {
      items = rawSubs.flatMap((sub) => mapItems(sub.dishes || sub.items || []));
    } else {
      items = mapItems(cat.dishes || cat.items || []);
    }
    if (items.length === 0) continue;
    result.push({ name: cat.categoryName || cat.name || "", items });
  }
  return result;
}

function mapCategoriesMultilevel(categories) {
  if (!Array.isArray(categories)) return [];
  const result = [];
  for (const cat of categories) {
    const rawSubs = cat.subCategories || cat.subcategories || [];
    const catName = cat.categoryName || cat.name || "";

    if (rawSubs.length > 0) {
      const subcategories = rawSubs
        .map((sub) => ({
          name: sub.subCategoryName || sub.categoryName || sub.name || "",
          items: mapItems(sub.dishes || sub.items || []),
        }))
        .filter((sub) => sub.items.length > 0);
      if (subcategories.length === 0) continue;
      result.push({ name: catName, subcategories });
    } else {
      // Category has dishes directly (no subCategories) — wrap into one subcategory
      const items = mapItems(cat.dishes || cat.items || []);
      if (items.length === 0) continue;
      result.push({ name: catName, subcategories: [{ name: catName, items }] });
    }
  }
  return result;
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

// ── Cursor helpers ─────────────────────────────────────────────────────────

function encodeCursor(id, distKm) {
  return Buffer.from(JSON.stringify({ id, dist: distKm })).toString("base64");
}

function decodeCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
    if (typeof parsed.id !== "string" || typeof parsed.dist !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── POST /nearby ───────────────────────────────────────────────────────────

router.post("/nearby", authMiddleware, async (req, res) => {
  const { latitude, longitude, cursor = null } = req.body;
  let { limit = 15 } = req.body;

  if (latitude == null || longitude == null) {
    return res.status(400).json({
      success: false,
      error: { code: "LOCATION_REQUIRED", message: "latitude and longitude are required." },
    });
  }

  const userLat = Number(latitude);
  const userLon = Number(longitude);

  if (isNaN(userLat) || isNaN(userLon)) {
    return res.status(400).json({
      success: false,
      error: { code: "LOCATION_REQUIRED", message: "latitude and longitude must be valid numbers." },
    });
  }

  limit = Math.min(Math.max(1, Number(limit) || 15), 30);
  if (Number(req.body.limit) > 30) {
    return res.status(400).json({
      success: false,
      error: { code: "LIMIT_EXCEEDED", message: "limit must not exceed 30." },
    });
  }

  let cursorData = null;
  if (cursor) {
    cursorData = decodeCursor(cursor);
    if (!cursorData) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_CURSOR", message: "The cursor value is invalid or expired." },
      });
    }
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
      console.log(`[Match] "${mapboxName}" → DB: "${dbMatch.restaurantName || dbMatch.name}"`);

      const [rLon, rLat] = feature.geometry?.coordinates || [];
      const distanceMeters = typeof props.distance === "number" ? props.distance : null;
      const distKm = distanceMeters != null ? distanceMeters / 1000 : Infinity;

      restaurants.push({
        id:       dbMatch._id.toString(),
        name:     dbMatch.restaurantName || dbMatch.name || mapboxName,
        imageUrl: dbMatch.logo || dbMatch.imageUrl || "",
        cuisine:  dbMatch.cuisine || cuisineFromCategories(props.poi_category),
        distance: distanceMeters != null ? formatDistance(distanceMeters) : "",
        distKm,
        location: {
          latitude:  rLat   ?? props.coordinates?.latitude  ?? 0,
          longitude: rLon   ?? props.coordinates?.longitude ?? 0,
          address:   props.full_address || props.address || "",
        },
      });
    }

    // Keep only the nearest branch per DB restaurant, sorted ascending by distance
    const nearest = new Map();
    for (const r of restaurants) {
      const prev = nearest.get(r.id);
      if (!prev || r.distKm < prev.distKm) nearest.set(r.id, r);
    }
    const deduped = Array.from(nearest.values()).sort((a, b) => a.distKm - b.distKm);

    // Apply cursor-based pagination
    let startIndex = 0;
    if (cursorData) {
      const pos = deduped.findIndex((r) => r.id === cursorData.id);
      startIndex = pos === -1 ? 0 : pos + 1;
    }

    const page = deduped.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < deduped.length;
    const lastItem = page[page.length - 1];
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.id, lastItem.distKm) : null;

    // Strip internal distKm before sending
    const responseRestaurants = page.map(({ distKm: _distKm, ...rest }) => rest);

    return res.status(200).json({
      success: true,
      data: {
        locationLabel,
        restaurants: responseRestaurants,
        pagination: {
          nextCursor,
          hasMore,
          total: deduped.length,
        },
      },
    });
  } catch (error) {
    console.error("Nearby restaurants error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch restaurants" });
  }
});

// ── GET /:restaurantId/menu ────────────────────────────────────────────────

router.get("/:restaurantId/menu", authMiddleware, async (req, res) => {
  const { restaurantId } = req.params;
  let categoryIndex = Math.max(0, parseInt(req.query.categoryIndex, 10) || 0);
  let limit = parseInt(req.query.limit, 10);
  if (isNaN(limit) || limit < 1) limit = 50;

  if (limit > 100) {
    return res.status(400).json({
      success: false,
      error: { code: "LIMIT_EXCEEDED", message: "limit must not exceed 100 for menu categories." },
    });
  }

  try {
    const restaurant = await Restaurant.findById(restaurantId).lean();
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: { code: "RESTAURANT_NOT_FOUND", message: "Restaurant not found." },
      });
    }

    const multilevel = isMultilevelRestaurant(restaurant.categories);
    const allCategories = multilevel
      ? mapCategoriesMultilevel(restaurant.categories)
      : mapCategoriesFlat(restaurant.categories);
    const totalCategories = allCategories.length;
    const page = allCategories.slice(categoryIndex, categoryIndex + limit);
    const nextCategoryIndex = categoryIndex + limit < totalCategories ? categoryIndex + limit : null;
    const hasMore = nextCategoryIndex !== null;

    return res.status(200).json({
      success: true,
      data: {
        restaurantId,
        isMultilevel: multilevel,
        categories: page,
        pagination: {
          categoryIndex,
          nextCategoryIndex,
          totalCategories,
          hasMore,
        },
      },
    });
  } catch (error) {
    // Mongoose CastError means the ID format is invalid → treat as not found
    if (error.name === "CastError") {
      return res.status(404).json({
        success: false,
        error: { code: "RESTAURANT_NOT_FOUND", message: "Restaurant not found." },
      });
    }
    console.error("Restaurant menu error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch menu" });
  }
});

module.exports = router;
