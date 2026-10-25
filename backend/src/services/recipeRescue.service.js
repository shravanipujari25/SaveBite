import { inventoryRepository } from '../repositories/inventory.repository.js';
import { aiClientService } from './aiClient.service.js';
import { logger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

export class RecipeRescueService {
  constructor(dependencies = {}) {
    this.inventoryRepo = dependencies.inventoryRepo || inventoryRepository;
    this.aiClient = dependencies.aiClient || aiClientService;
  }

  /**
   * Fetch prioritized at-risk items and retrieve AI recipe rescue suggestions.
   *
   * @param {string} householdId
   * @param {object} [options={}]
   * @returns {Promise<{ recipes: object[], rescued_items: object[], total_at_risk_count: number }>}
   */
  async getRescueRecipes(householdId, options = {}) {
    // 1. Fetch active household items
    const activeItems = await this.inventoryRepo.findAllActive(householdId);

    if (!activeItems || activeItems.length === 0) {
      logger.info({ householdId }, 'No active inventory items found for recipe rescue');
      return {
        recipes: [],
        rescued_items: [],
        total_at_risk_count: 0,
        message: 'No active inventory items found in your household pantry.'
      };
    }

    // 2. Sort items by priority: critical/use_soon first, high use_first_score, or lowest adj_days_left
    const sortedItems = [...activeItems].sort((a, b) => {
      const scoreA = Number(a.use_first_score) || 0;
      const scoreB = Number(b.use_first_score) || 0;
      if (scoreB !== scoreA) return scoreB - scoreA;

      const daysA = a.adj_days_left !== null && a.adj_days_left !== undefined ? Number(a.adj_days_left) : 999;
      const daysB = b.adj_days_left !== null && b.adj_days_left !== undefined ? Number(b.adj_days_left) : 999;
      return daysA - daysB;
    });

    // Filter top candidates (up to 15 items) to pass as recipe inventory
    const candidateIngredients = sortedItems.slice(0, 15).map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      category: item.category,
      storage_location: item.storage_location,
      freshness_bucket: item.freshness_bucket || 'fresh',
      use_first_score: item.use_first_score || 0,
      adj_days_left: item.adj_days_left,
      purchase_date: item.purchase_date,
      expiry_date: item.expiry_date,
      is_opened: item.is_opened
    }));

    // Build InventoryItem[] payload adhering strictly to AI service's InventoryItem schema
    const inventoryPayload = candidateIngredients.map((item) => {
      // Clean string dates (YYYY-MM-DD)
      const purchaseDateStr = item.purchase_date
        ? (typeof item.purchase_date === 'string' ? item.purchase_date.split('T')[0] : new Date(item.purchase_date).toISOString().split('T')[0])
        : null;
      const expiryDateStr = item.expiry_date
        ? (typeof item.expiry_date === 'string' ? item.expiry_date.split('T')[0] : new Date(item.expiry_date).toISOString().split('T')[0])
        : null;

      return {
        inventory_item_id: item.id,
        product_name: item.name,
        quantity: Math.max(0.01, Number(item.quantity) || 1.0),
        unit: (item.unit || 'unit').toLowerCase(),
        purchase_date: purchaseDateStr,
        expiry_date: expiryDateStr,
        opened: Boolean(item.is_opened),
        status: 'available',
        simulated: false
      };
    });

    // Build priority_data mapping (inventory_item_id -> "Red" | "Orange" | "Yellow" | "Green")
    const priorityData = {};
    for (const item of candidateIngredients) {
      if (item.freshness_bucket === 'critical' || (item.use_first_score && item.use_first_score >= 80)) {
        priorityData[item.id] = 'Red';
      } else if (item.freshness_bucket === 'use_soon' || (item.use_first_score && item.use_first_score >= 60)) {
        priorityData[item.id] = 'Orange';
      } else if (item.use_first_score && item.use_first_score >= 40) {
        priorityData[item.id] = 'Yellow';
      } else {
        priorityData[item.id] = 'Green';
      }
    }

    const requestedLimit = Number(options.limit) || 10;

    // 3. Dispatch to AI service
    logger.info({ householdId, candidateCount: inventoryPayload.length }, 'Requesting AI recipe recommendations');

    const aiResponse = await this.aiClient.rescueRecipes({
      inventory: inventoryPayload,
      priority_data: priorityData,
      limit: requestedLimit
    });

    // Support both new `recommendations` array and backward-compatible `recipes` array
    const rawRecommendations = aiResponse.recommendations || aiResponse.recipes || [];

    // Map which at-risk inventory items each recipe helps rescue
    const atRiskItemNames = new Set(
      candidateIngredients
        .filter((it) => (it.use_first_score && it.use_first_score >= 50) || (it.adj_days_left !== null && it.adj_days_left <= 4) || it.freshness_bucket !== 'fresh')
        .map((it) => it.name.toLowerCase())
    );

    const normalizedRecipes = rawRecommendations.map((rec) => {
      const recipeId = rec.recipe_id || rec.id || crypto.randomUUID();
      const title = rec.name || rec.title || 'Recommended Recipe';

      // Identify rescued at-risk items:
      // Use matched_ingredients from AI response if available, or name-based matching
      let matchingRescued = [];
      if (Array.isArray(rec.matched_ingredients) && rec.matched_ingredients.length > 0) {
        const matchedIds = new Set();
        for (const mi of rec.matched_ingredients) {
          if (Array.isArray(mi.matched_inventory_ids)) {
            for (const id of mi.matched_inventory_ids) matchedIds.add(id);
          }
        }
        matchingRescued = candidateIngredients.filter((inv) => matchedIds.has(inv.id));
      }

      if (matchingRescued.length === 0) {
        matchingRescued = candidateIngredients.filter((inv) => {
          const invName = inv.name.toLowerCase();
          return (
            (rec.rescued_ingredients || []).some((r) => r.toLowerCase().includes(invName) || invName.includes(r.toLowerCase())) ||
            (rec.ingredients || []).some((ing) => {
              const ingText = typeof ing === 'string' ? ing.toLowerCase() : (ing.name || '').toLowerCase();
              return ingText.includes(invName);
            })
          );
        });
      }

      // Format ingredients list: ensure it can be displayed nicely on UI
      const ingredientsList = Array.isArray(rec.ingredients)
        ? rec.ingredients
        : (Array.isArray(rec.matched_ingredients)
          ? rec.matched_ingredients.map((m) => `${m.required_quantity} ${m.required_unit} ${m.ingredient_name}`)
          : []);

      return {
        id: recipeId,
        title,
        description: rec.description || rec.reasons?.join(' ') || null,
        prep_time_minutes: rec.preparation_time_minutes || rec.prep_time_minutes || 20,
        cook_time_minutes: rec.cook_time_minutes || null,
        servings: rec.servings || 2,
        difficulty: rec.difficulty || 'Easy',
        ingredients: ingredientsList,
        instructions: rec.instructions || [],
        rescued_items: matchingRescued.map((it) => ({
          id: it.id,
          name: it.name,
          quantity: it.quantity,
          unit: it.unit,
          freshness_bucket: it.freshness_bucket,
          use_first_score: it.use_first_score,
          adj_days_left: it.adj_days_left
        })),
        waste_reduction_score: rec.score !== undefined ? Math.round(rec.score) : (rec.waste_reduction_score || (matchingRescued.length * 20)),
        missing_ingredients: rec.missing_ingredients || [],
        reasons: rec.reasons || []
      };
    });

    return {
      recipes: normalizedRecipes,
      candidate_ingredients: candidateIngredients,
      total_at_risk_count: candidateIngredients.filter((i) => atRiskItemNames.has(i.name.toLowerCase())).length
    };
  }
}

export const recipeRescueService = new RecipeRescueService();
export default recipeRescueService;
