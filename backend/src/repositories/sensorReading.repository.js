import { getDatabaseClient } from '../config/supabase.js';
import { logger } from '../config/logger.js';

export class SensorReadingRepository {
  constructor(getClient = getDatabaseClient) {
    this.getClient = getClient;
  }

  /**
   * Insert a validated sensor reading.
   *
   * @param {object} readingData
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async create(readingData, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('sensor_readings')
      .insert({
        device_id: readingData.device_id,
        household_id: readingData.household_id,
        recorded_at: readingData.recorded_at || new Date().toISOString(),
        received_at: readingData.received_at || new Date().toISOString(),
        temperature_c: readingData.temperature_c ?? null,
        humidity_percent: readingData.humidity_percent ?? null,
        air_quality_raw: readingData.air_quality_raw ?? null,
        air_quality_unit: readingData.air_quality_unit || 'raw',
        air_quality_index: readingData.air_quality_index ?? null,
        source_type: readingData.source_type || 'physical',
        metadata: readingData.metadata || {}
      })
      .select('*')
      .single();

    if (error) {
      logger.error({ deviceId: readingData.device_id, error: error.message }, 'Failed to insert sensor reading');
      throw error;
    }

    return data;
  }

  /**
   * Find readings for a device scoped to a household with time-range and source filtering.
   *
   * @param {string} deviceId
   * @param {string} householdId
   * @param {object} [params]
   * @param {object} [client]
   * @returns {Promise<object[]>}
   */
  async findReadings(deviceId, householdId, params = {}, client = null) {
    const db = client || this.getClient();
    const limit = Math.min(params.limit || 50, 200);

    let query = db
      .from('sensor_readings')
      .select('*')
      .eq('device_id', deviceId)
      .eq('household_id', householdId);

    if (params.from) {
      query = query.gte('recorded_at', params.from);
    }

    if (params.to) {
      query = query.lte('recorded_at', params.to);
    }

    if (params.source_type) {
      query = query.eq('source_type', params.source_type);
    }

    query = query.order('recorded_at', { ascending: false }).limit(limit);

    const { data, error } = await query;

    if (error) {
      logger.error({ deviceId, householdId, error: error.message }, 'Failed to query sensor readings');
      throw error;
    }

    return data || [];
  }

  /**
   * Find the most recent sensor reading for a household.
   *
   * @param {string} householdId
   * @param {object} [client]
   * @returns {Promise<object|null>}
   */
  async getLatestHouseholdReading(householdId, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('sensor_readings')
      .select('*')
      .eq('household_id', householdId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.warn({ householdId, error: error.message }, 'Failed to get latest sensor reading');
      return null;
    }

    return data;
  }
}

export const sensorReadingRepository = new SensorReadingRepository();
export default sensorReadingRepository;
