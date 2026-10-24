import { openFoodFactsService } from '../services/openFoodFacts.service.js';

export class BarcodeController {
  constructor(service = openFoodFactsService) {
    this.service = service;
  }

  /**
   * GET /api/v1/barcodes/:barcode
   */
  lookupBarcode = async (req, res, next) => {
    try {
      const { barcode } = req.params;
      const product = await this.service.lookupBarcode(barcode);

      res.status(200).json({
        status: 'success',
        data: {
          product
        }
      });
    } catch (err) {
      next(err);
    }
  };
}

export const barcodeController = new BarcodeController();
export default barcodeController;
