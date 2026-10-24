import { freshnessService } from '../services/freshness.service.js';

export class FreshnessController {
  constructor(service = freshnessService) {
    this.service = service;
  }

  /**
   * POST /api/v1/inventory/:itemId/freshness-scan
   */
  scanFreshness = async (req, res, next) => {
    try {
      const { itemId } = req.params;
      const householdId = req.household.id;
      const userId = req.user.id;
      const file = req.file;

      const result = await this.service.scanItemFreshness(itemId, householdId, userId, file);

      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      next(err);
    }
  };
}

export const freshnessController = new FreshnessController();
export default freshnessController;
