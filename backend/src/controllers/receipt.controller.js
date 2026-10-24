import { receiptService } from '../services/receipt.service.js';

export class ReceiptController {
  constructor(service = receiptService) {
    this.service = service;
  }

  /**
   * POST /api/v1/receipts/upload
   */
  uploadReceipt = async (req, res, next) => {
    try {
      const householdId = req.household.id;
      const userId = req.user.id;
      const file = req.file;

      const receipt = await this.service.uploadReceipt(householdId, userId, file);

      res.status(201).json({
        status: 'success',
        data: {
          receipt: {
            id: receipt.id,
            household_id: receipt.household_id,
            file_name: receipt.file_name,
            mime_type: receipt.mime_type,
            file_size_bytes: receipt.file_size_bytes,
            status: receipt.status,
            created_at: receipt.created_at
          }
        }
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/receipts/:receiptId/parse
   */
  parseReceipt = async (req, res, next) => {
    try {
      const { receiptId } = req.params;
      const householdId = req.household.id;
      const userId = req.user.id;

      const result = await this.service.parseReceipt(receiptId, householdId, userId);

      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/receipts/:receiptId/items
   */
  getReceiptItems = async (req, res, next) => {
    try {
      const { receiptId } = req.params;
      const householdId = req.household.id;

      const items = await this.service.getReceiptItems(receiptId, householdId);

      res.status(200).json({
        status: 'success',
        data: {
          receipt_id: receiptId,
          items
        }
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/receipts/:receiptId/items/:lineId/confirm
   */
  confirmReceiptItem = async (req, res, next) => {
    try {
      const { receiptId, lineId } = req.params;
      const householdId = req.household.id;
      const userId = req.user.id;
      const corrections = req.body || {};

      const result = await this.service.confirmReceiptItem(receiptId, lineId, householdId, userId, corrections);

      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/receipts/:receiptId/items/:lineId/reject
   */
  rejectReceiptItem = async (req, res, next) => {
    try {
      const { receiptId, lineId } = req.params;
      const householdId = req.household.id;

      const result = await this.service.rejectReceiptItem(receiptId, lineId, householdId);

      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      next(err);
    }
  };
}

export const receiptController = new ReceiptController();
export default receiptController;
