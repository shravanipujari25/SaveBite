import crypto from 'node:crypto';
import env from '../config/env.js';
import { logger } from '../config/logger.js';
import { getDatabaseClient } from '../config/supabase.js';
import { AppError } from '../middleware/errorHandler.js';
import { receiptRepository } from '../repositories/receipt.repository.js';
import { inventoryService } from './inventory.service.js';
import { aiClientService } from './aiClient.service.js';

const ALLOWED_CATEGORIES = new Set([
  'produce', 'dairy', 'bakery', 'meat', 'pantry',
  'beverages', 'frozen', 'leftovers', 'snacks', 'other'
]);

const ALLOWED_UNITS = new Set([
  'g', 'kg', 'ml', 'l', 'piece', 'pack', 'oz', 'lb', 'can', 'bottle', 'item', 'serving'
]);

const ALLOWED_STORAGE_LOCATIONS = new Set([
  'refrigerator', 'freezer', 'pantry', 'counter', 'other'
]);

export class ReceiptService {
  constructor(
    receiptRepo = receiptRepository,
    invService = inventoryService,
    aiService = aiClientService,
    getDb = getDatabaseClient
  ) {
    this.receiptRepo = receiptRepo;
    this.invService = invService;
    this.aiService = aiService;
    this.getDb = getDb;
  }

  /**
   * Securely upload receipt file to Supabase Storage and register database record.
   *
   * @param {string} householdId
   * @param {string} userId
   * @param {object} file - Multer file object
   * @returns {Promise<object>}
   */
  async uploadReceipt(householdId, userId, file) {
    const receiptId = crypto.randomUUID();
    const extMap = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'application/pdf': 'pdf'
    };
    const ext = extMap[file.detectedMime] || 'bin';
    const storagePath = `households/${householdId}/receipts/${receiptId}.${ext}`;

    const db = this.getDb();

    logger.info({ receiptId, householdId, storagePath, size: file.size }, 'Uploading receipt to Supabase Storage');

