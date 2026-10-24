import { inventoryService } from '../services/inventory.service.js';

export class DashboardController {
  constructor(service = inventoryService) {
    this.inventoryService = service;
  }

  /**
   * GET /api/v1/dashboard
   * Retrieve household-scoped dashboard metrics.
   */
  getDashboard = async (req, res, next) => {
    try {
      const metrics = await this.inventoryService.getDashboard(req.household.id);
      return res.status(200).json({
        status: 'success',
        data: metrics
      });
    } catch (err) {
      return next(err);
    }
  };
}

export const dashboardController = new DashboardController();
export default dashboardController;
