/**
 * ExtractedReport Schema (JSDoc for editor intellisense)
 * @typedef {Object} ExtractedReport
 * @property {Object} summary
 * @property {number} summary.totalGoals
 * @property {number} summary.totalBMPs
 * @property {number} summary.completionRate - 0..1
 * @property {Goal[]} goals
 * @property {BMP[]} bmps
 * @property {ImplementationActivity[]} implementation
 * @property {MonitoringMetric[]} monitoring
 * @property {OutreachActivity[]} outreach
 * @property {GeographicArea[]} geographicAreas
 * @property {string} generatedAt
 * @property {Object} [metadata]
 * @property {string} [metadata.sourceId]
 * @property {string} [metadata.sourceFile]
 *
 * @typedef {Object} Goal
 * @property {string} id
 * @property {string} title
 * @property {string} status - completed|in_progress|planned
 *
 * @typedef {Object} BMP
 * @property {string} id
 * @property {string} name
 * @property {string} category
 *
 * @typedef {Object} ImplementationActivity
 * @property {string} id
 * @property {string} description
 * @property {string|null} date - ISO date if detected
 *
 * @typedef {Object} MonitoringMetric
 * @property {string} id
 * @property {string} metric
 * @property {number|null} value
 *
 * @typedef {Object} OutreachActivity
 * @property {string} id
 * @property {string} activity
 * @property {string} audience
 *
 * @typedef {Object} GeographicArea
 * @property {string} id
 * @property {string} area
 */

export const REQUIRED_TOP_LEVEL_FIELDS = [
  'summary', 'goals', 'bmps', 'implementation', 'monitoring', 'outreach', 'geographicAreas', 'generatedAt'
];

export function basicShapeValidate(report) {
  if (!report || typeof report !== 'object') return false;
  return REQUIRED_TOP_LEVEL_FIELDS.every(f => f in report);
}
