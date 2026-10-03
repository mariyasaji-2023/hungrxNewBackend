const express = require("express");
const router = express.Router();
const Restaurant = require("../models/Restaurant");
const { mapCategories } = require("../utils/menuMapper");

// Public (no JWT) restaurant preview for the onboarding "Sneak Peek" screen,
// shown before the user has signed up. Returns a fixed featured list only.

const FEATURED = ["McDonald's", "Chipotle", "Subway", "Starbucks", "Chick-fil-A", "Shake Shack"];

const MAX_CATEGORIES = 8;
const MAX_ITEMS_PER_CATEGORY = 10;
const CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// ── Rate limit (in-memory, per IP) ─────────────────────────────────────────

const hits = new Map();

function rateLimit(req, res, next) {
  const now = Date.now();
  const entry = hits.get(req.ip);
  if (!entry || now > entry.resetAt) {
    hits.set(req.ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ success: false, message: "Too many requests" });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) if (now > entry.resetAt) hits.delete(ip);
}, RATE_LIMIT_WINDOW_MS).unref();

// ── Featured-name matching ─────────────────────────────────────────────────

// "McDonald's" → /^m[^a-z0-9]*c[^a-z0-9]*d.../i so "McDonalds" / "McDonald's" both match;
// the trailing lookahead allows "Chipotle Mexican Grill" but not "Subwayz".
function featuredRegex(name) {
  const chars = name.toLowerCase().replace(/[^a-z0-9]/g, "").split("");
  return new RegExp(`^${chars.join("[^a-z0-9]*")}(?![a-z0-9])`, "i");
}

// ── Build + cache ──────────────────────────────────────────────────────────

function toPreviewCategories(restaurantDoc) {
  return mapCategories(restaurantDoc.categories)
    .map((cat) => {
      // Flatten subcategory items into their parent category.
      const items = [...cat.items, ...cat.subcategories.flatMap((s) => s.items)]
        .map((item) => {
          const size = item.sizes.find((s) => s.kcal > 0);
          if (!item.name || !size) return null;
          return {
            name:        item.name,
            description: item.description,
            imageUrl:    item.imageUrl,
            sizeLabel:   size.label,
            kcal:        size.kcal,
            protein:     size.protein,
            carbs:       size.carbs,
            fat:         size.fat,
          };
        })
        .filter(Boolean)
        .slice(0, MAX_ITEMS_PER_CATEGORY);
      return { name: cat.name, items };
    })
    .filter((cat) => cat.items.length > 0)
    .slice(0, MAX_CATEGORIES);
}

let cache = { at: 0, restaurants: null };

async function loadFeatured() {
  if (cache.restaurants && Date.now() - cache.at < CACHE_TTL_MS) return cache.restaurants;

  const regexes = FEATURED.map(featuredRegex);
  const docs = await Restaurant.find({ restaurantName: { $in: regexes } }).lean();

  const restaurants = [];
  for (const regex of regexes) {
    const doc = docs.find((d) => regex.test(d.restaurantName || ""));
    if (!doc) continue;
    const categories = toPreviewCategories(doc);
    if (!categories.length) continue;
    restaurants.push({
      id:         doc._id.toString(),
      name:       doc.restaurantName,
      logo:       doc.logo || doc.imageUrl || "",
      cuisine:    doc.cuisine || "Restaurant",
      rating:     doc.rating ?? null,
      categories,
    });
  }

  cache = { at: Date.now(), restaurants };
  return restaurants;
}

// ── GET /api/v1/restaurants/preview?kcal=1850 ──────────────────────────────
// fitKcal: with ?kcal, the highest-calorie dish that still fits under that
// target (null if none fits); without it, the lowest-calorie dish.

router.get("/", rateLimit, async (req, res) => {
  try {
    const target = req.query.kcal !== undefined ? Number(req.query.kcal) : null;
    if (target !== null && (!Number.isFinite(target) || target <= 0 || target > 10000)) {
      return res.status(400).json({ success: false, message: "kcal must be a positive number" });
    }

    const restaurants = (await loadFeatured()).map((r) => {
      const kcals = r.categories.flatMap((c) => c.items.map((i) => i.kcal));
      const fitKcal = target === null
        ? Math.min(...kcals)
        : kcals.filter((k) => k <= target).reduce((max, k) => Math.max(max, k), 0) || null;
      return { ...r, fitKcal };
    });

    res.set("Cache-Control", "public, max-age=300");
    return res.status(200).json({ success: true, data: { restaurants } });
  } catch (error) {
    console.error("Restaurant preview error:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

module.exports = router;
