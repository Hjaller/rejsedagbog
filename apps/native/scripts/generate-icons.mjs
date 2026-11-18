// Tegner appens ikoner (et frimærke med poststempel, redesign D) og skriver dem til
// assets/images. Kør fra repoets rod: node apps/native/scripts/generate-icons.mjs
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "images");

// Farverne følger lib/theme.ts.
const PAPER = "#F6F1E7";
const STAMP = "#FFFDF8";
const INK = "#1C1B19";
const RED = "#B9472A";

const W = 400;
const H = 500;
const INSET = 44;

/** Takkerne i frimærkets kant: huller langs alle fire sider. */
function perforations() {
  const holes = [];
  const r = 13;
  const nx = 12;
  const ny = 15;
  for (let i = 0; i <= nx; i++) {
    const x = -W / 2 + (W / nx) * i;
    holes.push(`<circle cx="${x}" cy="${-H / 2}" r="${r}"/>`, `<circle cx="${x}" cy="${H / 2}" r="${r}"/>`);
  }
  for (let i = 1; i < ny; i++) {
    const y = -H / 2 + (H / ny) * i;
    holes.push(`<circle cx="${-W / 2}" cy="${y}" r="${r}"/>`, `<circle cx="${W / 2}" cy="${y}" r="${r}"/>`);
  }
  return holes.join("");
}

const px = -W / 2 + INSET;
const py = -H / 2 + INSET;
const pw = W - INSET * 2;
const ph = H - INSET * 2;
const HILLS = `M${px} ${py + ph} L${px} 70 Q-70 -30 20 90 Q80 30 ${px + pw} 110 L${px + pw} ${py + ph} Z`;
const SUN = `<circle cx="-50" cy="-70" r="50"/>`;

const DEFS = `
  <defs>
    <mask id="perf" maskUnits="userSpaceOnUse" x="-300" y="-350" width="600" height="700">
      <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" fill="#fff"/>
      <g fill="#000">${perforations()}</g>
    </mask>
    <mask id="mono" maskUnits="userSpaceOnUse" x="-300" y="-350" width="600" height="700">
      <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" fill="#fff"/>
      <g fill="#000">${perforations()}</g>
      <rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#000"/>
      <g fill="#fff">${SUN}<path d="${HILLS}"/></g>
    </mask>
  </defs>`;

function postmark(color, opacity) {
  return `
    <g transform="translate(140 -175)" fill="none" stroke="${color}" stroke-width="11" opacity="${opacity}" stroke-linecap="round">
      <circle r="100"/>
      <circle r="68"/>
      <path d="M-34 -12 H34 M-34 14 H34"/>
    </g>`;
}

function stamp({ scale, mono = false }) {
  const transform = `translate(512 512) scale(${scale}) rotate(-6)`;
  if (mono) {
    return `<g transform="${transform}">
      <rect x="-300" y="-350" width="600" height="700" fill="#fff" mask="url(#mono)"/>
      ${postmark("#fff", 1)}
    </g>`;
  }
  return `<g transform="${transform}">
    <rect x="-300" y="-350" width="600" height="700" fill="${INK}" opacity="0.14" mask="url(#perf)" transform="translate(8 12)"/>
    <rect x="-300" y="-350" width="600" height="700" fill="${STAMP}" mask="url(#perf)"/>
    <rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${RED}"/>
    <g fill="${PAPER}">${SUN}</g>
    <path d="${HILLS}" fill="${INK}"/>
    ${postmark(INK, 0.9)}
  </g>`;
}

function svg(body, background) {
  const bg = background ? `<rect width="1024" height="1024" fill="${background}"/>` : "";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${DEFS}${bg}${body}</svg>`,
  );
}

await mkdir(OUT, { recursive: true });

// iOS og Play-butikken: fuld firkant uden alfakanal (Apple afviser ikoner med alfa).
const icon = await sharp(svg(stamp({ scale: 1.3 }), PAPER)).flatten({ background: PAPER }).removeAlpha().png().toBuffer();
await sharp(icon).toFile(path.join(OUT, "icon.png"));
await sharp(icon).resize(48).toFile(path.join(OUT, "favicon.png"));

// Android adaptive icon: motivet holder sig inden for den sikre cirkel (66 % af fladen).
await sharp(svg(stamp({ scale: 1 }))).png().toFile(path.join(OUT, "android-icon-foreground.png"));
await sharp(svg(stamp({ scale: 1, mono: true }))).png().toFile(path.join(OUT, "android-icon-monochrome.png"));

// Splash: frimærket alene på gennemsigtig baggrund (farven sættes i app.json).
await sharp(svg(stamp({ scale: 1.5 }))).png().toFile(path.join(OUT, "splash-icon.png"));

console.log(`Ikoner skrevet til ${OUT}`);
