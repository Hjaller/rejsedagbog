import { TRPCClientError } from "@trpc/client";

import { isFetchFailure } from "@/lib/sync/sync-engine";

/**
 * Fejlbesked til brugeren for kald, der kræver net (invitationer). Serverens beskeder
 * er allerede danske og uden tekniske detaljer; manglende net får sin egen besked.
 */
export function apiErrorMessage(err: unknown, offlineMessage: string): string {
  if (err instanceof TRPCClientError) {
    // Intet svar fra serveren = ingen forbindelse.
    if (!err.data) return offlineMessage;
    return err.message;
  }
  if (isFetchFailure(err)) return offlineMessage;
  return "Noget gik galt. Prøv igen.";
}
