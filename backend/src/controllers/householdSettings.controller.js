import { householdSettingsService } from '../services/householdSettings.service.js';

export class HouseholdSettingsController {
  constructor(service = householdSettingsService) {
    this.service = service;
  }

  /**
   * GET /api/v1/household/settings
   * Retrieve settings and members for the authenticated household.
   */
  getSettings = async (req, res, next) => {
    try {
      const data = await this.service.getSettings(req.household.id);
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * PATCH /api/v1/household/settings
   * Update household settings (restricted to owner or admin).
   */
  updateSettings = async (req, res, next) => {
    try {
      const data = await this.service.updateSettings(
        req.household.id,
        req.household.role,
        req.body
      );
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (err) {
      return next(err);
    }
  };
}

export const householdSettingsController = new HouseholdSettingsController();
export default householdSettingsController;
