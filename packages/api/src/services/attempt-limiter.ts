/**
 * Simpel grænse for antal forsøg pr. nøgle i et tidsvindue, holdt i hukommelsen.
 * Bruges til invitationskoder, så koder ikke kan gættes ved at prøve mange efter
 * hinanden. tRPC-ruterne deler én rate limit i Fastify, så den er for grov her.
 * Én serverproces er nok i denne skala; ved flere instanser skal den i fx Redis.
 */
export function createAttemptLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const attempts = new Map<string, number[]>();

  return {
    /** Registrerer et forsøg. Returnerer false, hvis grænsen allerede er nået. */
    tryAttempt(key: string, now = Date.now()): boolean {
      const recent = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        attempts.set(key, recent);
        return false;
      }
      recent.push(now);
      attempts.set(key, recent);
      // Ryd op, så kortet ikke vokser med hver bruger, der nogensinde har prøvet.
      if (attempts.size > 10_000) {
        for (const [k, list] of attempts) {
          if (list.every((t) => now - t >= windowMs)) attempts.delete(k);
        }
      }
      return true;
    },
  };
}
