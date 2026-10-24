import { getDatabaseClient } from '../config/supabase.js';
import { logger } from '../config/logger.js';

export class ProfileRepository {
  /**
   * Find a profile record by user ID.
   *
   * @param {string} userId - UUID of the user
   * @param {object} [client] - Optional database client
   * @returns {Promise<object|null>}
   */
  async findById(userId, client = null) {
    const db = client || getDatabaseClient();
    const { data, error } = await db
      .from('profiles')
      .select('id, email, full_name, avatar_url, role, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      logger.error({ userId, error: error.message }, 'Failed to fetch user profile from database');
      throw error;
    }

    return data;
  }

  /**
   * Upsert a profile record.
   *
   * @param {object} profileData
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async upsert(profileData, client = null) {
    const db = client || getDatabaseClient();
    const { data, error } = await db
      .from('profiles')
      .upsert(
        {
          id: profileData.id,
          email: profileData.email,
          full_name: profileData.full_name || '',
          avatar_url: profileData.avatar_url || '',
          role: profileData.role || 'user'
        },
        { onConflict: 'id' }
      )
      .select('id, email, full_name, avatar_url, role, created_at, updated_at')
      .single();

    if (error) {
      logger.error({ error: error.message }, 'Failed to upsert user profile');
      throw error;
    }

    return data;
  }

  /**
   * Update profile fields.
   *
   * @param {string} userId
   * @param {object} updates
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async update(userId, updates, client = null) {
    const db = client || getDatabaseClient();
    const { data, error } = await db
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select('id, email, full_name, avatar_url, role, created_at, updated_at')
      .single();

    if (error) {
      logger.error({ userId, error: error.message }, 'Failed to update profile');
      throw error;
    }

    return data;
  }
}

export const profileRepository = new ProfileRepository();
export default profileRepository;
