import { getDatabaseClient } from '../config/supabase.js';
import { logger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

export class DeviceRepository {
  constructor(getClient = getDatabaseClient) {
    this.getClient = getClient;
  }

  /**
   * Register a new device for a household.
   *
   * @param {object} deviceData
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async create(deviceData, client = null) {
    const db = client || this.getClient();
    const normalizedCode = deviceData.device_code.trim();

    // Check for existing device with this device_code
    const existing = await this.findByCode(normalizedCode, db);
    if (existing) {
      if (existing.household_id === deviceData.household_id) {
        // Idempotent: return existing device if already registered to the same household
        return existing;
      }
      throw new AppError('Device code is already registered to another household', 409, 'DEVICE_CODE_EXISTS');
    }

    const { data, error } = await db
      .from('devices')
      .insert({
        household_id: deviceData.household_id,
        name: deviceData.name.trim(),
        device_code: normalizedCode,
        device_type: deviceData.device_type || 'esp32',
        zone: deviceData.zone || 'refrigerator',
        source_type: deviceData.source_type || 'physical',
        status: 'active'
      })
      .select('id, household_id, name, device_code, device_type, zone, source_type, status, last_seen_at, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === '23505' || error.message?.includes('duplicate key')) {
        throw new AppError('Device code is already registered', 409, 'DEVICE_CODE_EXISTS');
      }
      logger.error({ error: error.message }, 'Failed to insert device');
      throw error;
    }

    return data;
  }

  /**
   * Find a device by unique device code.
   *
   * @param {string} deviceCode
   * @param {object} [client]
   * @returns {Promise<object|null>}
   */
  async findByCode(deviceCode, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('devices')
      .select('id, household_id, name, device_code, device_type, zone, source_type, status, last_seen_at, created_at, updated_at')
      .eq('device_code', deviceCode.trim())
      .maybeSingle();

    if (error) {
      logger.error({ deviceCode, error: error.message }, 'Failed to query device by code');
      throw error;
    }

    return data;
  }

  /**
   * Find a device by ID, optionally verifying household ownership.
   *
   * @param {string} id
   * @param {string} [householdId]
   * @param {object} [client]
   * @returns {Promise<object|null>}
   */
  async findById(id, householdId = null, client = null) {
    const db = client || this.getClient();

    let query = db
      .from('devices')
      .select('id, household_id, name, device_code, device_type, zone, source_type, status, last_seen_at, created_at, updated_at')
      .eq('id', id);

    if (householdId) {
      query = query.eq('household_id', householdId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      logger.error({ id, householdId, error: error.message }, 'Failed to query device by id');
      throw error;
    }

    return data;
  }

  /**
   * List devices belonging to a household with optional filters.
   *
   * @param {string} householdId
   * @param {object} [filters]
   * @param {object} [client]
   * @returns {Promise<object[]>}
   */
  async findByHousehold(householdId, filters = {}, client = null) {
    const db = client || this.getClient();

    let query = db
      .from('devices')
      .select('id, household_id, name, device_code, device_type, zone, source_type, status, last_seen_at, created_at, updated_at')
      .eq('household_id', householdId);

    if (filters.zone) {
      query = query.eq('zone', filters.zone);
    }

    if (filters.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }

    if (filters.source_type) {
      query = query.eq('source_type', filters.source_type);
    }

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      logger.error({ householdId, error: error.message }, 'Failed to list household devices');
      throw error;
    }

    return data || [];
  }

  /**
   * Update the last_seen_at timestamp for a device.
   *
   * @param {string} id
   * @param {string} timestamp
   * @param {object} [client]
   * @returns {Promise<void>}
   */
  async updateLastSeen(id, timestamp, client = null) {
    const db = client || this.getClient();

    const { error } = await db
      .from('devices')
      .update({
        last_seen_at: timestamp,
        status: 'active'
      })
      .eq('id', id);

    if (error) {
      logger.warn({ id, error: error.message }, 'Failed to update device last_seen_at');
    }
  }
}

export const deviceRepository = new DeviceRepository();
export default deviceRepository;
