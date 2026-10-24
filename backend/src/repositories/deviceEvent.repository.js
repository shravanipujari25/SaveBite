import { getDatabaseClient } from '../config/supabase.js';
import { logger } from '../config/logger.js';

export class DeviceEventRepository {
  constructor(getClient = getDatabaseClient) {
    this.getClient = getClient;
  }

  /**
   * Insert an operational device event.
   *
   * @param {object} eventData
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async create(eventData, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('device_events')
      .insert({
        device_id: eventData.device_id,
        household_id: eventData.household_id,
        event_type: eventData.event_type,
        severity: eventData.severity || 'info',
        message: eventData.message,
        occurred_at: eventData.occurred_at || new Date().toISOString(),
        received_at: eventData.received_at || new Date().toISOString(),
        source_type: eventData.source_type || 'physical',
        metadata: eventData.metadata || {}
      })
      .select('*')
      .single();

    if (error) {
      logger.error({ deviceId: eventData.device_id, error: error.message }, 'Failed to insert device event');
      throw error;
    }

    return data;
  }
}

export const deviceEventRepository = new DeviceEventRepository();
export default deviceEventRepository;
