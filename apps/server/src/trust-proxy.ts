import { isIP } from "node:net";

/**
 * Oversætter TRUST_PROXY til Fastifys trustProxy: proxyens IP/CIDR, evt. kommasepareret.
 * Tom betyder, at X-Forwarded-For ignoreres (serveren står direkte på nettet).
 *
 * Kun adresser accepteres, og en ugyldig værdi stopper opstarten:
 *  - `true` eller 0.0.0.0/0 stoler på alle, så klienten selv kan bestemme sin IP
 *    med X-Forwarded-For og omgå IP-baseret rate limiting.
 *  - Antal hop (fx `1`) ignoreres af Fastify 5.12, fordi det ikke kan bekræfte, at
 *    forespørgslen kommer fra proxyen. Alle ville så dele samme grænse.
 */
export function parseTrustProxy(value: string | undefined): false | string {
  const trimmed = value?.trim();
  if (!trimmed) return false;

  const entries = trimmed.split(",").map((entry) => entry.trim());
  for (const entry of entries) {
    const [address = "", prefix, ...rest] = entry.split("/");
    const family = isIP(address);
    const bits = Number(prefix);
    const validPrefix =
      prefix === undefined || (/^\d+$/.test(prefix) && bits >= 1 && bits <= (family === 6 ? 128 : 32));
    if (!family || !validPrefix || rest.length > 0) {
      throw new Error(`TRUST_PROXY skal være proxyens IP eller CIDR, fx 10.0.0.2 eller 172.16.0.0/12. Fik: "${entry}"`);
    }
  }
  return entries.join(",");
}
