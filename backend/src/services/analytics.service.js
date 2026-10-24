import { analyticsRepository } from '../repositories/analytics.repository.js';
import { logger } from '../config/logger.js';

export class AnalyticsService {
  constructor(repository = analyticsRepository) {
    this.repo = repository;
  }

  /**
   * Resolve ISO date boundaries from period query.
   *
   * @param {string} period - 'week' | 'month' | 'year' | 'custom'
   * @param {string} [startDate]
   * @param {string} [endDate]
   * @returns {{ start: string, end: string, label: string }}
   */
  _resolveDateBoundaries(period = 'month', startDate = null, endDate = null) {
    const now = new Date();

    if (period === 'custom' && startDate && endDate) {
      return {
        start: new Date(startDate).toISOString(),
        end: new Date(endDate).toISOString(),
        label: `Custom (${startDate} to ${endDate})`
      };
    }

    if (period === 'week') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return {
        start: start.toISOString(),
        end: now.toISOString(),
        label: 'Last 7 Days'
      };
    }

    if (period === 'year') {
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return {
        start: start.toISOString(),
        end: now.toISOString(),
        label: `${now.getUTCFullYear()} Year-to-Date`
      };
    }

    // Default: 'month' (from 1st of current month to now)
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return {
      start: start.toISOString(),
      end: now.toISOString(),
      label: `${now.toLocaleString('default', { month: 'long', timeZone: 'UTC' })} ${now.getUTCFullYear()}`
    };
  }

  /**
   * Get waste statistics for period.
   *
   * @param {string} householdId
   * @param {object} query
   * @returns {Promise<object>}
   */
  async getWasteAnalytics(householdId, query = {}) {
    const { start, end, label } = this._resolveDateBoundaries(
      query.period,
      query.start_date,
      query.end_date
    );

    const records = await this.repo.getWasteRecords(householdId, start, end);

    let totalWastedQuantity = 0;
    let totalEstimatedValue = 0;
    const reasonsMap = {};
    const categoriesMap = {};

    for (const r of records) {
      const qty = Number(r.quantity) || 0;
      const val = Number(r.estimated_value) || 0;
      totalWastedQuantity += qty;
      totalEstimatedValue += val;

      const reason = r.reason || 'unspecified';
      reasonsMap[reason] = (reasonsMap[reason] || 0) + 1;

      const cat = r.category || 'other';
      categoriesMap[cat] = (categoriesMap[cat] || 0) + qty;
    }

    return {
      period: query.period || 'month',
      date_range: { start, end, label },
      total_items_wasted: records.length,
      total_wasted_quantity: Number(totalWastedQuantity.toFixed(2)),
      total_estimated_value: Number(totalEstimatedValue.toFixed(2)),
      reasons_breakdown: reasonsMap,
      category_breakdown: categoriesMap,
      records
    };
  }

  /**
   * Get most-wasted items ranking.
   *
   * @param {string} householdId
   * @param {object} query
   * @returns {Promise<object>}
   */
  async getMostWasted(householdId, query = {}) {
    const { start, end, label } = this._resolveDateBoundaries(
      query.period,
      query.start_date,
      query.end_date
    );

    const records = await this.repo.getWasteRecords(householdId, start, end);

    // Group waste by normalized item name
    const itemMap = new Map();

    for (const r of records) {
      const normalizedName = (r.item_name || 'Unknown Item').trim().toLowerCase();
      const existing = itemMap.get(normalizedName) || {
        item_name: r.item_name || 'Unknown Item',
        occurrences: 0,
        total_estimated_value: 0,
        units_breakdown: {}
      };

      existing.occurrences += 1;
      existing.total_estimated_value += Number(r.estimated_value) || 0;

      const unit = r.unit || 'piece';
      const qty = Number(r.quantity) || 0;
      existing.units_breakdown[unit] = (existing.units_breakdown[unit] || 0) + qty;

      itemMap.set(normalizedName, existing);
    }

    const ranked = Array.from(itemMap.values())
      .map((entry) => ({
        item_name: entry.item_name,
        waste_events_count: entry.occurrences,
        total_estimated_value: Number(entry.total_estimated_value.toFixed(2)),
        quantities_by_unit: entry.units_breakdown
      }))
      .sort((a, b) => b.total_estimated_value - a.total_estimated_value || b.waste_events_count - a.waste_events_count);

    return {
      period: query.period || 'month',
      date_range: { start, end, label },
      total_unique_items_wasted: ranked.length,
      most_wasted_items: ranked.slice(0, 10)
    };
  }

  /**
   * Get estimated avoided waste savings.
   *
   * @param {string} householdId
   * @param {object} query
   * @returns {Promise<object>}
   */
  async getSavingsAnalytics(householdId, query = {}) {
    const { start, end, label } = this._resolveDateBoundaries(
      query.period,
      query.start_date,
      query.end_date
    );

    const records = await this.repo.getAvoidedWasteRecords(householdId, start, end);

    let totalEstimatedSavings = 0;
    const sourcesMap = {};

    for (const r of records) {
      const savings = Number(r.estimated_savings) || 0;
      totalEstimatedSavings += savings;

      const src = r.source || 'recipe_rescue';
      sourcesMap[src] = Number(((sourcesMap[src] || 0) + savings).toFixed(2));
    }

    return {
      period: query.period || 'month',
      date_range: { start, end, label },
      total_avoided_waste_events: records.length,
      total_estimated_savings: Number(totalEstimatedSavings.toFixed(2)),
      savings_by_source: sourcesMap,
      records
    };
  }

  /**
   * Month-over-month comparison with zero-division protection.
   *
   * @param {string} householdId
   * @param {string|null} [targetMonthStr] - Format 'YYYY-MM'
   * @returns {Promise<object>}
   */
  async getMonthlyComparison(householdId, targetMonthStr = null) {
    const now = new Date();
    let targetYear = now.getUTCFullYear();
    let targetMonth = now.getUTCMonth(); // 0-indexed

    if (targetMonthStr && /^\d{4}-\d{2}$/.test(targetMonthStr)) {
      const [y, m] = targetMonthStr.split('-').map(Number);
      targetYear = y;
      targetMonth = m - 1;
    }

    // Current Month range
    const curStart = new Date(Date.UTC(targetYear, targetMonth, 1)).toISOString();
    const curEnd = new Date(Date.UTC(targetYear, targetMonth + 1, 0, 23, 59, 59, 999)).toISOString();

    // Previous Month range
    const prevDate = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
    const prevStart = prevDate.toISOString();
    const prevEnd = new Date(Date.UTC(prevDate.getUTCFullYear(), prevDate.getUTCMonth() + 1, 0, 23, 59, 59, 999)).toISOString();

    // Query waste for both months
    const curWasteRecords = await this.repo.getWasteRecords(householdId, curStart, curEnd);
    const prevWasteRecords = await this.repo.getWasteRecords(householdId, prevStart, prevEnd);

    // Query avoided-waste savings for both months
    const curSavingsRecords = await this.repo.getAvoidedWasteRecords(householdId, curStart, curEnd);
    const prevSavingsRecords = await this.repo.getAvoidedWasteRecords(householdId, prevStart, prevEnd);

    const curWasteValue = curWasteRecords.reduce((sum, r) => sum + (Number(r.estimated_value) || 0), 0);
    const prevWasteValue = prevWasteRecords.reduce((sum, r) => sum + (Number(r.estimated_value) || 0), 0);

    const curSavingsValue = curSavingsRecords.reduce((sum, r) => sum + (Number(r.estimated_savings) || 0), 0);
    const prevSavingsValue = prevSavingsRecords.reduce((sum, r) => sum + (Number(r.estimated_savings) || 0), 0);

    // Zero-baseline division handling
    const calculateChange = (current, previous) => {
      const absoluteChange = Number((current - previous).toFixed(2));
      let percentageChange = 0;

      if (previous === 0) {
        percentageChange = current > 0 ? 100.0 : 0.0;
      } else {
        percentageChange = Number((((current - previous) / previous) * 100).toFixed(2));
      }

      return {
        current: Number(current.toFixed(2)),
        previous: Number(previous.toFixed(2)),
        absolute_change: absoluteChange,
        percentage_change: percentageChange
      };
    };

    const wasteComparison = calculateChange(curWasteValue, prevWasteValue);
    const savingsComparison = calculateChange(curSavingsValue, prevSavingsValue);

    return {
      current_month: `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`,
      previous_month: `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`,
      waste_cost_comparison: wasteComparison,
      savings_comparison: savingsComparison
    };
  }
}

export const analyticsService = new AnalyticsService();
export default analyticsService;
