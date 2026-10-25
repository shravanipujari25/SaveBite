import { z } from 'zod';
import env from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const aiReceiptItemSchema = z.object({
  name: z.string().min(1, 'Product line name is required'),
  quantity: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  unit_price: z.number().nullable().optional(),
  total_price: z.number().nullable().optional(),
  confidence: z.number().min(0).max(1).optional().default(1.0)
});

const aiReceiptResponseSchema = z.object({
  items: z.array(aiReceiptItemSchema),
  merchant_name: z.string().nullable().optional(),
  purchase_date: z.string().nullable().optional(),
  total_amount: z.number().nullable().optional(),
  confidence: z.number().min(0).max(1).optional()
});

const aiNormalizeResponseSchema = z.object({
  normalized_name: z.string().min(1),
  category: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  storage_location: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional().default(1.0)
});

const aiFreshnessResponseSchema = z.object({
  freshness_score: z.number().min(0).max(100),
  status: z.enum(['fresh', 'use_soon', 'critical', 'expired']).optional(),
  confidence: z.number().min(0).max(1).optional().default(1.0),
  notes: z.string().optional()
});

const aiShelfLifeResponseSchema = z.object({
  adj_days_left: z.number(),
  predicted_spoilage_date: z.string().optional().nullable(),
  confidence: z.number().min(0).max(1).optional().default(1.0),
  risk_factors: z.array(z.string()).optional()
});

// Priority categories returned by POST /priority/score
const AI_PRIORITY_CATEGORIES = ['Red', 'Orange', 'Yellow', 'Green', 'Black'];

const aiScoredItemSchema = z.object({
  item_id: z.string(),
  product_name: z.string(),
  product_found: z.boolean(),
  rank: z.number().int(),
  score: z.number().min(0).max(100).nullable().optional(),
  priority_category: z.enum(['Red', 'Orange', 'Yellow', 'Green', 'Black']),
  estimated_remaining_days: z.number().int().nullable().optional(),
  reference_shelf_life_days: z.number().int().nullable().optional(),
  urgency_ratio: z.number().nullable().optional(),
  warnings: z.array(z.string()).default([]),
  explanation: z.string().optional(),
  shelf_life_reliability: z.string().nullable().optional(),
  unavailability_reason: z.string().nullable().optional()
});

const aiPriorityScoreResponseSchema = z.object({
  as_of_date: z.string().or(z.any()),
  total_items: z.number().int(),
  scored_items: z.array(aiScoredItemSchema)
});

const aiRecipeRecommendationResponseSchema = z.object({
  as_of_date: z.string().or(z.any()).optional(),
  total_recipes_evaluated: z.number().int().optional(),
  total_recommendations: z.number().int().optional(),
  recommendations: z.array(z.object({
    recipe_id: z.string(),
    name: z.string().min(1),
    rank: z.number().int().optional(),
    score: z.number().optional(),
    score_breakdown: z.object({
      ingredient_availability: z.number().optional(),
      near_expiry_utilization: z.number().optional(),
      use_first_utilization: z.number().optional(),
      missing_ingredient_component: z.number().optional()
    }).optional(),
    preparation_status: z.string().optional(),
    matched_ingredients: z.array(z.object({
      ingredient_name: z.string(),
      product_id: z.string().nullable().optional(),
      required_quantity: z.number(),
      required_unit: z.string(),
      available_quantity: z.number().nullable().optional(),
      available_unit: z.string().nullable().optional(),
      missing_quantity: z.number().nullable().optional(),
      status: z.string(),
      optional: z.boolean(),
      near_expiry: z.boolean().optional(),
      priority_category: z.string().nullable().optional(),
      matched_inventory_ids: z.array(z.string()).optional().default([])
    })).optional().default([]),
    use_first_ingredients: z.array(z.string()).optional().default([]),
    near_expiry_ingredients: z.array(z.string()).optional().default([]),
    missing_ingredients: z.array(z.string()).optional().default([]),
    insufficient_ingredients: z.array(z.string()).optional().default([]),
    unavailable_ingredients: z.array(z.string()).optional().default([]),
    optional_missing_ingredients: z.array(z.string()).optional().default([]),
    reasons: z.array(z.string()).optional().default([]),
    preparation_time_minutes: z.number().int().optional().default(20),
    servings: z.number().int().optional().default(2),
    instructions: z.array(z.string()).optional().default([]),
    simulated: z.boolean().optional()
  }))
});

