/**
 * DescriptionNormalizer — turn noisy bank transaction descriptions into clean,
 * consistent vendor names suitable for grouping and vendor-spend analysis.
 *
 * Two-phase approach:
 *   1. normalizeOne(desc) — rule-based single-description cleaning. Safe to call
 *      inline on create/update; doesn't need database access.
 *   2. normalizeUserDescriptions(userId) — batch clustering pass. After rule-based
 *      cleaning, descriptions that are >= 80% similar (Levenshtein) are merged into
 *      a single canonical string. Run after imports and on-demand via the API.
 */

import { prisma } from '../server';
import { logger } from '../utils/logger';

// Payment-processor prefixes that precede the real merchant name.
const NOISE_PREFIXES: RegExp[] = [
  /^SQ\s*\*/i,
  /^TST\*\s*/i,
  /^PP\s*\*/i,
  /^PAYPAL\s*\*/i,
  /^VENMO\s*\*/i,
  /^ACH\s+(DEBIT|CREDIT|TRANSFER|PMT)\s+/i,
  /^DEBIT\s+POS\s+/i,
  /^POS\s+/i,
  /^CHECKCARD\s+/i,
  /^ONLINE\s+(PAYMENT|TRANSFER|PMT)\s+/i,
];

// Patterns reliably representing noise (reference IDs, dates, store numbers, etc.).
// Applied globally; order matters — phone numbers before long-digit sweeps.
const NOISE_PATTERNS: RegExp[] = [
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g,   // phone: 800-123-4567 / 800.123.4567
  /\*[A-Z0-9]{3,}/g,                      // reference codes: *AB12CD
  /#[A-Z0-9]{2,}/g,                       // store nums: #1234, #ABC12
  /\/[A-Z0-9][A-Z0-9/.-]*/g,             // URL paths: /BILL/WA, /US
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g,  // date fragments: 6/25, 01/15/24
  /\b\d{5,}\b/g,                          // 5+-digit runs: store IDs, zip, long IDs
];

// Standalone words that are pure bank noise when they appear alone.
const NOISE_WORDS_RE = /\b(DEBIT|CREDIT|PURCHASE|CHECKCARD|POS|ACH|ATM|ELECTRONIC|WITHDRAWAL|DEPOSIT|PAYMENT|TRANSFER|RECURRING|AUTOPAY)\b/gi;

// Two-letter US state codes at the very end of the string.
const TRAILING_STATE_RE = /\s+\b[A-Z]{2}\b\s*$/;

export class DescriptionNormalizer {
  /**
   * Apply rule-based cleaning to a single raw bank description.
   * Returns a human-readable, title-cased vendor name. No DB access.
   */
  static normalizeOne(raw: string): string {
    let s = raw.trim().toUpperCase();

    // Strip payment-processor prefixes.
    for (const prefix of NOISE_PREFIXES) {
      s = s.replace(prefix, '');
    }

    // Strip noise patterns.
    for (const pattern of NOISE_PATTERNS) {
      s = s.replace(pattern, ' ');
    }

    // Strip standalone noise words.
    s = s.replace(NOISE_WORDS_RE, ' ');

    // Strip trailing 2-letter state code (US state or Canadian province).
    s = s.replace(TRAILING_STATE_RE, '');

    // Collapse whitespace.
    s = s.replace(/\s+/g, ' ').trim();

    // Fall back to original (cleaned) if stripping produced empty string.
    if (!s) {
      s = raw.trim().toUpperCase().replace(/\s+/g, ' ');
    }

    // Title-case.
    return titleCase(s);
  }

  /**
   * Batch-normalize all transactions for a user:
   * 1. Compute rule-based normalized form for each unique raw description.
   * 2. Cluster normalized forms that are >= 80% similar via Levenshtein.
   * 3. Assign the cluster's canonical string to every matching transaction.
   *
   * Returns the number of transaction rows updated.
   */
  static async normalizeUserDescriptions(userId: string): Promise<number> {
    // Fetch all unique raw descriptions for this user.
    const rows = await prisma.transaction.findMany({
      where: { userId },
      select: { description: true },
      distinct: ['description'],
    });

    if (rows.length === 0) return 0;

    const uniqueDescs = rows.map(r => r.description);

    // Phase 1: rule-based normalization for each unique description.
    const ruleNorm = new Map<string, string>(); // raw → rule-normalized
    for (const raw of uniqueDescs) {
      ruleNorm.set(raw, this.normalizeOne(raw));
    }

    // Phase 2: cluster rule-normalized strings by similarity.
    // clusterRep: rule-normalized string → canonical representative
    const clusterRep = new Map<string, string>();
    // processed: list of cluster founders (lowercase for comparison)
    const founders: string[] = [];
    const founderCanonical = new Map<string, string>(); // lowercase founder → canonical

    for (const norm of ruleNorm.values()) {
      const normLower = norm.toLowerCase();
      let bestFounder: string | null = null;
      let bestScore = 0;

      for (const founder of founders) {
        const sim = similarity(normLower, founder);
        if (sim > bestScore && sim >= 0.80) {
          bestScore = sim;
          bestFounder = founder;
        }
      }

      if (bestFounder) {
        clusterRep.set(norm, founderCanonical.get(bestFounder)!);
      } else {
        // Start a new cluster; this norm IS the canonical.
        founders.push(normLower);
        founderCanonical.set(normLower, norm);
        clusterRep.set(norm, norm);
      }
    }

    // Build final map: raw description → canonical normalized string.
    const finalMap = new Map<string, string>();
    for (const [raw, norm] of ruleNorm) {
      finalMap.set(raw, clusterRep.get(norm) ?? norm);
    }

    // Update transactions in batches by unique raw description.
    let updated = 0;
    for (const [raw, normalized] of finalMap) {
      const result = await prisma.transaction.updateMany({
        where: { userId, description: raw },
        data: { descriptionNormalized: normalized },
      });
      updated += result.count;
    }

    logger.info(`DescriptionNormalizer: updated ${updated} transactions for user ${userId} (${uniqueDescs.length} unique descriptions → ${founders.length} clusters)`);
    return updated;
  }
}

// ------------------------------------------------------------------ helpers --

function titleCase(s: string): string {
  // Short all-caps words (< 4 chars) that look like acronyms stay uppercase.
  return s.replace(/\S+/g, word => {
    if (/^[A-Z0-9]{1,3}$/.test(word)) return word; // keep ATM, USA, CVS, etc.
    const lower = word.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

function similarity(a: string, b: string): number {
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Use a flat array for the DP table to avoid object allocation overhead.
  const dp = new Uint16Array((m + 1) * (n + 1));
  for (let i = 0; i <= m; i++) dp[i * (n + 1)] = i;
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i * (n + 1) + j] = a[i - 1] === b[j - 1]
        ? dp[(i - 1) * (n + 1) + (j - 1)]
        : 1 + Math.min(
            dp[(i - 1) * (n + 1) + j],
            dp[i * (n + 1) + (j - 1)],
            dp[(i - 1) * (n + 1) + (j - 1)]
          );
    }
  }
  return dp[m * (n + 1) + n];
}
