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

    // Filter top candidates (up to 15 items) to pass as recipe ingredients
    const candidateIngredients = sortedItems.slice(0, 15).map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      category: item.category,
      storage_location: item.storage_location,
      freshness_bucket: item.freshness_bucket || 'fresh',
      use_first_score: item.use_first_score || 0,
      adj_days_left: item.adj_days_left
    }));

    const dietaryPreferences = options.dietary_preference
      ? [options.dietary_preference]
      : [];

    // 3. Dispatch to AI service
    logger.info({ householdId, candidateCount: candidateIngredients.length }, 'Requesting AI recipe rescue suggestions');

    const aiResponse = await this.aiClient.rescueRecipes(
      candidateIngredients,
      dietaryPreferences
    );

    const recipes = aiResponse.recipes || [];

    // Map which at-risk inventory items each recipe helps rescue
    const atRiskItemNames = new Set(
      candidateIngredients
        .filter((it) => (it.use_first_score && it.use_first_score >= 50) || (it.adj_days_left !== null && it.adj_days_left <= 4) || it.freshness_bucket !== 'fresh')
        .map((it) => it.name.toLowerCase())
    );

    const normalizedRecipes = recipes.map((recipe) => {
      // Find matching at-risk items from household inventory
      const matchingRescued = candidateIngredients.filter((inv) => {
        const invName = inv.name.toLowerCase();
        return (
          (recipe.rescued_ingredients || []).some((r) => r.toLowerCase().includes(invName) || invName.includes(r.toLowerCase())) ||
          (recipe.ingredients || []).some((ing) => {
            const ingText = typeof ing === 'string' ? ing.toLowerCase() : (ing.name || '').toLowerCase();
            return ingText.includes(invName);
          })
        );
      });

      return {
        id: recipe.id || crypto.randomUUID(),
        title: recipe.title,
        description: recipe.description || null,
        prep_time_minutes: recipe.prep_time_minutes || null,
        cook_time_minutes: recipe.cook_time_minutes || null,
        servings: recipe.servings || null,
        ingredients: recipe.ingredients || [],
        instructions: recipe.instructions || [],
        rescued_items: matchingRescued.map((it) => ({
          id: it.id,
          name: it.name,
          quantity: it.quantity,
          unit: it.unit,
          freshness_bucket: it.freshness_bucket,
          use_first_score: it.use_first_score
        })),
        waste_reduction_score: recipe.waste_reduction_score || (matchingRescued.length * 20)
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
