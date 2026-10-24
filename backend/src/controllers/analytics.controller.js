import { analyticsService } from '../services/analytics.service.js';

export class AnalyticsController {
  constructor(service = analyticsService) {
    this.service = service;
  }

  /**
   * GET /api/v1/analytics/waste
   * Waste summary by period.
   */
  getWasteAnalytics = async (req, res, next) => {
    try {
      const data = await this.service.getWasteAnalytics(req.household.id, req.query);
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * GET /api/v1/analytics/most-wasted
   * Ranking of most wasted items.
   */
  getMostWasted = async (req, res, next) => {
    try {
      const data = await this.service.getMostWasted(req.household.id, req.query);
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * GET /api/v1/analytics/savings
   * Estimated avoided waste savings.
   */
  getSavingsAnalytics = async (req, res, next) => {
    try {
      const data = await this.service.getSavingsAnalytics(req.household.id, req.query);
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * GET /api/v1/analytics/monthly-comparison
   * Month-over-month percentage & absolute comparison.
   */
  getMonthlyComparison = async (req, res, next) => {
    try {
      const data = await this.service.getMonthlyComparison(
        req.household.id,
        req.query.month
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

export const analyticsController = new AnalyticsController();
export default analyticsController;
