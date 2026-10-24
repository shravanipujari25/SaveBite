import crypto from 'node:crypto';
import env from '../config/env.js';
import { logger } from '../config/logger.js';
import { getDatabaseClient } from '../config/supabase.js';
import { AppError } from '../middleware/errorHandler.js';
import { freshnessRepository } from '../repositories/freshness.repository.js';
import { inventoryRepository } from '../repositories/inventory.repository.js';
import { aiClientService } from './aiClient.service.js';

export class FreshnessService {
  constructor(
    freshnessRepo = freshnessRepository,
    invRepo = inventoryRepository,
    aiService = aiClientService,
    getDb = getDatabaseClient
  ) {
    this.freshnessRepo = freshnessRepo;
    this.invRepo = invRepo;
    this.aiService = aiService;
    this.getDb = getDb;
  }

  /**
   * Process a camera image scan for an inventory item, analyze freshness via AI,
   * record the scan history, and update the inventory item's freshness score.
   *
   * @param {string} itemId
   * @param {string} householdId
   * @param {string} userId
   * @param {object} file - Multer file object
   * @returns {Promise<object>}
   */
  async scanItemFreshness(itemId, householdId, userId, file) {
    // 1. Verify inventory item belongs to the active household
    const item = await this.invRepo.findById(itemId, householdId);
    if (!item) {
      throw new AppError('Inventory item not found in active household', 404, 'ITEM_NOT_FOUND');
    }

    const scanId = crypto.randomUUID();
    const extMap = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp'
    };
    const ext = extMap[file.detectedMime] || 'jpg';
    const storagePath = `households/${householdId}/freshness/${scanId}.${ext}`;

    const db = this.getDb();

    // 2. Upload image to private Supabase Storage
    const { error: uploadError } = await db.storage
      .from(env.SUPABASE_RECEIPTS_BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.detectedMime,
        upsert: false
      });

    if (uploadError) {
      logger.error({ itemId, error: uploadError.message }, 'Failed to upload freshness image to Supabase Storage');
      throw new AppError(
        'Failed to upload scan image to secure storage',
        500,
        'STORAGE_UPLOAD_FAILED',
        { error: uploadError.message }
      );
    }

    // 3. Generate signed URL for AI service
    let signedUrl = null;
    try {
      const { data: signedData, error: signError } = await db.storage
        .from(env.SUPABASE_RECEIPTS_BUCKET)
        .createSignedUrl(storagePath, 300);

      if (!signError && signedData?.signedUrl) {
        signedUrl = signedData.signedUrl;
      }
    } catch (err) {
      logger.warn({ itemId, error: err.message }, 'Could not generate signed URL; using storage path');
    }

    // 4. Call AI freshness analysis endpoint
    const aiResult = await this.aiService.analyzeFreshness({
      image_url: signedUrl || storagePath,
      item_name: item.name,
      category: item.category
    });

    const freshnessScore = Number(aiResult.freshness_score);
    const statusLabel = aiResult.status || (freshnessScore >= 70 ? 'fresh' : freshnessScore >= 40 ? 'use_soon' : freshnessScore >= 15 ? 'critical' : 'expired');
    const confidence = aiResult.confidence ?? 1.0;
    const notes = aiResult.notes || null;

    // 5. Store scan history in freshness_scans table
    const scanRecord = await this.freshnessRepo.createScan({
      id: scanId,
      inventory_item_id: itemId,
      household_id: householdId,
      image_path: storagePath,
      freshness_score: freshnessScore,
      status_label: statusLabel,
      confidence,
      notes,
      scanned_by: userId
    });

    // 6. Safely update inventory_items with freshness_score if column exists
    try {
      await this.invRepo.update(itemId, householdId, {
        freshness_score: freshnessScore
      });
    } catch (updateErr) {
      logger.warn(
        { itemId, error: updateErr.message },
        'Could not update freshness_score on inventory_item; scan history preserved'
      );
    }

    logger.info(
      { itemId, scanId, freshnessScore, statusLabel, householdId },
      'Freshness scan completed successfully'
    );

    return {
      scan_id: scanRecord.id,
      inventory_item_id: itemId,
      freshness_score: freshnessScore,
      status: statusLabel,
      confidence,
      notes,
      created_at: scanRecord.created_at,
      disclaimer: 'Freshness score is an AI-generated estimate and does not guarantee food safety.'
    };
  }
}

export const freshnessService = new FreshnessService();
export default freshnessService;
