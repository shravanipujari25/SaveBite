import env from '../config/env.js';
import { logger } from '../config/logger.js';
import { inventoryRepository } from '../repositories/inventory.repository.js';
import { aiClientService } from './aiClient.service.js';
import { sensorReadingRepository } from '../repositories/sensorReading.repository.js';
import { freshnessRepository } from '../repositories/freshness.repository.js';
import { notificationRepository } from '../repositories/notification.repository.js';
import { householdRepository } from '../repositories/household.repository.js';

export class IntelligenceService {
  constructor(dependencies = {}) {
    this.inventoryRepo = dependencies.inventoryRepo || inventoryRepository;
    this.aiClient = dependencies.aiClient || aiClientService;
    this.sensorRepo = dependencies.sensorRepo || sensorReadingRepository;
    this.freshnessRepo = dependencies.freshnessRepo || freshnessRepository;
    this.notificationRepo = dependencies.notificationRepo || notificationRepository;
    this.householdRepo = dependencies.householdRepo || householdRepository;

    this.useFirstThreshold = env.USE_FIRST_ALERT_THRESHOLD || 70;
    this.shelfLifeAlertDays = env.SHELF_LIFE_ALERT_THRESHOLD_DAYS || 2.0;
  }

  /**
   * Helper to calculate simple remaining calendar days from an ISO expiry date.
   *
   * @param {string|null} expiryDate
   * @returns {number|null}
   */
  _calculateCalendarDaysRemaining(expiryDate) {
    if (!expiryDate) return null;
    const now = new Date();
    const expiry = new Date(expiryDate);
    const diffMs = expiry.getTime() - now.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Determine freshness bucket from adjusted days left and use-first score.
   *
   * @param {number|null} adjDaysLeft
   * @param {number} useFirstScore
   * @param {string|null} expiryDate
   * @returns {'fresh' | 'use_soon' | 'critical' | 'expired'}
   */
  _determineFreshnessBucket(adjDaysLeft, useFirstScore, expiryDate) {
    if (adjDaysLeft !== null && adjDaysLeft !== undefined) {
      if (adjDaysLeft <= 0) return 'expired';
      if (adjDaysLeft <= 1.0 || useFirstScore >= 80) return 'critical';
      if (adjDaysLeft <= this.shelfLifeAlertDays || useFirstScore >= this.useFirstThreshold) return 'use_soon';
      return 'fresh';
    }

    if (expiryDate) {
      const days = this._calculateCalendarDaysRemaining(expiryDate);
      if (days !== null && days <= 0) return 'expired';
      if (days !== null && days <= 1.0) return 'critical';
      if (days !== null && days <= this.shelfLifeAlertDays) return 'use_soon';
    }

    if (useFirstScore >= 80) return 'critical';
    if (useFirstScore >= this.useFirstThreshold) return 'use_soon';

    return 'fresh';
  }

  /**
   * Map AI priority category ("Red", "Orange", "Yellow", "Green", "Black")
   * to existing database freshness_bucket ("critical", "use_soon", "fresh", "expired").
   *
   * @param {string} priorityCategory
   * @param {number|null} adjDaysLeft
   * @param {number} useFirstScore
   * @param {string|null} expiryDate
   * @returns {'fresh' | 'use_soon' | 'critical' | 'expired'}
   */
  _mapPriorityCategory(priorityCategory, adjDaysLeft, useFirstScore, expiryDate) {
    switch (priorityCategory) {
      case 'Red':
        return 'critical';
      case 'Orange':
      case 'Yellow':
        return 'use_soon';
      case 'Green':
        return 'fresh';
      case 'Black':
      default:
        // Unscoreable item or unknown: fall back to calendar / days left logic
        return this._determineFreshnessBucket(adjDaysLeft, useFirstScore, expiryDate);
    }
  }

  /**
   * Run intelligence analysis for a single household.
   *
   * @param {string} householdId
   * @returns {Promise<{ itemsProcessed: number, alertsCreated: number }>}
   */
  async processHousehold(householdId) {
    logger.info({ householdId }, 'Starting intelligence run for household');

    // 1. Fetch active items
    const activeItems = await this.inventoryRepo.findAllActive(householdId);
    if (!activeItems || activeItems.length === 0) {
      logger.debug({ householdId }, 'No active inventory items found for intelligence analysis');
      return { itemsProcessed: 0, alertsCreated: 0 };
    }

    // 2. Fetch latest sensor telemetry for environmental context
    const latestSensorReading = await this.sensorRepo.getLatestHouseholdReading(householdId);
    const temperatureC = latestSensorReading?.temperature_c ?? 4.0;
    const humidityPercent = latestSensorReading?.humidity_percent ?? 65.0;

    // 3. Estimate shelf-life for active items with missing or stale estimates
    const itemEstimates = new Map();
    for (const item of activeItems) {
      // Fetch latest freshness scan if available
      let latestScan = null;
      try {
        const scans = await this.freshnessRepo.findByItemId(item.id, householdId);
        latestScan = scans && scans.length > 0 ? scans[0] : null;
      } catch (scanErr) {
        logger.warn({ itemId: item.id, error: scanErr.message }, 'Failed to fetch freshness scan');
      }

      try {
        const shelfLifeRes = await this.aiClient.estimateShelfLife({
          name: item.name,
          category: item.category,
          storage_location: item.storage_location,
          expiry_date: item.expiry_date,
          purchase_date: item.purchase_date,
          is_opened: Boolean(item.is_opened),
          temperature_c: temperatureC,
          humidity_percent: humidityPercent,
          freshness_score: latestScan ? latestScan.freshness_score : undefined
        });

        itemEstimates.set(item.id, shelfLifeRes);
      } catch (err) {
        logger.warn({ itemId: item.id, error: err.message }, 'AI shelf-life estimation unavailable; using fallback');
        // Graceful fallback to stored adj_days_left or calendar days
        const fallbackDays = item.adj_days_left ?? this._calculateCalendarDaysRemaining(item.expiry_date);
        itemEstimates.set(item.id, {
          adj_days_left: fallbackDays,
          confidence: 0.5
        });
      }
    }

    // 4. Score Use-First priority across active household items
    const scoreableItems = [];
    for (const item of activeItems) {
      if (!item.purchase_date) {
        logger.warn({ itemId: item.id, name: item.name }, 'Skipping AI priority scoring: purchase_date is null (required field)');
        continue;
      }

      // Format purchase_date to YYYY-MM-DD
      const purchaseDateStr = typeof item.purchase_date === 'string'
        ? item.purchase_date.split('T')[0]
        : new Date(item.purchase_date).toISOString().split('T')[0];

      // Format package_use_by_date to YYYY-MM-DD if present
      let packageUseByDate = null;
      if (item.expiry_date) {
        packageUseByDate = typeof item.expiry_date === 'string'
          ? item.expiry_date.split('T')[0]
          : new Date(item.expiry_date).toISOString().split('T')[0];
      }

      scoreableItems.push({
        item_id: item.id,
        product_name: item.name,
        purchase_date: purchaseDateStr,
        opened: Boolean(item.is_opened),
        storage_zone: item.storage_location || null,
        package_use_by_date: packageUseByDate
      });
    }

    const useFirstScores = new Map();
    if (scoreableItems.length > 0) {
      try {
        const scoreRes = await this.aiClient.scoreUseFirst(scoreableItems);
        if (scoreRes && Array.isArray(scoreRes.scored_items)) {
          for (const s of scoreRes.scored_items) {
            useFirstScores.set(s.item_id, s);
          }
        }
      } catch (err) {
        logger.warn({ householdId, error: err.message }, 'AI Use-First scoring unavailable; preserving existing scores');
      }
    }

    // 5. Update inventory items & emit transition alerts
    let itemsProcessed = 0;
    let alertsCreated = 0;

    for (const item of activeItems) {
      const estimate = itemEstimates.get(item.id);
      const scoreData = useFirstScores.get(item.id);

      const adjDaysLeft = estimate?.adj_days_left !== undefined
        ? (estimate.adj_days_left !== null ? Number(estimate.adj_days_left) : null)
        : (item.adj_days_left !== null && item.adj_days_left !== undefined ? Number(item.adj_days_left) : null);

      const useFirstScore = (scoreData && scoreData.score !== null && scoreData.score !== undefined)
        ? Math.round(Number(scoreData.score))
        : (item.use_first_score ? Math.round(Number(item.use_first_score)) : 0);

      const newBucket = scoreData
        ? this._mapPriorityCategory(scoreData.priority_category, adjDaysLeft, useFirstScore, item.expiry_date)
        : this._determineFreshnessBucket(adjDaysLeft, useFirstScore, item.expiry_date);
      const previousBucket = item.freshness_bucket || 'fresh';

      // Update database intelligence fields
      await this.inventoryRepo.updateIntelligence(item.id, householdId, {
        adj_days_left: adjDaysLeft,
        use_first_score: useFirstScore,
        freshness_bucket: newBucket,
        last_intelligence_at: new Date().toISOString()
      });
      itemsProcessed++;

      // 6. Check for meaningful risk state transition to alert
      const crossedBucket = (newBucket === 'critical' || newBucket === 'use_soon') && (newBucket !== previousBucket);
      const crossedScore = useFirstScore >= this.useFirstThreshold && (item.use_first_score || 0) < this.useFirstThreshold;

      if (crossedBucket || crossedScore) {
        // Prevent duplicate alerts within a 2-hour window
        const recentAlert = await this.notificationRepo.findRecentAlert(
          householdId,
          null,
          'risk_transition',
          120
        );

        // Check if recent alert was for this specific item in title
        const isDuplicate = recentAlert && recentAlert.title && recentAlert.title.includes(item.name);

        if (!isDuplicate) {
          const isCritical = useFirstScore >= 80 || (adjDaysLeft !== null && adjDaysLeft <= this.shelfLifeAlertDays);
          const title = isCritical
            ? `Critical Expiry Risk: ${item.name}`
            : `Use Soon Notice: ${item.name}`;

          const daysDesc = adjDaysLeft !== null
            ? `estimated ${adjDaysLeft} days remaining`
            : 'approaching shelf life';

          const message = isCritical
            ? `${item.name} has ${daysDesc} (Use-First score: ${useFirstScore}). Prioritize consuming it to minimize food waste.`
            : `${item.name} has ${daysDesc} (Use-First score: ${useFirstScore}). Consider using it soon.`;

          await this.notificationRepo.create({
            household_id: householdId,
            type: 'risk_transition',
            title,
            message,
            severity: isCritical ? 'critical' : 'warning'
          });
          alertsCreated++;
        }
      }
    }

    logger.info({ householdId, itemsProcessed, alertsCreated }, 'Intelligence run complete for household');
    return { itemsProcessed, alertsCreated };
  }

  /**
   * Process all households across the system.
   * Used by the scheduled runner.
   *
   * @returns {Promise<{ householdsProcessed: number, totalItemsProcessed: number, totalAlertsCreated: number }>}
   */
  async processAllHouseholds() {
    logger.info('Starting global scheduled intelligence job');

    const householdIds = await this.householdRepo.findAllHouseholdIds();
    let householdsProcessed = 0;
    let totalItemsProcessed = 0;
    let totalAlertsCreated = 0;

    for (const hId of householdIds) {
      try {
        const result = await this.processHousehold(hId);
        householdsProcessed++;
        totalItemsProcessed += result.itemsProcessed;
        totalAlertsCreated += result.alertsCreated;
      } catch (err) {
        // Strict household isolation: error in one household must never disrupt others
        logger.error({ householdId: hId, error: err.message }, 'Failed to process intelligence for household');
      }
    }

    logger.info(
      { householdsProcessed, totalItemsProcessed, totalAlertsCreated },
      'Global scheduled intelligence job finished'
    );

    return { householdsProcessed, totalItemsProcessed, totalAlertsCreated };
  }
}

export const intelligenceService = new IntelligenceService();
export default intelligenceService;
