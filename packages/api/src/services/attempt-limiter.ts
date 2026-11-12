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

    /** Registrerer et forsøg. Returnerer false, hvis grænsen allerede er nået. */
    tryAttempt(key: string, now = Date.now()): boolean {
      const list = recent(key, now);
      if (list.length >= max) return false;
      list.push(now);
      cleanup(now);
      return true;
    },
  };
}
