/**
 * Al trafik skal gå over HTTPS. Under udvikling må serveren køre på http://
 * (computerens LAN-IP), men et build til brugere må aldrig tale ukrypteret med
 * serveren: login-tokenet sendes med i hver forespørgsel.
 *
 * Filen importerer ikke React Native, så den kan testes i Node.
 */
export function assertSecureServerUrl(url: string, isDev: boolean): string {
  const protocol = new URL(url).protocol;
  if (protocol === "https:") return url;
  if (protocol === "http:" && isDev) return url;
  throw new Error("Serverens adresse skal begynde med https:// (EXPO_PUBLIC_SERVER_URL).");
}
