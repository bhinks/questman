/**
 * uid() — UUID v4 with an insecure-context fallback.
 *
 * `crypto.randomUUID` exists only in SECURE contexts (https / localhost).
 * The self-hosted hub is routinely reached over plain LAN http
 * (http://<box-ip>:8080), where it's undefined and calling it throws —
 * which took down the whole Workouts view on non-localhost machines.
 * `crypto.getRandomValues` IS available in insecure contexts, so the
 * fallback builds a spec-correct v4 UUID from it.
 */
export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;   // version 4
  b[8] = (b[8] & 0x3f) | 0x80;   // RFC 4122 variant
  const h = Array.from(b, x => x.toString(16).padStart(2, '0'));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}