    const { error: uploadError } = await db.storage
      .from(env.SUPABASE_RECEIPTS_BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.detectedMime,
        upsert: false
      });

    if (uploadError) {
      logger.error({ receiptId, error: uploadError.message }, 'Failed to upload receipt to Supabase Storage');
      throw new AppError(
        'Failed to upload receipt image to secure storage',
        500,
        'STORAGE_UPLOAD_FAILED',
        { error: uploadError.message }
      );
    }

    const receipt = await this.receiptRepo.createReceipt({
      id: receiptId,
      household_id: householdId,
      uploaded_by: userId,
      storage_path: storagePath,
      file_name: file.originalname || `receipt.${ext}`,
      mime_type: file.detectedMime,
      file_size_bytes: file.size,
      status: 'uploaded'
    });

    logger.info({ receiptId, householdId }, 'Receipt registered successfully');
    return receipt;
  }

  /**
   * Parse stored receipt using AI service and auto-create inventory items above confidence threshold.
   *
   * @param {string} receiptId
   * @param {string} householdId
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async parseReceipt(receiptId, householdId, userId) {
    const receipt = await this.receiptRepo.findById(receiptId, householdId);
    if (!receipt) {
      throw new AppError('Receipt not found in active household', 404, 'RECEIPT_NOT_FOUND');
    }

    // Idempotency check: if already parsed, return existing items
    if (receipt.status === 'parsed') {
      const existingItems = await this.receiptRepo.findItemsByReceiptId(receiptId, householdId);
      return {
        receipt_id: receiptId,
        status: 'parsed',
        auto_created_count: existingItems.filter((i) => i.status === 'auto_created').length,
        pending_count: existingItems.filter((i) => i.status === 'pending').length,
        items: existingItems
      };
    }

    // Update status to parsing
    await this.receiptRepo.updateStatus(receiptId, householdId, 'parsing');

    const db = this.getDb();
    let signedUrl = null;

    // Generate short-lived signed URL for the AI service
    try {
      const { data: signedData, error: signError } = await db.storage
        .from(env.SUPABASE_RECEIPTS_BUCKET)
        .createSignedUrl(receipt.storage_path, 300);

      if (!signError && signedData?.signedUrl) {
        signedUrl = signedData.signedUrl;
      }
    } catch (err) {
      logger.warn({ receiptId, error: err.message }, 'Could not generate signed URL; using storage path');
    }

    let parsedResult;
    try {
      parsedResult = await this.aiService.parseReceipt({
        receipt_id: receipt.id,
        image_url: signedUrl || receipt.storage_path,
        storage_path: receipt.storage_path
      });
    } catch (err) {
      // Record parsing failure on the receipt record
      await this.receiptRepo.updateStatus(receiptId, householdId, 'failed', err.message);
      throw err;
    }

    const rawItems = parsedResult.items || [];
    const createdReceiptItems = [];

    for (const item of rawItems) {
      const rawName = item.name.trim();
      let normalizedName = rawName;
      let category = 'other';
      let unit = 'piece';
      let storageLocation = 'pantry';
      let normalizeConfidence = 1.0;
      let normalizeError = null;

      // Call AI product normalization
      try {
        const norm = await this.aiService.normalizeProduct(rawName);
        if (norm?.normalized_name) {
          normalizedName = norm.normalized_name.trim();
        }
        if (norm?.category && ALLOWED_CATEGORIES.has(norm.category.toLowerCase())) {
          category = norm.category.toLowerCase();
        }
        if (norm?.unit && ALLOWED_UNITS.has(norm.unit.toLowerCase())) {
          unit = norm.unit.toLowerCase();
        } else if (item.unit && ALLOWED_UNITS.has(item.unit.toLowerCase())) {
          unit = item.unit.toLowerCase();
        }
        if (norm?.storage_location && ALLOWED_STORAGE_LOCATIONS.has(norm.storage_location.toLowerCase())) {
          storageLocation = norm.storage_location.toLowerCase();
        }
        if (norm?.confidence !== undefined) {
          normalizeConfidence = Number(norm.confidence);
        }
      } catch (err) {
        logger.warn({ rawName, error: err.message }, 'Normalization failed for receipt item; preserving raw item');
        normalizeError = err.message;
        normalizeConfidence = 0.5;
        if (item.unit && ALLOWED_UNITS.has(item.unit.toLowerCase())) {
          unit = item.unit.toLowerCase();
        }
      }

      const parseConfidence = item.confidence ?? 1.0;
      const combinedConfidence = Number((parseConfidence * normalizeConfidence).toFixed(4));

      const lineQuantity = item.quantity && item.quantity > 0 ? Number(item.quantity) : 1;
      const unitPrice = item.unit_price ?? (item.total_price && item.quantity ? Number((item.total_price / item.quantity).toFixed(2)) : null);
      const totalPrice = item.total_price ?? (unitPrice ? Number((unitPrice * lineQuantity).toFixed(2)) : null);

      let lineStatus = 'pending';
      let inventoryItemId = null;

      // Auto-create inventory item if confidence meets configured threshold
      if (combinedConfidence >= env.RECEIPT_AUTO_CREATE_CONFIDENCE) {
        try {
          const invItem = await this.invService.createItem(householdId, userId, {
            name: normalizedName,
            category,
            quantity: lineQuantity,
            unit,
            storage_location: storageLocation,
            estimated_unit_price: unitPrice,
            purchase_date: parsedResult.purchase_date || null
          });
          lineStatus = 'auto_created';
          inventoryItemId = invItem.id;
        } catch (invErr) {
          logger.error({ rawName, error: invErr.message }, 'Failed to auto-create inventory item for high-confidence line');
          lineStatus = 'pending';
        }
      }

      createdReceiptItems.push({
        id: crypto.randomUUID(),
        receipt_id: receiptId,
        household_id: householdId,
        raw_name: rawName,
        normalized_name: normalizedName,
        category,
        quantity: lineQuantity,
        unit,
        unit_price: unitPrice,
        total_price: totalPrice,
        parse_confidence: parseConfidence,
        normalize_confidence: normalizeConfidence,
        confidence: combinedConfidence,
        status: lineStatus,
        inventory_item_id: inventoryItemId,
        error_message: normalizeError
      });
    }

    // Persist line items
    let insertedItems = [];
    if (createdReceiptItems.length > 0) {
      insertedItems = await this.receiptRepo.createReceiptItems(createdReceiptItems);
    }

    // Mark receipt as parsed
    await this.receiptRepo.updateStatus(receiptId, householdId, 'parsed');

    const autoCreatedCount = insertedItems.filter((i) => i.status === 'auto_created').length;
    const pendingCount = insertedItems.filter((i) => i.status === 'pending').length;

    logger.info(
      { receiptId, totalItems: insertedItems.length, autoCreatedCount, pendingCount },
      'Receipt parsed and processed successfully'
    );

    return {
      receipt_id: receiptId,
      status: 'parsed',
      auto_created_count: autoCreatedCount,
      pending_count: pendingCount,
      items: insertedItems
    };
  }

  /**
   * Retrieve all parsed line items for a receipt.
   *
   * @param {string} receiptId
   * @param {string} householdId
   * @returns {Promise<object[]>}
   */
  async getReceiptItems(receiptId, householdId) {
    const receipt = await this.receiptRepo.findById(receiptId, householdId);
    if (!receipt) {
      throw new AppError('Receipt not found in active household', 404, 'RECEIPT_NOT_FOUND');
    }

    return this.receiptRepo.findItemsByReceiptId(receiptId, householdId);
  }

  /**
   * Confirm a low-confidence receipt line item with user corrections and add to inventory.
   *
   * @param {string} receiptId
   * @param {string} lineId
   * @param {string} householdId
   * @param {string} userId
   * @param {object} corrections
   * @returns {Promise<{ line_item: object, inventory_item: object }>}
   */
  async confirmReceiptItem(receiptId, lineId, householdId, userId, corrections = {}) {
    const item = await this.receiptRepo.findItemById(lineId, receiptId, householdId);
    if (!item) {
      throw new AppError('Receipt line item not found', 404, 'LINE_ITEM_NOT_FOUND');
    }

    if (item.status === 'confirmed' || item.status === 'auto_created') {
      throw new AppError(
        'Receipt line item has already been confirmed and created in inventory',
        409,
        'ALREADY_CONFIRMED'
      );
    }

    const finalName = (corrections.name || item.normalized_name || item.raw_name).trim();
    const finalCategory = corrections.category || item.category || 'other';
    const finalQuantity = corrections.quantity ?? (item.quantity && item.quantity > 0 ? Number(item.quantity) : 1);
    const finalUnit = corrections.unit || item.unit || 'piece';
    const finalStorage = corrections.storage_location || 'pantry';
    const finalPrice = corrections.estimated_unit_price ?? item.unit_price ?? null;

    // Create item in inventory
    const invItem = await this.invService.createItem(householdId, userId, {
      name: finalName,
      category: finalCategory,
      quantity: finalQuantity,
      unit: finalUnit,
      storage_location: finalStorage,
      estimated_unit_price: finalPrice,
      purchase_date: corrections.purchase_date || null,
      expiry_date: corrections.expiry_date || null
    });

    // Update receipt line status
    const updatedLine = await this.receiptRepo.updateReceiptItem(lineId, householdId, {
      status: 'confirmed',
      inventory_item_id: invItem.id,
      normalized_name: finalName,
      category: finalCategory,
      quantity: finalQuantity,
      unit: finalUnit,
      unit_price: finalPrice
    });

    logger.info({ lineId, inventoryItemId: invItem.id, householdId }, 'Receipt item confirmed and added to inventory');

    return {
      line_item: updatedLine,
      inventory_item: invItem
    };
  }

  /**
   * Reject a low-confidence receipt line item.
   *
   * @param {string} receiptId
   * @param {string} lineId
   * @param {string} householdId
   * @returns {Promise<{ line_item: object }>}
   */
  async rejectReceiptItem(receiptId, lineId, householdId) {
    const item = await this.receiptRepo.findItemById(lineId, receiptId, householdId);
    if (!item) {
      throw new AppError('Receipt line item not found', 404, 'LINE_ITEM_NOT_FOUND');
    }

    if (item.status === 'auto_created' || item.status === 'confirmed') {
      throw new AppError(
        'Cannot reject an item that has already been created in inventory',
        409,
        'ITEM_ALREADY_CREATED'
      );
    }

    if (item.status === 'rejected') {
      return { line_item: item }; // Idempotent
    }

    const updatedLine = await this.receiptRepo.updateReceiptItem(lineId, householdId, {
      status: 'rejected'
    });

    logger.info({ lineId, householdId }, 'Receipt item rejected');
    return { line_item: updatedLine };
  }
}

export const receiptService = new ReceiptService();
export default receiptService;
