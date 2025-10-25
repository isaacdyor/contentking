import path from "path";
import ffmpeg from "ffmpeg-static";
import { execSync } from "child_process";

// Audio-based silence removal settings - very aggressive for fast-paced editing
const SILENCE_THRESHOLD_DB = -35; // dB level to consider as silence (lower = more strict)
const SILENCE_DURATION = 0.05; // Minimum silence duration to remove (50ms)

interface SilenceSegment {
  start: number;
  end: number;
}

function detectSilence(videoPath: string): SilenceSegment[] {
  // First pass: detect silence segments
  const detectCmd = `"${ffmpeg}" -i "${videoPath}" -af silencedetect=noise=${SILENCE_THRESHOLD_DB}dB:d=${SILENCE_DURATION} -f null - 2>&1`;

  console.log("Detecting silence segments...");
  console.log(`Using threshold: ${SILENCE_THRESHOLD_DB}dB, duration: ${SILENCE_DURATION}s`);

  try {
    const output = execSync(detectCmd, { encoding: "utf8" });

    // Parse silence_start and silence_end from output
    const silences: SilenceSegment[] = [];
    const lines = output.split("\n");

    let currentStart: number | null = null;

    for (const line of lines) {
      const startMatch = line.match(/silence_start: ([\d.]+)/);
      const endMatch = line.match(/silence_end: ([\d.]+)/);

      if (startMatch) {
        currentStart = parseFloat(startMatch[1]);
        console.log(`  Silence starts at ${currentStart}s`);
      }
      if (endMatch && currentStart !== null) {
        const end = parseFloat(endMatch[1]);
        console.log(`  Silence ends at ${end}s (duration: ${(end - currentStart).toFixed(3)}s)`);
        silences.push({ start: currentStart, end });
        currentStart = null;
      }
    }

    console.log(`Found ${silences.length} silence segments total`);
    return silences;
  } catch (error: any) {
    console.error("Error detecting silence:", error.message);
    return [];
  }
}

function buildSelectFilter(silences: SilenceSegment[]): string {
  if (silences.length === 0) {
    return "[0:v]copy[v];[0:a]acopy[a]";
  }

  // Build time ranges to KEEP (inverse of silences)
  const keepRanges: Array<{ start: number; end: number }> = [];
  let currentTime = 0;

  for (const silence of silences) {
    if (silence.start > currentTime) {
      keepRanges.push({ start: currentTime, end: silence.start });
    }
    currentTime = silence.end;
  }

  // Add final segment (we don't know total duration, so let it run to end)
  keepRanges.push({ start: currentTime, end: 999999 });

  // Build select expression
  const conditions = keepRanges
    .map((range) => `between(t,${range.start},${range.end})`)
    .join("+");

  return `[0:v]select='${conditions}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${conditions}',asetpts=N/SR/TB[a]`;
}

export async function removeDeadspace(videoPath: string): Promise<string> {
  // Detect silence segments based on audio level
  const silences = detectSilence(videoPath);

  if (silences.length === 0) {
    console.log("No silence detected, returning original video");
    return videoPath;
  }

  // Generate output path
  const parsedPath = path.parse(videoPath);
  const outputPath = path.join(
    parsedPath.dir,
    `${parsedPath.name}_edited${parsedPath.ext}`
  );

  // Build filter to remove silence from both video and audio
  const filterComplex = buildSelectFilter(silences);

  // Run ffmpeg
  const ffmpegCmd = `"${ffmpeg}" -i "${videoPath}" -filter_complex "${filterComplex}" -map "[v]" -map "[a]" -y "${outputPath}"`;

  console.log(`Removing ${silences.length} silence segments...`);
  console.log(`Output will be saved to: ${outputPath}`);

  try {
    execSync(ffmpegCmd, { stdio: "pipe" });
    console.log(`✅ Video edited successfully: ${outputPath}`);
    return outputPath;
  } catch (error: any) {
    console.error(`FFmpeg failed with exit code ${error.status}`);
    console.error(error.stderr?.toString());
    throw new Error(`FFmpeg failed: ${error.stderr?.toString()}`);
  }
}
