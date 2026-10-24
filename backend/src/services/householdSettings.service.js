import { householdRepository } from '../repositories/household.repository.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../config/logger.js';

export class HouseholdSettingsService {
  constructor(repo = householdRepository) {
    this.householdRepo = repo;
  }

  /**
   * Get household settings and members.
   *
   * @param {string} householdId
   * @returns {Promise<object>}
   */
  async getSettings(householdId) {
    const household = await this.householdRepo.findHouseholdById(householdId);
    if (!household) {
      throw new AppError('Household not found', 404, 'NOT_FOUND');
    }

    const members = await this.householdRepo.findMembers(householdId);

    return {
      id: household.id,
      name: household.name,
      settings: household.settings || {},
      members: members.map((m) => ({
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        status: m.status,
        name: m.user?.name || null,
        email: m.user?.email || null,
        joined_at: m.created_at
      })),
      created_at: household.created_at,
      updated_at: household.updated_at
    };
  }

  /**
   * Update household settings (restricted to owner or admin).
   *
   * @param {string} householdId
   * @param {string} userRole
   * @param {object} updates
   * @returns {Promise<object>}
   */
  async updateSettings(householdId, userRole, updates) {
    if (userRole !== 'owner' && userRole !== 'admin') {
      logger.warn({ householdId, userRole }, 'Unauthorized attempt to update household settings');
      throw new AppError(
        'Only household owners or administrators are permitted to update household settings',
        403,
        'FORBIDDEN'
      );
    }

    const existing = await this.householdRepo.findHouseholdById(householdId);
    if (!existing) {
      throw new AppError('Household not found', 404, 'NOT_FOUND');
    }

    const mergedSettings = {
      ...(existing.settings || {}),
      ...(updates.settings || {})
    };

    const updated = await this.householdRepo.updateSettings(householdId, mergedSettings);

    logger.info({ householdId, userRole }, 'Household settings updated successfully');

    return {
      id: updated.id,
      name: updated.name,
      settings: updated.settings,
      updated_at: updated.updated_at
    };
  }
}

export const householdSettingsService = new HouseholdSettingsService();
export default householdSettingsService;
