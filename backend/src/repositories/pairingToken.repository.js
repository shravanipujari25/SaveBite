import { getDatabaseClient } from '../config/supabase.js';
import { logger } from '../config/logger.js';

export class PairingTokenRepository {
  constructor(getClient = getDatabaseClient) {
    this.getClient = getClient;
  }

  /**
   * Insert a new ephemeral device pairing token.
   *
   * @param {object} tokenData
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async createToken(tokenData, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('device_pairing_tokens')
      .insert({
        household_id: tokenData.household_id,
        created_by: tokenData.created_by,
        token: tokenData.token,
        device_type: tokenData.device_type || 'esp32',
        zone: tokenData.zone || 'refrigerator',
        expires_at: tokenData.expires_at,
        is_used: false
      })
      .select('*')
      .single();

    if (error) {
      logger.error({ householdId: tokenData.household_id, error: error.message }, 'Failed to insert pairing token');
      throw error;
    }

    return data;
  }

  /**
   * Find a valid, unexpired, unused pairing token.
   *
   * @param {string} tokenString
   * @param {object} [client]
   * @returns {Promise<object|null>}
   */
  async findValidToken(tokenString, client = null) {
    const db = client || this.getClient();
    const now = new Date().toISOString();

    const { data, error } = await db
      .from('device_pairing_tokens')
      .select('*')
      .eq('token', tokenString.trim())
      .eq('is_used', false)
      .gt('expires_at', now)
      .maybeSingle();

    if (error) {
      logger.error({ token: tokenString, error: error.message }, 'Failed to find pairing token');
      throw error;
    }

    return data;
  }

  /**
   * Mark a pairing token as used and associate it with the registered device ID.
   *
   * @param {string} id
   * @param {string} pairedDeviceId
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async markTokenUsed(id, pairedDeviceId, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('device_pairing_tokens')
      .update({
        is_used: true,
        used_at: new Date().toISOString(),
        paired_device_id: pairedDeviceId
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      logger.error({ id, pairedDeviceId, error: error.message }, 'Failed to mark pairing token used');
      throw error;
    }

    return data;
  }
}

export const pairingTokenRepository = new PairingTokenRepository();
export default pairingTokenRepository;
