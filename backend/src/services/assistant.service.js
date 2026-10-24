import { inventoryRepository } from '../repositories/inventory.repository.js';
import { aiClientService } from './aiClient.service.js';
import { logger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

export class AssistantService {
  constructor(dependencies = {}) {
    this.inventoryRepo = dependencies.inventoryRepo || inventoryRepository;
    this.aiClient = dependencies.aiClient || aiClientService;
  }

  /**
   * Process a chat message with scoped household inventory context.
   *
   * @param {string} householdId
   * @param {string} userId
   * @param {object} payload
   * @param {string} payload.message
   * @param {boolean} [payload.include_inventory=true]
   * @returns {Promise<{ reply: string, suggested_actions?: string[], timestamp?: string }>}
   */
  async chat(householdId, userId, payload) {
    let inventoryContext = [];

    if (payload.include_inventory !== false) {
      // Fetch strictly active household inventory items
      const items = await this.inventoryRepo.findAllActive(householdId);

      // Only pass necessary fields, never credentials or sensitive user data
      inventoryContext = (items || []).slice(0, 30).map((item) => ({
        name: item.name,
        category: item.category,
        quantity: item.quantity,
        unit: item.unit,
        storage_location: item.storage_location,
        expiry_date: item.expiry_date,
        adj_days_left: item.adj_days_left,
        use_first_score: item.use_first_score,
        freshness_bucket: item.freshness_bucket
      }));
    }

    logger.info(
      { householdId, userId, messageLength: payload.message.length, contextItemsCount: inventoryContext.length },
      'Forwarding assistant chat query to AI service'
    );

    const response = await this.aiClient.chatAssistant(
      payload.message,
      inventoryContext
    );

    return response;
  }
}

export const assistantService = new AssistantService();
export default assistantService;
