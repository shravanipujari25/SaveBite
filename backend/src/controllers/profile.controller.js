import { profileService } from '../services/profile.service.js';

export class ProfileController {
  constructor(service = profileService) {
    this.service = service;
  }

  /**
   * GET /api/v1/profile
   * Retrieve current user's profile without secrets.
   */
  getProfile = async (req, res, next) => {
    try {
      const user = await this.service.getProfile(req.user.id);
      return res.status(200).json({
        status: 'success',
        data: { user }
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * PATCH /api/v1/profile
   * Update permitted profile fields.
   */
  updateProfile = async (req, res, next) => {
    try {
      const user = await this.service.updateProfile(req.user.id, req.body);
      return res.status(200).json({
        status: 'success',
        data: { user }
      });
    } catch (err) {
      return next(err);
    }
  };
}

export const profileController = new ProfileController();
export default profileController;
