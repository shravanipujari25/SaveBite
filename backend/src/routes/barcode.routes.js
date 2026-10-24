import { Router } from 'express';
import { barcodeController } from '../controllers/barcode.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { barcodeParamSchema } from '../schemas/barcode.schema.js';

const router = Router();

// Protect barcode lookup with authentication
router.use(authenticate);

// GET /api/v1/barcodes/:barcode - Look up product details via Open Food Facts
router.get(
  '/:barcode',
  validate({ params: barcodeParamSchema }),
  barcodeController.lookupBarcode
);

export default router;
