/**
 * Simpel grænse for antal forsøg pr. nøgle i et tidsvindue, holdt i hukommelsen.
 * Bruges til invitationskoder, så koder ikke kan gættes ved at prøve mange efter
 * hinanden. tRPC-ruterne deler én rate limit i Fastify, så den er for grov her.
 * Én serverproces er nok i denne skala; ved flere instanser skal den i fx Redis.
 */
export function createAttemptLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const attempts = new Map<string, number[]>();

  const recent = (key: string, now: number) => {
    const list = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
    attempts.set(key, list);
    return list;
  };

  const cleanup = (now: number) => {
    // Ryd op, så kortet ikke vokser med hver nøgle, der nogensinde har prøvet.
    if (attempts.size <= 10_000) return;
    for (const [k, list] of attempts) {
      if (list.every((t) => now - t >= windowMs)) attempts.delete(k);
    }
  };

  return {
    /** true, hvis grænsen er nået (registrerer ikke et forsøg). */
    isLimited(key: string, now = Date.now()): boolean {
      return recent(key, now).length >= max;
    },

    /** Registrerer et forsøg uden at tjekke grænsen. */
    record(key: string, now = Date.now()): void {
      recent(key, now).push(now);
      cleanup(now);
    },

    /**
     * Registrerer et forsøg. Returnerer false, hvis grænsen allerede er nået.
     * Tjek og registrering sker synkront, så samtidige kald ikke kan snige sig forbi.
     */
    tryAttempt(key: string, now = Date.now()): boolean {
      const list = recent(key, now);
      if (list.length >= max) return false;
      list.push(now);
      cleanup(now);
      return true;
    },

    /** Giver et forsøg registreret med tryAttempt tilbage (fx når det lykkedes). */
    refund(key: string, at: number): void {
      const list = attempts.get(key);
      const i = list?.lastIndexOf(at) ?? -1;
      if (list && i >= 0) list.splice(i, 1);
    },
  };
}

/**
 * Nøgle til grænser pr. IP. En IPv6-bruger har typisk et helt /64-net (2^64 adresser),
 * så IPv6 tælles pr. /64; ellers kunne grænsen omgås ved at skifte adresse.
 */
export function ipRateLimitKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.toLowerCase().split("%")[0]!.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups =
    tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}
