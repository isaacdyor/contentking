import path from "path";
import ffmpeg from "ffmpeg-static";
import { spawnSync } from "child_process";
import type { SyncPrerecordedResponse } from "@deepgram/sdk";
import fs from "node:fs";

interface SubtitleChunk {
  text: string;
  start: number;
  end: number;
}

function transcriptToSubtitles(
  transcript: SyncPrerecordedResponse,
  speedFactor: number
): SubtitleChunk[] {
  const words = transcript.results?.channels[0]?.alternatives[0]?.words || [];
  const chunks: SubtitleChunk[] = [];
  let currentChunk: { text: string[]; start: number; end: number } | null =
    null;

  for (const word of words) {
    if (!word.word || word.start === undefined || word.end === undefined)
      continue;

    const scaledStart = word.start / speedFactor;
    const scaledEnd = word.end / speedFactor;
    const wordLength = word.word.length;

    if (!currentChunk) {
      currentChunk = {
        text: [word.word],
        start: scaledStart,
        end: scaledEnd,
      };
    } else {
      const timeSinceLastWord = scaledStart - currentChunk.end;
      const chunkWordCount = currentChunk.text.length;
      const currentTotalLength = currentChunk.text.join(" ").length;

      const shouldStartNewChunk =
        timeSinceLastWord > 0.3 ||
        chunkWordCount >= 3 ||
        (wordLength > 12 && chunkWordCount >= 1) ||
        (currentTotalLength > 20 && chunkWordCount >= 2) ||
        wordLength > 18;

      if (shouldStartNewChunk) {
        chunks.push({
          text: currentChunk.text.join(" "),
          start: currentChunk.start,
          end: currentChunk.end,
        });
        currentChunk = {
          text: [word.word],
          start: scaledStart,
          end: scaledEnd,
        };
      } else {
        currentChunk.text.push(word.word);
        currentChunk.end = scaledEnd;
      }
    }
  }

  if (currentChunk) {
    chunks.push({
      text: currentChunk.text.join(" "),
      start: currentChunk.start,
      end: currentChunk.end,
    });
  }

  return chunks;
}

function generateASSContent(
  chunks: { start: number; end: number; text: string }[]
): string {
  let ass = `[Script Info]
Title: Subtitles
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
; Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,2,10,10,48,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  for (const c of chunks) {
    // Ensure non-negative, non-inverted ranges
    const start = Math.max(0, c.start);
    const end = Math.max(start + 0.02, c.end); // avoid zero-length lines
    const line = escapeASS(c.text);
    ass += `Dialogue: 0,${formatASSTime(start)},${formatASSTime(
      end
    )},Default,,0,0,0,,${line}\n`;
  }
  return ass;
}

function escapeASS(text: string): string {
  return text
    .replace(/\\/g, "\\\\") // escape backslashes first
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\N");
}

function formatASSTime(sec: number): string {
  // ASS wants h:mm:ss.cs (centiseconds)
  const t = Math.max(0, sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 100);
  return `${h}:${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

export async function burnASS({
  inputPath,
  assPath,
  outputPath,
}: {
  inputPath: string;
  assPath: string;
  outputPath: string;
}): Promise<void> {
  // Helpful in Lambda logs when debugging
  const fontsDir = path.join(process.cwd(), "fonts", "ttf");
  const fontsDirEscaped = fontsDir.replace(/\\/g, "/").replace(/:/g, "\\:");
  const assPathEscaped = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");

  const vf = [
    `subtitles=${assPathEscaped}`,
    `fontsdir=${fontsDirEscaped}`,
    `force_style=FontName=DejaVu Sans\\,Bold=0`,
  ].join(":");

  console.log("[ffmpeg vf] ❤️❤️❤️❤️❤️", vf);

  const args = [
    "-nostdin",
    "-y",
    "-i",
    inputPath,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart", // friendly for streaming
    "-loglevel",
    "debug",
    "-report",
    outputPath,
  ];

  if (
    !fs.existsSync(path.join(process.cwd(), "fonts", "ttf", "DejaVuSans.ttf"))
  ) {
    throw new Error("TTF missing at /var/task/fonts/ttf/DejaVuSans.ttf");
  }
  if (!fs.existsSync(assPath)) {
    throw new Error(`ASS missing at ${assPath}`);
  }

  const res = spawnSync(ffmpeg!, args, {
    cwd: "/tmp",
    stdio: "pipe",
    encoding: "utf-8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
  });

  if (res.error) {
    throw new Error(`ffmpeg spawn error: ${res.error.message}`);
  }
  if (res.status !== 0 || res.signal) {
    throw new Error(
      `ffmpeg failed (${res.status ?? "no-exit"} / ${
        res.signal ?? "no-signal"
      })\nSTDERR:\n${res.stderr}`
    );
  }
}

export async function generateSubtitles(
  videoPath: string,
  transcript: SyncPrerecordedResponse,
  speedFactor = 1.0
): Promise<string> {
  const segments = transcriptToSubtitles(transcript, speedFactor);
  if (!segments.length) return videoPath;
  console.log("subs first/last ⌛⌛⌛⌛", segments[0], segments.at(-1));

  const ass = generateASSContent(segments);
  const { dir, name, ext } = path.parse(videoPath);
  const assPath = path.join(dir, `${name}.ass`);
  const outputPath = path.join(dir, `${name}_subtitled${ext}`);

  fs.writeFileSync(assPath, ass, { encoding: "utf-8" });

  // Hard requirement: make sure the shipped font truly exists
  const fontPath = path.join(process.cwd(), "fonts", "ttf", "DejaVuSans.ttf");
  if (!fs.existsSync(fontPath)) {
    throw new Error(`Missing ${fontPath} in Lambda bundle`);
  }

  await burnASS({ inputPath: videoPath, assPath, outputPath });

  const files = fs
    .readdirSync("/tmp")
    .filter((f) => f.startsWith("ffmpeg-") || f.startsWith("ffreport"));
  if (!files.length) {
    console.log("[fflog] no ffmpeg logs in /tmp");
    return outputPath;
  }
  for (const f of files) {
    const p = path.join("/tmp", f);
    const txt = fs.readFileSync(p, "utf-8");
    const want = txt
      .split("\n")
      .filter((line) =>
        /subtitles|ass filter|fontconfig|Selected font|Using font provider|successfully opened|could not|font not found/i.test(
          line
        )
      );
    console.log(
      `---- ${f} (filtered) ----\n${want
        .slice(0, 200)
        .join("\n")}\n-------------------------`
    );
  }

  return outputPath;
}
