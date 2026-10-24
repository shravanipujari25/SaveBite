import { userRepository } from '../repositories/user.repository.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../config/logger.js';

export class ProfileService {
  constructor(repo = userRepository) {
    this.userRepo = repo;
  }

  /**
   * Get authenticated user's profile, sanitizing any sensitive credentials.
   *
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async getProfile(userId) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404, 'NOT_FOUND');
    }

    // Explicitly exclude password_hash and token_version
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar_url: user.avatar_url || '',
      preferences: user.preferences || {},
      created_at: user.created_at,
      updated_at: user.updated_at
    };
  }

  /**
   * Update permitted profile fields.
   *
   * @param {string} userId
   * @param {object} updates
   * @returns {Promise<object>}
   */
  async updateProfile(userId, updates) {
    // Only allow updating permitted non-security fields
    const safeUpdates = {};
    if (updates.name !== undefined) safeUpdates.name = updates.name;
    if (updates.avatar_url !== undefined) safeUpdates.avatar_url = updates.avatar_url;
    if (updates.preferences !== undefined) safeUpdates.preferences = updates.preferences;

    const updatedUser = await this.userRepo.updateProfile(userId, safeUpdates);

    logger.info({ userId }, 'User profile updated successfully');

    return {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      avatar_url: updatedUser.avatar_url || '',
      preferences: updatedUser.preferences || {},
      created_at: updatedUser.created_at,
      updated_at: updatedUser.updated_at
    };
  }
}

export const profileService = new ProfileService();
export default profileService;
