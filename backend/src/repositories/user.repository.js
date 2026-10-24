import { getDatabaseClient } from '../config/supabase.js';
import { logger } from '../config/logger.js';

export class UserRepository {
  constructor(getClient = getDatabaseClient) {
    this.getClient = getClient;
  }

  /**
   * Find a user by normalized email address.
   *
   * @param {string} email
   * @param {object} [client] Optional client override for testing
   * @returns {Promise<object|null>}
   */
  async findByEmail(email, client = null) {
    const db = client || this.getClient();
    const normalizedEmail = email.trim().toLowerCase();

    const { data, error } = await db
      .from('users')
      .select('id, name, email, password_hash, role, token_version, created_at, updated_at')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (error) {
      logger.error({ error: error.message }, 'Failed to query user by email');
      throw error;
    }

    return data;
  }

  /**
   * Find a user by primary key UUID.
   *
   * @param {string} id
   * @param {object} [client] Optional client override
   * @returns {Promise<object|null>}
   */
  async findById(id, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('users')
      .select('id, name, email, password_hash, role, token_version, avatar_url, preferences, created_at, updated_at')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      logger.error({ id, error: error.message }, 'Failed to query user by id');
      throw error;
    }

    return data;
  }

  /**
   * Create a new application user.
   *
   * @param {object} userData
   * @param {string} userData.name
   * @param {string} userData.email
   * @param {string} userData.password_hash
   * @param {string} [userData.role='user']
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async create({ name, email, password_hash, role = 'user' }, client = null) {
    const db = client || this.getClient();
    const normalizedEmail = email.trim().toLowerCase();

    const { data, error } = await db
      .from('users')
      .insert({
        name: name.trim(),
        email: normalizedEmail,
        password_hash,
        role: role === 'admin' ? 'admin' : 'user', // Default to 'user' for safety
        token_version: 1
      })
      .select('id, name, email, role, token_version, created_at, updated_at')
      .single();

    if (error) {
      logger.error({ error: error.message }, 'Failed to insert user');
      throw error;
    }

    return data;
  }

  /**
   * Increment user token_version to immediately revoke all active JWT tokens.
   *
   * @param {string} id
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async incrementTokenVersion(id, client = null) {
    const db = client || this.getClient();

    // First retrieve current version
    const existing = await this.findById(id, db);
    if (!existing) {
      throw new Error('User not found for token revocation');
    }

    const nextVersion = (existing.token_version || 1) + 1;

    const { data, error } = await db
      .from('users')
      .update({
        token_version: nextVersion,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('id, name, email, role, token_version, updated_at')
      .single();

    if (error) {
      logger.error({ id, error: error.message }, 'Failed to increment user token version');
      throw error;
    }

    return data;
  }

  /**
   * Update user role (restricted administrative operation).
   *
   * @param {string} id
   * @param {string} role
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async updateRole(id, role, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('users')
      .update({
        role,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('id, name, email, role, token_version, updated_at')
      .single();

    if (error) {
      logger.error({ id, role, error: error.message }, 'Failed to update user role');
      throw error;
    }

    return data;
  }

  /**
   * Update profile fields for a user.
   *
   * @param {string} id
   * @param {object} updates - Safe profile updates (e.g. name, avatar_url, preferences)
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async updateProfile(id, { name, avatar_url, preferences }, client = null) {
    const db = client || this.getClient();

    const updatePayload = {
      updated_at: new Date().toISOString()
    };
    if (name !== undefined) updatePayload.name = name.trim();
    if (avatar_url !== undefined) updatePayload.avatar_url = avatar_url;
    if (preferences !== undefined) updatePayload.preferences = preferences;

    const { data, error } = await db
      .from('users')
      .update(updatePayload)
      .eq('id', id)
      .select('id, name, email, role, avatar_url, preferences, created_at, updated_at')
      .single();

    if (error) {
      logger.error({ id, error: error.message }, 'Failed to update user profile');
      throw error;
    }

    return data;
  }
}

export const userRepository = new UserRepository();
export default userRepository;
