import { Router } from 'express';
import { receiptController } from '../controllers/receipt.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireHousehold } from '../middleware/household.js';
import { validate } from '../middleware/validate.js';
import { uploadReceiptFile } from '../middleware/upload.js';
import { uploadLimiter, aiLimiter } from '../middleware/rateLimit.js';
import {
  receiptIdParamSchema,
  lineIdParamSchema,
  confirmReceiptItemSchema
} from '../schemas/receipt.schema.js';

const router = Router();

// Protect all receipt routes with JWT authentication and active household membership
router.use(authenticate, requireHousehold);

// POST /api/v1/receipts/upload - Upload receipt image or PDF
router.post(
  '/upload',
  uploadLimiter,
  uploadReceiptFile,
  receiptController.uploadReceipt
);

// POST /api/v1/receipts/:receiptId/parse - Parse receipt via AI and auto-create inventory
router.post(
  '/:receiptId/parse',
  aiLimiter,
  validate({ params: receiptIdParamSchema }),
  receiptController.parseReceipt
);

// GET /api/v1/receipts/:receiptId/items - Get parsed line items for a receipt
router.get(
  '/:receiptId/items',
  validate({ params: receiptIdParamSchema }),
  receiptController.getReceiptItems
);

// POST /api/v1/receipts/:receiptId/items/:lineId/confirm - Confirm low-confidence item
router.post(
  '/:receiptId/items/:lineId/confirm',
  validate({ params: lineIdParamSchema, body: confirmReceiptItemSchema }),
  receiptController.confirmReceiptItem
);

// POST /api/v1/receipts/:receiptId/items/:lineId/reject - Reject low-confidence item
router.post(
  '/:receiptId/items/:lineId/reject',
  validate({ params: lineIdParamSchema }),
  receiptController.rejectReceiptItem
);

export default router;
