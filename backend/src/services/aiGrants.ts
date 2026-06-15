/**
 * aiGrants.ts — the single enforcement point for the per-domain AI Calibration
 * grants ("what the AI is allowed to see").
 *
 * Every digest/brief line that exposes a sensitive data domain is TAGGED with
 * that domain, and the assembly passes each line through grantAllowed() before
 * it ever reaches the model. The rule is drop-unless-granted: a tagged line is
 * dropped unless its grant is on; an untagged ('general') line always passes.
 * Making the filter structural — one function, one type — keeps the sealed-
 * domain guarantee from depending on remembering an inline `if` at every call.
 */

/** Domains gated by the four DATA ACCESS GRANTS in SYS // CALIBRATION. */
export type DataDomain = 'health' | 'social' | 'finance' | 'calendar';

/** The grant flags the filter reads (a subset of AiSettings). */
export interface DomainGrants {
  aiAccessHealth: boolean;
  aiAccessSocial: boolean;
  aiAccessFinance: boolean;
  aiAccessCalendar: boolean;
}

/** True if a line tagged for `domain` may be shown to the model. Untagged
 *  (undefined) lines are always allowed; every tagged line is dropped unless
 *  its grant is explicitly on. */
export function grantAllowed(domain: DataDomain | undefined, s: DomainGrants): boolean {
  switch (domain) {
    case undefined:  return true;
    case 'health':   return s.aiAccessHealth;
    case 'social':   return s.aiAccessSocial;
    case 'finance':  return s.aiAccessFinance;
    case 'calendar': return s.aiAccessCalendar;
  }
}

/** A brief line plus the domain grant it requires (undefined = always shown). */
export interface DomainLine {
  text: string;
  domain?: DataDomain;
}

/** Keep only the lines the user's grants permit, then strip to plain text.
 *  This is the choke point the privacy regression test exercises. */
export function applyGrants(lines: DomainLine[], grants: DomainGrants): string[] {
  return lines.filter(l => grantAllowed(l.domain, grants)).map(l => l.text);
}
