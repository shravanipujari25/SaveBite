import { getDatabaseClient } from '../config/supabase.js';
import { logger } from '../config/logger.js';

export class FreshnessRepository {
  constructor(getClient = getDatabaseClient) {
    this.getClient = getClient;
  }

  /**
   * Insert a new freshness scan record.
   *
   * @param {object} scanData
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async createScan(scanData, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('freshness_scans')
      .insert({
        id: scanData.id,
        inventory_item_id: scanData.inventory_item_id,
        household_id: scanData.household_id,
        image_path: scanData.image_path || null,
        freshness_score: scanData.freshness_score,
        status_label: scanData.status_label || null,
        confidence: scanData.confidence ?? 1.0,
        notes: scanData.notes || null,
        scanned_by: scanData.scanned_by || null
      })
      .select('*')
      .single();

    if (error) {
      logger.error({ itemId: scanData.inventory_item_id, error: error.message }, 'Failed to insert freshness scan');
      throw error;
    }

    return data;
  }

  /**
   * Find all scans for an inventory item, newest first.
   *
   * @param {string} itemId
   * @param {string} householdId
   * @param {object} [client]
   * @returns {Promise<object[]>}
   */
  async findByItemId(itemId, householdId, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('freshness_scans')
      .select('*')
      .eq('inventory_item_id', itemId)
      .eq('household_id', householdId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error({ itemId, householdId, error: error.message }, 'Failed to find freshness scans');
      throw error;
    }

    return data || [];
  }
}

export const freshnessRepository = new FreshnessRepository();
export default freshnessRepository;
