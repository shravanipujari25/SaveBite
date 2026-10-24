import { getDatabaseClient } from '../config/supabase.js';
import { logger } from '../config/logger.js';

export class AnalyticsRepository {
  constructor(getClient = getDatabaseClient) {
    this.getClient = getClient;
  }

  /**
   * Fetch waste records for a date range.
   *
   * @param {string} householdId
   * @param {string} startDate - ISO string
   * @param {string} endDate - ISO string
   * @param {object} [client]
   * @returns {Promise<object[]>}
   */
  async getWasteRecords(householdId, startDate, endDate, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('waste_log')
      .select('*')
      .eq('household_id', householdId)
      .gte('wasted_at', startDate)
      .lte('wasted_at', endDate)
      .order('wasted_at', { ascending: true });

    if (error) {
      logger.error({ householdId, startDate, endDate, error: error.message }, 'Failed to query waste records');
      throw error;
    }

    return data || [];
  }

  /**
   * Fetch avoided-waste records for a date range.
   *
   * @param {string} householdId
   * @param {string} startDate - ISO string
   * @param {string} endDate - ISO string
   * @param {object} [client]
   * @returns {Promise<object[]>}
   */
  async getAvoidedWasteRecords(householdId, startDate, endDate, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('avoided_waste_logs')
      .select('*')
      .eq('household_id', householdId)
      .gte('consumed_at', startDate)
      .lte('consumed_at', endDate)
      .order('consumed_at', { ascending: true });

    if (error) {
      logger.error({ householdId, startDate, endDate, error: error.message }, 'Failed to query avoided waste records');
      throw error;
    }

    return data || [];
  }

  /**
   * Record an avoided waste consumption event.
   *
   * @param {object} logData
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async logAvoidedWaste(logData, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('avoided_waste_logs')
      .insert({
        household_id: logData.household_id,
        inventory_item_id: logData.inventory_item_id || null,
        item_name: logData.item_name,
        quantity: logData.quantity,
        unit: logData.unit,
        estimated_savings: logData.estimated_savings ?? 0.00,
        source: logData.source || 'recipe_rescue',
        recipe_name: logData.recipe_name || null,
        recorded_by: logData.recorded_by || null,
        consumed_at: logData.consumed_at || new Date().toISOString()
      })
      .select('*')
      .single();

    if (error) {
      logger.error({ householdId: logData.household_id, error: error.message }, 'Failed to log avoided waste');
      throw error;
    }

    return data;
  }
}

export const analyticsRepository = new AnalyticsRepository();
export default analyticsRepository;
