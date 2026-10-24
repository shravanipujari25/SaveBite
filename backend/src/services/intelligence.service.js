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
    return Number((diffMs / (1000 * 60 * 60 * 24)).toFixed(1));
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
      if (adjDaysLeft <= this.shelfLifeAlertDays || useFirstScore >= 80) return 'critical';
      if (adjDaysLeft <= 4.0 || useFirstScore >= this.useFirstThreshold) return 'use_soon';
      return 'fresh';
    }

    if (expiryDate) {
      const days = this._calculateCalendarDaysRemaining(expiryDate);
      if (days !== null && days <= 0) return 'expired';
      if (days !== null && days <= this.shelfLifeAlertDays) return 'critical';
      if (days !== null && days <= 4.0) return 'use_soon';
    }

    if (useFirstScore >= 80) return 'critical';
    if (useFirstScore >= this.useFirstThreshold) return 'use_soon';

    return 'fresh';
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
    const useFirstPayloads = activeItems.map((item) => {
      const estimate = itemEstimates.get(item.id);
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        expiry_date: item.expiry_date,
        adj_days_left: estimate?.adj_days_left ?? item.adj_days_left,
        is_opened: Boolean(item.is_opened),
        storage_location: item.storage_location
      };
    });

    const useFirstScores = new Map();
    try {
      const scoreRes = await this.aiClient.scoreUseFirst(useFirstPayloads);
      if (scoreRes && Array.isArray(scoreRes.scores)) {
        for (const s of scoreRes.scores) {
          useFirstScores.set(s.item_id, s);
        }
      }
    } catch (err) {
      logger.warn({ householdId, error: err.message }, 'AI Use-First scoring unavailable; preserving existing scores');
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

      const useFirstScore = scoreData?.use_first_score !== undefined
        ? Number(scoreData.use_first_score)
        : (item.use_first_score ? Number(item.use_first_score) : 0);

      const newBucket = this._determineFreshnessBucket(adjDaysLeft, useFirstScore, item.expiry_date);
      const previousBucket = item.freshness_bucket || 'fresh';

      // Update database intelligence fields
      await this.inventoryRepo.updateIntelligence(item.id, householdId, {
        adj_days_left: adjDaysLeft,
        use_first_score: useFirstScore,
        freshness_bucket: newBucket
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
          const isCritical = newBucket === 'critical';
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
