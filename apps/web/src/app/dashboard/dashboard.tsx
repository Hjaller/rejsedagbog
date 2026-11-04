"use client";

import { useQuery } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

// Midlertidig visning, indtil webversionen (Should, uge 3) bygges med tidslinje og galleri.
export default function Dashboard({ session }: { session: typeof authClient.$Infer.Session }) {
  const trpc = useTRPC();
  const trips = useQuery(trpc.trips.list.queryOptions());

  if (trips.isLoading) return <p>Henter rejser …</p>;
  if (trips.error) return <p>Kunne ikke hente rejser: {trips.error.message}</p>;
  if (!trips.data?.length) return <p>{session.user.name} har ingen rejser endnu.</p>;

  return (
    <ul>
      {trips.data.map((t) => (
        <li key={t.id}>
          {t.name} · {t.countryCode} · {t.startDate} – {t.endDate}
        </li>
      ))}
    </ul>
  );
}
