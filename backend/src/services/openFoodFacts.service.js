import env from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

export class OpenFoodFactsService {
  constructor(timeoutMs = env.OPEN_FOOD_FACTS_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
    this.cache = new Map(); // Simple in-memory cache for barcode lookups
    this.cacheTtlMs = 60 * 60 * 1000; // 1 hour TTL
  }

  /**
   * Look up a product by barcode in Open Food Facts.
   *
   * @param {string} barcode
   * @returns {Promise<object>}
   */
  async lookupBarcode(barcode) {
    const cleanBarcode = barcode.trim();

    // Check in-memory cache
    const cached = this.cache.get(cleanBarcode);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      logger.debug({ barcode: cleanBarcode }, 'Returning cached Open Food Facts product');
      return cached.data;
    }

    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanBarcode)}.json`;

    logger.debug({ barcode: cleanBarcode }, 'Fetching barcode metadata from Open Food Facts');

    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'SaveBite-Backend/1.0 (https://savebite.com; contact@savebite.com)',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        logger.error({ barcode: cleanBarcode, timeoutMs: this.timeoutMs }, 'Open Food Facts request timed out');
        throw new AppError(
          `Open Food Facts service request timed out after ${this.timeoutMs}ms`,
          504,
          'UPSTREAM_TIMEOUT'
        );
      }

      logger.error({ barcode: cleanBarcode, error: err.message }, 'Failed to connect to Open Food Facts');
      throw new AppError(
        'Unable to connect to Open Food Facts service',
        502,
        'UPSTREAM_SERVICE_ERROR',
        { originalError: err.message }
      );
    }

    if (response.status === 404) {
      throw new AppError(
        `Product with barcode ${cleanBarcode} was not found in Open Food Facts`,
        404,
        'PRODUCT_NOT_FOUND'
      );
    }

    if (response.status === 429) {
      logger.warn({ barcode: cleanBarcode }, 'Open Food Facts rate limit encountered');
      throw new AppError(
        'Open Food Facts rate limit exceeded. Please try again later.',
        502,
        'UPSTREAM_RATE_LIMITED'
      );
    }

    if (!response.ok) {
      logger.error({ barcode: cleanBarcode, status: response.status }, 'Open Food Facts returned error response');
      throw new AppError(
        `Open Food Facts service returned error status ${response.status}`,
        502,
        'UPSTREAM_SERVICE_ERROR'
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      logger.error({ barcode: cleanBarcode, error: err.message }, 'Failed to parse Open Food Facts JSON response');
      throw new AppError(
        'Invalid JSON response returned from Open Food Facts',
        502,
        'UPSTREAM_SERVICE_ERROR'
      );
    }

    // Open Food Facts API v2 returns status: 1 for found, 0 for not found
    if (payload.status === 0 || !payload.product) {
      throw new AppError(
        `Product with barcode ${cleanBarcode} was not found in Open Food Facts`,
        404,
        'PRODUCT_NOT_FOUND'
      );
    }

    const prod = payload.product;

    // Normalize categories
    let categories = [];
    if (prod.categories) {
      categories = prod.categories
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
    } else if (Array.isArray(prod.categories_tags)) {
      categories = prod.categories_tags.map((c) => c.replace(/^[a-z]{2}:/, '').replace(/-/g, ' '));
    }

    const normalized = {
      barcode: cleanBarcode,
      name: prod.product_name || prod.product_name_en || 'Unknown Product',
      brand: prod.brands || null,
      categories,
      ingredients_text: prod.ingredients_text || prod.ingredients_text_en || null,
      quantity: prod.quantity || null,
      image_url: prod.image_front_url || prod.image_url || null,
      verified: true,
      attribution: 'Open Food Facts (ODbL)'
    };

    // Store in cache
    this.cache.set(cleanBarcode, {
      data: normalized,
      timestamp: Date.now()
    });

    return normalized;
  }
}

export const openFoodFactsService = new OpenFoodFactsService();
export default openFoodFactsService;
