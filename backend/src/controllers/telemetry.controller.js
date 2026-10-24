import { telemetryService } from '../services/telemetry.service.js';

export class TelemetryController {
  constructor(service = telemetryService) {
    this.telemetryService = service;
  }

  /**
   * POST /api/v1/telemetry
   * Ingest sensor readings via HTTP from simulator or devices.
   */
  ingest = async (req, res, next) => {
    try {
      const result = await this.telemetryService.ingest(req.body, req.household.id);
      return res.status(201).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      return next(err);
    }
  };
}

export const telemetryController = new TelemetryController();
export default telemetryController;