// Backward compatibility schema for raw recipes array or object
const aiRecipeRescueResponseSchema = z.union([
  aiRecipeRecommendationResponseSchema,
  z.object({
    recipes: z.array(z.object({
      id: z.string().optional(),
      recipe_id: z.string().optional(),
      title: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional().nullable(),
      prep_time_minutes: z.number().optional().nullable(),
      preparation_time_minutes: z.number().optional().nullable(),
      cook_time_minutes: z.number().optional().nullable(),
      servings: z.number().optional().nullable(),
      ingredients: z.array(z.union([z.string(), z.object({ name: z.string(), quantity: z.any().optional().nullable() })])).optional(),
      instructions: z.array(z.string()).optional(),
      rescued_ingredients: z.array(z.string()).default([]),
      waste_reduction_score: z.number().optional().nullable()
    }))
  })
]);

const aiAssistantChatResponseSchema = z.object({
  reply: z.string().min(1),
  suggested_actions: z.array(z.string()).optional(),
  timestamp: z.string().optional()
});

export class AIClientService {
  constructor(baseUrl = env.AI_SERVICE_URL, timeoutMs = env.AI_REQUEST_TIMEOUT_MS) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  /**
   * Helper to execute HTTP POST to AI service with timeouts, bounded retries, and error mapping.
   *
   * @param {string} endpoint
   * @param {object} payload
   * @param {object} [options={}]
   * @param {number} [options.maxRetries]
   * @returns {Promise<any>}
   */
  async _post(endpoint, payload, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const maxRetries = options.maxRetries ?? (env.NODE_ENV === 'test' ? 0 : 2);
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.min(100 * Math.pow(2, attempt) + Math.random() * 50, 1000);
        logger.debug({ endpoint, attempt, backoffMs }, 'Retrying transient AI service failure');
        await new Promise((res) => setTimeout(res, backoffMs));
      }

      try {
        logger.debug({ url, endpoint, attempt }, 'Dispatching HTTP request to AI service');

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs)
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          logger.warn({ status: response.status, endpoint, attempt, errorText }, 'AI service returned non-2xx status');

          // Do not retry 4xx client errors
          if (response.status >= 400 && response.status < 500) {
            throw new AppError(
              `AI service returned status ${response.status}`,
              response.status,
              'AI_CLIENT_ERROR',
              { status: response.status, body: errorText }
            );
          }

