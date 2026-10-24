import { getDatabaseClient } from '../config/supabase.js';
import { logger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

export class NotificationRepository {
  constructor(getClient = getDatabaseClient) {
    this.getClient = getClient;
  }

  /**
   * Create a notification record for a household.
   *
   * @param {object} notifData
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async create(notifData, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('notifications')
      .insert({
        household_id: notifData.household_id,
        device_id: notifData.device_id || null,
        event_id: notifData.event_id || null,
        type: notifData.type || 'threshold_alert',
        title: notifData.title,
        message: notifData.message,
        severity: notifData.severity || 'warning',
        is_read: false
      })
      .select('*')
      .single();

    if (error) {
      logger.error({ householdId: notifData.household_id, error: error.message }, 'Failed to insert notification');
      throw error;
    }

    return data;
  }

  /**
   * List notifications for a household.
   *
   * @param {string} householdId
   * @param {object} [params]
   * @param {object} [client]
   * @returns {Promise<object[]>}
   */
  async findByHousehold(householdId, params = {}, client = null) {
    const db = client || this.getClient();
    const limit = Math.min(params.limit || 20, 100);

    let query = db
      .from('notifications')
      .select('*')
      .eq('household_id', householdId);

    if (params.is_read !== undefined && params.is_read !== null) {
      query = query.eq('is_read', params.is_read);
    }

    if (params.type) {
      query = query.eq('type', params.type);
    }

    query = query.order('created_at', { ascending: false }).limit(limit);

    const { data, error } = await query;

    if (error) {
      logger.error({ householdId, error: error.message }, 'Failed to list notifications');
      throw error;
    }

    return data || [];
  }

  /**
   * Mark a notification as read idempotently.
   *
   * @param {string} id
   * @param {string} householdId
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async markAsRead(id, householdId, client = null) {
    const db = client || this.getClient();

    const { data: existing, error: findError } = await db
      .from('notifications')
      .select('*')
      .eq('id', id)
      .eq('household_id', householdId)
      .maybeSingle();

    if (findError) {
      logger.error({ id, householdId, error: findError.message }, 'Failed to query notification');
      throw findError;
    }

    if (!existing) {
      throw new AppError('Notification not found', 404, 'NOT_FOUND');
    }

    if (existing.is_read) {
      return existing;
    }

    const { data, error } = await db
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('household_id', householdId)
      .select('*')
      .single();

    if (error) {
      logger.error({ id, householdId, error: error.message }, 'Failed to update notification read status');
      throw error;
    }

    return data;
  }

  /**
   * Check for a recent notification on the same device and type within cooldown window.
   *
   * @param {string} householdId
   * @param {string} deviceId
   * @param {string} type
   * @param {number} [withinMinutes=15]
   * @param {object} [client]
   * @returns {Promise<object|null>}
   */
  async findRecentAlert(householdId, deviceId, type, withinMinutes = 15, client = null) {
    const db = client || this.getClient();
    const thresholdTime = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();

    const { data, error } = await db
      .from('notifications')
      .select('id, created_at')
      .eq('household_id', householdId)
      .eq('device_id', deviceId)
      .eq('type', type)
      .gte('created_at', thresholdTime)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.warn({ error: error.message }, 'Failed to check recent alert cooldown');
      return null;
    }

    return data;
  }
}

export const notificationRepository = new NotificationRepository();
export default notificationRepository;
