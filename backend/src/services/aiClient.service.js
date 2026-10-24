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

const aiUseFirstResponseSchema = z.object({
  scores: z.array(z.object({
    item_id: z.string(),
    use_first_score: z.number().min(0).max(100),
    freshness_bucket: z.enum(['fresh', 'use_soon', 'critical', 'expired']).default('fresh'),
    recommendation: z.string().optional().nullable()
  }))
});

const aiRecipeRescueResponseSchema = z.object({
  recipes: z.array(z.object({
    id: z.string().optional(),
    title: z.string().min(1),
    description: z.string().optional().nullable(),
    prep_time_minutes: z.number().optional().nullable(),
    cook_time_minutes: z.number().optional().nullable(),
    servings: z.number().optional().nullable(),
    ingredients: z.array(z.union([z.string(), z.object({ name: z.string(), quantity: z.string().optional().nullable() })])),
    instructions: z.array(z.string()),
    rescued_ingredients: z.array(z.string()).default([]),
    waste_reduction_score: z.number().optional().nullable()
  }))
});

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
   * Request Use-First scoring for multiple inventory items.
   *
   * @param {object[]} items
   * @returns {Promise<{ scores: Array<{ item_id: string, use_first_score: number, freshness_bucket: string, recommendation?: string }> }>}
   */
  async scoreUseFirst(items) {
    const rawData = await this._post('/use-first/score', { items });

    const validation = aiUseFirstResponseSchema.safeParse(rawData);
    if (!validation.success) {
      logger.error({ errors: validation.error.issues, rawData }, 'Invalid response schema from AI use-first scoring service');
      throw new AppError(
        'Invalid response format received from AI Use-First service',
        502,
        'AI_MALFORMED_RESPONSE',
        validation.error.issues
      );
    }

    return validation.data;
  }

  /**
   * Request recipe rescue suggestions based on at-risk ingredients.
   *
   * @param {object[]} ingredients
   * @param {string[]} [dietaryPreferences=[]]
   * @returns {Promise<{ recipes: object[] }>}
   */
  async rescueRecipes(ingredients, dietaryPreferences = []) {
    const rawData = await this._post('/recipes/rescue', {
      ingredients,
      dietary_preferences: dietaryPreferences
    });

    const validation = aiRecipeRescueResponseSchema.safeParse(rawData);
    if (!validation.success) {
      logger.error({ errors: validation.error.issues, rawData }, 'Invalid response schema from AI recipe rescue service');
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
