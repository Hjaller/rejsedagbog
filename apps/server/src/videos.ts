import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import { VIDEO_MAX_SECONDS } from "@rejsedagbog/shared";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";

/**
 * Video (Could). ffmpeg kommer fra ffmpeg-static, så det virker ens på Windows i
 * udvikling og i Linux-containeren. FFMPEG_PATH kan pege på en anden binær.
 */
const FFMPEG = process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string | null) || "ffmpeg";

/** Plakatrammen vises i tidslinjen og på postkort, så den er større end en billed-thumbnail. */
const POSTER_MAX_PX = 1280;
/** Telefonens tidsstempel kan runde lidt op. */
const DURATION_TOLERANCE_S = 1;
/** Videoen genkodes ikke, så kun codecs, telefoner kan afspille. */
const ACCEPTED_CODECS = new Set(["h264", "hevc"]);
const FFMPEG_TIMEOUT_MS = 60_000;

export class UnsupportedVideoError extends Error {}

export type ProcessedVideo = {
  /** Videoen uden metadata (ingen GPS-position), som MP4 med "faststart". */
  video: Buffer;
  /** JPEG af første billede, til tidslinjen, galleriet og postkort. */
  poster: Buffer;
  width: number;
  height: number;
  durationMs: number;
};

type RunResult = { code: number | null; stdout: Buffer; stderr: string };

function run(args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), FFMPEG_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => {
      // Kun begyndelsen af loggen bruges (stream-info), så den holdes lille.
      if (err.length < 64_000) err += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out), stderr: err });
    });
  });
}

/**
 * Kun mov/mp4-demuxeren og kun lokale filer: ffmpeg kan læse rigtig mange formater
 * og protokoller, og brugerens fil skal ikke kunne bestemme, hvilken kode der kører.
 */
const SAFE_INPUT = ["-hide_banner", "-nostdin", "-protocol_whitelist", "file", "-f", "mov"];

export type VideoInfo = {
  codec: string;
  /** null, hvis videoen ikke har lyd. */
  audioCodec: string | null;
  width: number;
  height: number;
  durationMs: number;
};

/** Lyd, som MP4 kan rumme og alle telefoner afspiller; anden lyd (fx AMR fra billige telefoner) genkodes til AAC. */
const COPY_AUDIO_CODECS = new Set(["aac"]);

/** Læser codec, størrelse (efter rotation) og varighed ud af ffmpegs stream-info. */
export function parseVideoInfo(log: string): VideoInfo | null {
  const duration = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(log);
  const stream = /Stream #\d+:\d+[^:]*: Video: (\w+)[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(log);
  if (!duration || !stream) return null;
  const [, h, m, s] = duration;
  const durationMs = Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000);
  let width = Number(stream[2]);
  let height = Number(stream[3]);
  // Telefoner gemmer en portræt-video liggende med en rotation ved siden af.
  const rotation = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(log);
  if (rotation && Math.abs(Math.round(Number(rotation[1]))) % 180 === 90) [width, height] = [height, width];
  const audio = /Stream #\d+:\d+[^:]*: Audio: (\w+)/.exec(log);
  return { codec: stream[1]!, audioCodec: audio?.[1] ?? null, width, height, durationMs };
}

/**
 * Validerer videoen og fjerner al metadata, herunder positionen, som iPhone og Android
 * gemmer i filen (sikkerhedsrisiko 3). Billedsporet genkodes ikke ("-c:v copy"), så det
 * går hurtigt; lyd, der ikke er AAC, genkodes (billigt). Kun video- og lydsporet kommer
 * med (ingen metadata- eller undertekstspor).
 */
export async function processVideo(inputPath: string, outputPath: string): Promise<ProcessedVideo> {
  // Uden output afslutter ffmpeg med fejl, men skriver stream-info til stderr.
  const probe = await run([...SAFE_INPUT, "-i", inputPath]);
  const info = parseVideoInfo(probe.stderr);
  if (!info) throw new UnsupportedVideoError("Filen er ikke en gyldig video");
  if (!ACCEPTED_CODECS.has(info.codec)) throw new UnsupportedVideoError("Videoformatet understøttes ikke");
  if (info.durationMs > (VIDEO_MAX_SECONDS + DURATION_TOLERANCE_S) * 1000) {
    throw new UnsupportedVideoError(`Videoen må højst vare ${VIDEO_MAX_SECONDS} sekunder`);
  }

  const remux = await run([
    ...SAFE_INPUT,
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "copy",
    ...(info.audioCodec && !COPY_AUDIO_CODECS.has(info.audioCodec) ? ["-c:a", "aac", "-b:a", "128k"] : ["-c:a", "copy"]),
    // Fjern global metadata, metadata på sporene og kapitler.
    "-map_metadata",
    "-1",
    "-map_metadata:s:v",
    "-1",
    "-map_metadata:s:a",
    "-1",
    "-map_chapters",
    "-1",
    // HEVC skal mærkes hvc1 for at kunne afspilles på iOS.
    ...(info.codec === "hevc" ? ["-tag:v", "hvc1"] : []),
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    "-y",
    outputPath,
  ]);
  if (remux.code !== 0) throw new UnsupportedVideoError("Videoen kunne ikke læses");

  // Første billede som PNG på stdout; ffmpeg roterer selv efter videoens rotation.
  const frame = await run([
    ...SAFE_INPUT,
    "-i",
    outputPath,
    "-frames:v",
    "1",
    "-f",
    "image2pipe",
    "-c:v",
    "png",
    "pipe:1",
  ]);
  if (frame.code !== 0 || frame.stdout.length === 0) throw new UnsupportedVideoError("Videoen kunne ikke læses");

  const poster = await sharp(frame.stdout)
    .resize({ width: POSTER_MAX_PX, height: POSTER_MAX_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();

  return {
    video: await readFile(outputPath),
    poster,
    width: info.width,
    height: info.height,
    durationMs: info.durationMs,
  };
}