          throw new AppError(
            `AI service returned status ${response.status}`,
            response.status >= 500 ? 502 : response.status,
            'AI_SERVICE_ERROR',
            { status: response.status, body: errorText }
          );
        }

        return await response.json();
      } catch (err) {
        lastError = err;

        // Do not retry 4xx errors
        if (err instanceof AppError && err.code === 'AI_CLIENT_ERROR') {
          throw err;
        }

        if (attempt === maxRetries) {
          break;
        }
      }
    }

    if (lastError instanceof AppError) throw lastError;

    if (lastError && (lastError.name === 'TimeoutError' || lastError.name === 'AbortError')) {
      logger.error({ endpoint, timeoutMs: this.timeoutMs }, 'AI service request timed out');
      throw new AppError(
        `AI service request timed out after ${this.timeoutMs}ms`,
        504,
        'AI_SERVICE_TIMEOUT'
      );
    }

    logger.error({ endpoint, error: lastError?.message }, 'Failed to communicate with AI service');
    throw new AppError(
      'AI service is currently unavailable or unreachable',
      502,
      'AI_SERVICE_UNAVAILABLE',
      { originalError: lastError?.message }
    );
  }

  /**
   * Request receipt parsing from AI service.
   *
   * @param {object} params
   * @param {string} params.receipt_id
   * @param {string} params.image_url
   * @param {string} params.storage_path
   * @returns {Promise<{ items: object[], merchant_name?: string, purchase_date?: string, total_amount?: number }>}
   */
  async parseReceipt(params) {
    const rawData = await this._post('/receipt/parse', params);

    const validation = aiReceiptResponseSchema.safeParse(rawData);
    if (!validation.success) {
      logger.error({ errors: validation.error.issues, rawData }, 'Invalid response schema from AI receipt parser');
      throw new AppError(
        'Invalid response format received from AI receipt parsing service',
        502,
        'AI_MALFORMED_RESPONSE',
        validation.error.issues
      );
    }

    return validation.data;
  }

  /**
   * Request product name normalization and classification from AI service.
   *
   * @param {string} rawName
   * @param {string|null} [categoryHint]
   * @returns {Promise<{ normalized_name: string, category?: string, unit?: string, storage_location?: string, confidence: number }>}
   */
  async normalizeProduct(rawName, categoryHint = null) {
    const rawData = await this._post('/normalize', {
      raw_name: rawName,
      category_hint: categoryHint
    });

    const validation = aiNormalizeResponseSchema.safeParse(rawData);
    if (!validation.success) {
      logger.warn({ rawName, errors: validation.error.issues }, 'Failed to parse AI normalization response');
      throw new AppError(
        'Invalid response format received from AI normalization service',
        502,
        'AI_MALFORMED_RESPONSE',
        validation.error.issues
      );
    }

    return validation.data;
  }

  /**
   * Request camera freshness analysis from AI service.
   *
   * @param {object} params
   * @param {string} params.image_url
   * @param {string} params.item_name
   * @param {string} [params.category]
   * @returns {Promise<{ freshness_score: number, status?: string, confidence: number, notes?: string }>}
   */
  async analyzeFreshness(params) {
    const rawData = await this._post('/freshness/analyze', params);

    const validation = aiFreshnessResponseSchema.safeParse(rawData);
    if (!validation.success) {
      logger.error({ errors: validation.error.issues, rawData }, 'Invalid response schema from AI freshness analysis');
      throw new AppError(
        'Invalid response format received from AI freshness service',
        502,
        'AI_MALFORMED_RESPONSE',
        validation.error.issues
      );
    }

    return validation.data;
  }

  /**
   * Request shelf-life estimate for an inventory item.
   *
   * @param {object} itemData
   * @returns {Promise<{ adj_days_left: number, predicted_spoilage_date?: string, confidence: number, risk_factors?: string[] }>}
   */
  async estimateShelfLife(itemData) {
    const rawData = await this._post('/shelf-life/estimate', itemData);

    const validation = aiShelfLifeResponseSchema.safeParse(rawData);
    if (!validation.success) {
      logger.error({ errors: validation.error.issues, rawData }, 'Invalid response schema from AI shelf life service');
      throw new AppError(
        'Invalid response format received from AI shelf-life service',
        502,
        'AI_MALFORMED_RESPONSE',
        validation.error.issues
      );
    }

    return validation.data;
  }

  /**
   * Request Use-First priority scoring for multiple inventory items.
   * Calls the actual AI endpoint: POST /priority/score
   *
   * @param {object[]} items - Array of GroceryItem-shaped objects
   * @returns {Promise<{ as_of_date: string, total_items: number, scored_items: Array<ScoredItem> }>}
   */
  async scoreUseFirst(items) {
    const rawData = await this._post('/priority/score', { items });

    const validation = aiPriorityScoreResponseSchema.safeParse(rawData);
    if (!validation.success) {
      logger.error({ errors: validation.error.issues, rawData }, 'Invalid response schema from AI priority scoring service');
      throw new AppError(
        'Invalid response format received from AI priority/score service',
        502,
        'AI_MALFORMED_RESPONSE',
        validation.error.issues
      );
    }

    return validation.data;
  }

  /**
   * Request recipe recommendations based on household inventory.
   * Calls the actual AI endpoint: POST /recipes/recommend
   *
   * @param {object|object[]} params - Either an object with { inventory, priority_data, limit, as_of_date } or an array of inventory items
   * @param {string[]} [dietaryPreferences=[]] - Optional dietary preferences
   * @returns {Promise<object>}
   */
  async rescueRecipes(params, dietaryPreferences = []) {
    let payload;
    if (params && Array.isArray(params)) {
      payload = {
        inventory: params,
        limit: 10
      };
    } else if (params && typeof params === 'object' && Array.isArray(params.inventory)) {
      payload = {
        inventory: params.inventory,
        priority_data: params.priority_data || null,
        limit: params.limit || 10,
        as_of_date: params.as_of_date || null
      };
    } else {
      payload = {
        inventory: [],
        limit: 10
      };
    }

    const rawData = await this._post('/recipes/recommend', payload);

    const validation = aiRecipeRescueResponseSchema.safeParse(rawData);
    if (!validation.success) {
      logger.error({ errors: validation.error.issues, rawData }, 'Invalid response schema from AI recipe recommendation service');
      throw new AppError(
        'Invalid response format received from AI recipe rescue service',
        502,
        'AI_MALFORMED_RESPONSE',
        validation.error.issues
      );
    }

    return validation.data;
  }

  /**
   * Forward user message and household inventory context to AI assistant.
   *
   * @param {string} message
   * @param {object[]} [inventoryContext=[]]
   * @returns {Promise<{ reply: string, suggested_actions?: string[], timestamp?: string }>}
   */
  async chatAssistant(message, inventoryContext = []) {
    const rawData = await this._post('/assistant/chat', {
      message,
      inventory_context: inventoryContext
    });

    const validation = aiAssistantChatResponseSchema.safeParse(rawData);
    if (!validation.success) {
      logger.error({ errors: validation.error.issues, rawData }, 'Invalid response schema from AI assistant service');
      throw new AppError(
        'Invalid response format received from AI assistant service',
        502,
        'AI_MALFORMED_RESPONSE',
        validation.error.issues
      );
    }

    return validation.data;
  }
}

export const aiClientService = new AIClientService();
export default aiClientService;
