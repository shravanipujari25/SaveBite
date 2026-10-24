import { getDatabaseClient } from '../config/supabase.js';
import { logger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

export class HouseholdRepository {
  constructor(getClient = getDatabaseClient) {
    this.getClient = getClient;
  }

  /**
   * Find active household membership for a given user.
   *
   * @param {string} userId - UUID of the user
   * @param {object} [client] - Optional database client
   * @returns {Promise<{ household_id: string, role: string, status: string, household: { id: string, name: string } } | null>}
   */
  async findActiveMembershipByUserId(userId, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('household_members')
      .select('id, household_id, user_id, role, status, households(id, name)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      logger.error({ userId, error: error.message }, 'Failed to query active household membership');
      throw error;
    }

    if (!data) {
      return null;
    }

    return {
      id: data.id,
      household_id: data.household_id,
      user_id: data.user_id,
      role: data.role,
      status: data.status,
      household: Array.isArray(data.households) ? data.households[0] : (data.households || { id: data.household_id, name: 'My Household' })
    };
  }

  /**
   * Create a new household.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async createHousehold({ name }, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('households')
      .insert({
        name: name.trim()
      })
      .select('id, name, created_at, updated_at')
      .single();

    if (error) {
      logger.error({ name, error: error.message }, 'Failed to create household');
      throw error;
    }

    return data;
  }

  /**
   * Add a user to a household with a specific role.
   *
   * @param {object} params
   * @param {string} params.household_id
   * @param {string} params.user_id
   * @param {string} [params.role='member']
   * @param {string} [params.status='active']
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async addMember({ household_id, user_id, role = 'member', status = 'active' }, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('household_members')
      .insert({
        household_id,
        user_id,
        role: role === 'owner' ? 'owner' : 'member',
        status: status === 'active' ? 'active' : status
      })
      .select('id, household_id, user_id, role, status, created_at, updated_at')
      .single();

    if (error) {
      logger.error({ household_id, user_id, error: error.message }, 'Failed to add household member');
      throw error;
    }

    return data;
  }

  /**
   * Atomically create a user, default household, and owner membership.
   * Uses the stored procedure `create_user_with_household` if available,
   * with fallback to sequential creation and compensation rollback.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {string} params.email
   * @param {string} params.password_hash
   * @param {string} [params.role='user']
   * @param {string} [params.household_name]
   * @param {object} [client]
   * @returns {Promise<{ user: object, household: object }>}
   */
  async createWithHousehold(
    { name, email, password_hash, role = 'user', household_name = null },
    client = null
  ) {
    const db = client || this.getClient();
    const normalizedEmail = email.trim().toLowerCase();
    const defaultHouseholdName = household_name || `${name.trim()}'s Household`;

    // Try transactional RPC stored function first
    if (typeof db.rpc === 'function') {
      try {
        const { data, error } = await db.rpc('create_user_with_household', {
          p_name: name.trim(),
          p_email: normalizedEmail,
          p_password_hash,
          p_role: role,
          p_household_name: defaultHouseholdName
        });

        if (!error && data) {
          return {
            user: data.user,
            household: data.household
          };
        }

        if (error && (error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('already registered'))) {
          throw new AppError('Email is already registered', 409, 'EMAIL_EXISTS');
        }
      } catch (err) {
        if (err.statusCode === 409 || err.code === 'EMAIL_EXISTS') {
          throw err;
        }
        // If RPC function is not found on database, log debug and proceed to sequential fallback
        logger.debug({ err: err.message }, 'RPC create_user_with_household not available, using sequential fallback');
      }
    }

    // Sequential creation with compensatory cleanup on failure
    let createdUser = null;
    let createdHousehold = null;

    try {
      // 1. Insert user
      const { data: user, error: userError } = await db
        .from('users')
        .insert({
          name: name.trim(),
          email: normalizedEmail,
          password_hash,
          role: role === 'admin' ? 'admin' : 'user',
          token_version: 1
        })
        .select('id, name, email, role, token_version, created_at, updated_at')
        .single();

      if (userError) {
        if (userError.code === '23505' || userError.message?.includes('duplicate key') || userError.message?.includes('unique constraint')) {
          throw new AppError('Email is already registered', 409, 'EMAIL_EXISTS');
        }
        throw userError;
      }

      createdUser = user;

      // 2. Insert household
      const { data: household, error: hhError } = await db
        .from('households')
        .insert({
          name: defaultHouseholdName
        })
        .select('id, name, created_at, updated_at')
        .single();

      if (hhError) {
        throw hhError;
      }

      createdHousehold = household;

      // 3. Insert membership
      const { data: member, error: memberError } = await db
        .from('household_members')
        .insert({
          household_id: household.id,
          user_id: user.id,
          role: 'owner',
          status: 'active'
        })
        .select('id, household_id, user_id, role, status, created_at')
        .single();

      if (memberError) {
        throw memberError;
      }

      return {
        user: createdUser,
        household: {
          id: createdHousehold.id,
          name: createdHousehold.name,
          role: 'owner',
          status: 'active',
          created_at: createdHousehold.created_at
        }
      };
    } catch (err) {
      // Compensatory cleanup: if user was created but subsequent operations failed,
      // delete the orphaned records to maintain strict atomicity
      if (createdHousehold?.id) {
        try {
          await db.from('households').delete().eq('id', createdHousehold.id);
        } catch (cleanupErr) {
          logger.error({ cleanupErr }, 'Failed to cleanup orphaned household');
        }
      }
      if (createdUser?.id) {
        try {
          await db.from('users').delete().eq('id', createdUser.id);
        } catch (cleanupErr) {
          logger.error({ cleanupErr }, 'Failed to cleanup orphaned user');
        }
      }
      throw err;
    }
  }

  /**
   * Find household by ID.
   *
   * @param {string} householdId
   * @param {object} [client]
   * @returns {Promise<object|null>}
   */
  async findHouseholdById(householdId, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('households')
      .select('id, name, settings, created_at, updated_at')
      .eq('id', householdId)
      .maybeSingle();

    if (error) {
      logger.error({ householdId, error: error.message }, 'Failed to query household by id');
      throw error;
    }

    return data;
  }

  /**
   * Update household settings.
   *
   * @param {string} householdId
   * @param {object} settings
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async updateSettings(householdId, settings, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('households')
      .update({
        settings,
        updated_at: new Date().toISOString()
      })
      .eq('id', householdId)
      .select('id, name, settings, created_at, updated_at')
      .single();

    if (error) {
      logger.error({ householdId, error: error.message }, 'Failed to update household settings');
      throw error;
    }

    return data;
  }

  /**
   * Find all members of a household.
   *
   * @param {string} householdId
   * @param {object} [client]
   * @returns {Promise<object[]>}
   */
  async findMembers(householdId, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('household_members')
      .select('id, household_id, user_id, role, status, created_at, users(id, name, email)')
      .eq('household_id', householdId);

    if (error) {
      logger.error({ householdId, error: error.message }, 'Failed to query household members');
      throw error;
    }

    return (data || []).map((m) => ({
      id: m.id,
      household_id: m.household_id,
      user_id: m.user_id,
      role: m.role,
      status: m.status,
      created_at: m.created_at,
      user: Array.isArray(m.users) ? m.users[0] : m.users
    }));
  }

  /**
   * Find all unique household IDs.
   *
   * @param {object} [client]
   * @returns {Promise<string[]>}
   */
  async findAllHouseholdIds(client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('households')
      .select('id');

    if (error) {
      logger.error({ error: error.message }, 'Failed to query all household IDs');
      throw error;
    }

    return (data || []).map((h) => h.id);
  }
}

export const householdRepository = new HouseholdRepository();
export default householdRepository;
