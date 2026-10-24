import { getDatabaseClient } from '../config/supabase.js';
import { logger } from '../config/logger.js';

export class ReceiptRepository {
  constructor(getClient = getDatabaseClient) {
    this.getClient = getClient;
  }

  /**
   * Insert a new receipt record.
   *
   * @param {object} receiptData
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async createReceipt(receiptData, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('receipts')
      .insert({
        id: receiptData.id,
        household_id: receiptData.household_id,
        uploaded_by: receiptData.uploaded_by || null,
        storage_path: receiptData.storage_path,
        file_name: receiptData.file_name,
        mime_type: receiptData.mime_type,
        file_size_bytes: receiptData.file_size_bytes,
        status: receiptData.status || 'uploaded',
        parse_error: receiptData.parse_error || null
      })
      .select('*')
      .single();

    if (error) {
      logger.error({ householdId: receiptData.household_id, error: error.message }, 'Failed to insert receipt record');
      throw error;
    }

    return data;
  }

  /**
   * Find receipt by ID scoped to household.
   *
   * @param {string} id
   * @param {string} householdId
   * @param {object} [client]
   * @returns {Promise<object|null>}
   */
  async findById(id, householdId, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('receipts')
      .select('*')
      .eq('id', id)
      .eq('household_id', householdId)
      .maybeSingle();

    if (error) {
      logger.error({ id, householdId, error: error.message }, 'Failed to find receipt by ID');
      throw error;
    }

    return data;
  }

  /**
   * Update status and error for a receipt.
   *
   * @param {string} id
   * @param {string} householdId
   * @param {string} status
   * @param {string|null} [parseError]
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async updateStatus(id, householdId, status, parseError = null, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('receipts')
      .update({
        status,
        parse_error: parseError,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('household_id', householdId)
      .select('*')
      .single();

    if (error) {
      logger.error({ id, householdId, status, error: error.message }, 'Failed to update receipt status');
      throw error;
    }

    return data;
  }

  /**
   * Insert batch of parsed receipt line items.
   *
   * @param {object[]} items
   * @param {object} [client]
   * @returns {Promise<object[]>}
   */
  async createReceiptItems(items, client = null) {
    if (!items || items.length === 0) return [];
    const db = client || this.getClient();

    const { data, error } = await db
      .from('receipt_items')
      .insert(items)
      .select('*');

    if (error) {
      logger.error({ count: items.length, error: error.message }, 'Failed to insert receipt items');
      throw error;
    }

    return data || [];
  }

  /**
   * Find all items for a receipt, scoped to household.
   *
   * @param {string} receiptId
   * @param {string} householdId
   * @param {object} [client]
   * @returns {Promise<object[]>}
   */
  async findItemsByReceiptId(receiptId, householdId, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('receipt_items')
      .select('*')
      .eq('receipt_id', receiptId)
      .eq('household_id', householdId)
      .order('created_at', { ascending: true });

    if (error) {
      logger.error({ receiptId, householdId, error: error.message }, 'Failed to find receipt items');
      throw error;
    }

    return data || [];
  }

  /**
   * Find a specific receipt item by ID, scoped to receipt and household.
   *
   * @param {string} lineId
   * @param {string} receiptId
   * @param {string} householdId
   * @param {object} [client]
   * @returns {Promise<object|null>}
   */
  async findItemById(lineId, receiptId, householdId, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('receipt_items')
      .select('*')
      .eq('id', lineId)
      .eq('receipt_id', receiptId)
      .eq('household_id', householdId)
      .maybeSingle();

    if (error) {
      logger.error({ lineId, receiptId, householdId, error: error.message }, 'Failed to find receipt item by ID');
      throw error;
    }

    return data;
  }

  /**
   * Update fields of a receipt item.
   *
   * @param {string} lineId
   * @param {string} householdId
   * @param {object} updates
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async updateReceiptItem(lineId, householdId, updates, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('receipt_items')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', lineId)
      .eq('household_id', householdId)
      .select('*')
      .single();

    if (error) {
      logger.error({ lineId, householdId, error: error.message }, 'Failed to update receipt item');
      throw error;
    }

    return data;
  }
}

export const receiptRepository = new ReceiptRepository();
export default receiptRepository;
