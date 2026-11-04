import { useQueryClient } from "@tanstack/react-query";
import * as Network from "expo-network";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import type { LocalDb } from "@/lib/local-db/database";

import { runSync } from "./native-deps";
import type { SyncOptions } from "./sync-engine";

/**
 * Sørger for, at upload-køen tømmes automatisk (kravspec afsnit 4):
 * ved opstart, når nettet vender tilbage, når appen kommer i forgrunden,
 * lige efter et nyt indlæg er gemt, og hvert minut mens appen er åben (backoff).
 * Kun én kørsel ad gangen; anmodninger undervejs samles til én ny kørsel.
 */

export type SyncState = {
  running: boolean;
  lastSyncAt: string | null;
  offline: boolean;
  lastError: string | null;
};

let state: SyncState = { running: false, lastSyncAt: null, offline: false, lastError: null };
const listeners = new Set<() => void>();
const setState = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

type Engine = { db: LocalDb; onChanged: () => void };
let engine: Engine | null = null;
let inflight: Promise<void> | null = null;
let pending: SyncOptions | null = null;
let lastPullAt = 0;

const PULL_INTERVAL_MS = 5 * 60_000;

const merge = (a: SyncOptions | null, b: SyncOptions): SyncOptions => ({
  pull: (a?.pull ?? false) || b.pull,
  ignoreBackoff: (a?.ignoreBackoff ?? false) || b.ignoreBackoff,
});

/** Beder om en synkronisering. Kan kaldes hvor som helst, fx efter "Gem indlæg". */
export function requestSync(opts: Partial<SyncOptions> = {}) {
  const want: SyncOptions = {
    pull: opts.pull ?? Date.now() - lastPullAt > PULL_INTERVAL_MS,
    ignoreBackoff: opts.ignoreBackoff ?? false,
  };
  pending = merge(pending, want);
  if (!inflight) {
    // `finally` kører altid asynkront, så inflight nulstilles også, hvis drain()
    // slutter med det samme (fx før motoren er startet).
    inflight = drain().finally(() => {
      inflight = null;
      // En anmodning kan være kommet ind lige efter løkkens sidste tjek.
      if (pending && engine) void requestSync(pending);
    });
  }
  return inflight;
}

async function drain() {
  while (pending && engine) {
    const opts = pending;
    pending = null;
    const { db, onChanged } = engine;
    setState({ running: true });
    try {
      const result = await runSync(db, opts);
      if (opts.pull && !result.offline) lastPullAt = Date.now();
      setState({
        offline: result.offline,
        lastError: result.failed ? `${result.failed} indlæg kunne ikke uploades` : null,
        lastSyncAt: result.offline ? state.lastSyncAt : new Date().toISOString(),
      });
    } catch (err) {
      console.warn("[sync] fejl:", err);
      setState({ lastError: "Synkronisering fejlede" });
    } finally {
      // Status ændrer sig undervejs (uploader → synkroniseret), så skærmene opdateres altid.
      onChanged();
      setState({ running: false });
    }
  }
}

/** Monteres én gang inden for LocalDbProvider. */
export function useSyncScheduler(db: LocalDb, userId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    engine = { db, onChanged: () => queryClient.invalidateQueries({ queryKey: ["local", userId] }) };
    lastPullAt = 0;
    void requestSync({ pull: true, ignoreBackoff: true });

    let wasOnline = true;
    const netSub = Network.addNetworkStateListener(({ isConnected, isInternetReachable }) => {
      const online = isConnected !== false && isInternetReachable !== false;
      if (online && !wasOnline) void requestSync({ pull: true, ignoreBackoff: true });
      wasOnline = online;
    });

    const appSub = AppState.addEventListener("change", (s) => {
      if (s === "active") void requestSync({ ignoreBackoff: true });
    });

    const timer = setInterval(() => {
      if (AppState.currentState === "active") void requestSync();
    }, 60_000);

    return () => {
      netSub.remove();
      appSub.remove();
      clearInterval(timer);
      engine = null;
      pending = null;
    };
  }, [db, userId, queryClient]);
}

/** Pull-to-refresh: spinneren vises kun for brugerens eget træk, ikke for baggrundskørsler. */
export function useRefreshSync() {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await requestSync({ pull: true, ignoreBackoff: true });
    } finally {
      setRefreshing(false);
    }
  };
  return { refreshing, onRefresh };
}
