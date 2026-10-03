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

function mapCategory(cat) {
  const catName = cat.categoryName || cat.name || "";
  const rawSubs = cat.subCategories || cat.subcategories || [];

  // A real subcategory must have a name different from the parent and contain items.
  // Same-name wrapping causes the frontend to render an empty drill-down screen.
  const trueSubs = rawSubs
    .map((sub) => ({
      name: sub.subCategoryName || sub.categoryName || sub.name || "",
      items: mapItems(sub.dishes || sub.items || []),
    }))
    .filter((sub) => sub.name !== catName && sub.items.length > 0);

  // Direct items sitting at the category level (used in flat + Structure 4)
  const directItems = mapItems(cat.dishes || cat.items || []);

  if (trueSubs.length > 0) {
    // Multilevel or Structure 4 — include direct items if present alongside subcategories.
    return { name: catName, subcategories: trueSubs, items: directItems };
  }

  // Flat category — gather items directly or by flattening same-name / bare subcategories.
  let items = directItems;
  if (items.length === 0) {
    items = rawSubs.flatMap((sub) => mapItems(sub.dishes || sub.items || []));
  }
  if (items.length === 0) return null;
  return { name: catName, subcategories: [], items };
}

function mapCategories(categories) {
  if (!Array.isArray(categories)) return [];
  return categories.map(mapCategory).filter(Boolean);
}

module.exports = { mapSizes, mapItems, mapCategory, mapCategories };
