/** Vejret på tidspunktet for et indlæg (fra Open-Meteo). */
export type Weather = {
  tempC: number;
  /** WMO-vejrkode, se https://open-meteo.com/en/docs#weathervariables */
  code: number;
  windKmh: number;
};

const WMO_LABELS_DA: Record<number, string> = {
  0: "klart",
  1: "mest klart",
  2: "let skyet",
  3: "overskyet",
  45: "tåge",
  48: "rimtåge",
  51: "let støvregn",
  53: "støvregn",
  55: "tæt støvregn",
  56: "let isslag",
  57: "isslag",
  61: "let regn",
  63: "regn",
  65: "kraftig regn",
  66: "let isregn",
  67: "isregn",
  71: "let sne",
  73: "sne",
  75: "kraftig sne",
  77: "snekorn",
  80: "lette byger",
  81: "byger",
  82: "kraftige byger",
  85: "lette snebyger",
  86: "snebyger",
  95: "torden",
  96: "torden med hagl",
  99: "kraftig torden med hagl",
};

export function weatherLabel(code: number): string {
  return WMO_LABELS_DA[code] ?? "ukendt vejr";
}

/** Beaufort-agtig beskrivelse af vind i km/t. */
export function windLabel(windKmh: number): string {
  if (windKmh < 6) return "stille";
  if (windKmh < 20) return "let vind";
  if (windKmh < 39) return "frisk vind";
  if (windKmh < 62) return "hård vind";
  return "storm";
}

/** "23 °C · klart · let vind" */
export function formatWeather(w: Weather, opts: { withWind?: boolean } = {}): string {
  const parts = [`${Math.round(w.tempC)} °C`, weatherLabel(w.code)];
  if (opts.withWind) parts.push(windLabel(w.windKmh));
  return parts.join(" · ");
}
