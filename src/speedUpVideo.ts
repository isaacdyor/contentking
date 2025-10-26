import path from "path";
import ffmpeg from "ffmpeg-static";
import { execSync } from "child_process";
import type { SyncPrerecordedResponse } from "@deepgram/sdk";

// Target words per minute for ideal pacing
const IDEAL_WPM = 250;

// Maximum speed multiplier (don't go beyond this even if super slow)
const MAX_SPEED_MULTIPLIER = 2.0;

interface SpeedUpResult {
  videoPath: string;
  speedFactor: number;
}

function calculateWPM(transcript: SyncPrerecordedResponse): number {
  const words = transcript.results?.channels[0]?.alternatives[0]?.words || [];

  if (words.length === 0) {
    return 0;
  }

  // Get total duration from first word start to last word end
  const firstWord = words[0];
  const lastWord = words[words.length - 1];

  if (firstWord.start === undefined || lastWord.end === undefined) {
    return 0;
  }

  const durationMinutes = (lastWord.end - firstWord.start) / 60;
  const wordCount = words.length;

  return wordCount / durationMinutes;
}

export async function speedUpVideo(
  videoPath: string,
  transcript: SyncPrerecordedResponse
): Promise<SpeedUpResult> {
  const currentWPM = calculateWPM(transcript);

  if (currentWPM === 0) {
    console.log("Could not calculate WPM, skipping speed adjustment");
    return { videoPath, speedFactor: 1.0 };
  }

  console.log(`Current speaking rate: ${currentWPM.toFixed(1)} WPM`);

  // Calculate speed multiplier
  let speedFactor = IDEAL_WPM / currentWPM;

  // Never slow down (min = 1.0)
  if (speedFactor < 1.0) {
    console.log(
      `Already faster than ideal (${IDEAL_WPM} WPM), no speed change`
    );
    return { videoPath, speedFactor: 1.0 };
  }

  // Cap at maximum speed
  if (speedFactor > MAX_SPEED_MULTIPLIER) {
    console.log(
      `Speed factor ${speedFactor.toFixed(
        2
      )}x exceeds max, capping at ${MAX_SPEED_MULTIPLIER}x`
    );
    speedFactor = MAX_SPEED_MULTIPLIER;
  }

  console.log(`Speeding up video by ${speedFactor.toFixed(2)}x`);

  // Generate output path
  const parsedPath = path.parse(videoPath);
  const outputPath = path.join(
    parsedPath.dir,
    `${parsedPath.name}_sped${parsedPath.ext}`
  );

  // Speed up video and audio using setpts and atempo
  // Note: atempo filter only supports 0.5-2.0 range, so for >2x we'd need to chain
  const videoFilter = `setpts=${(1 / speedFactor).toFixed(4)}*PTS`;
  const audioFilter = `atempo=${speedFactor.toFixed(4)}`;

  const ffmpegCmd = `"${ffmpeg}" -i "${videoPath}" -filter:v "${videoFilter}" -filter:a "${audioFilter}" -y "${outputPath}"`;

  try {
    execSync(ffmpegCmd, { stdio: "pipe" });
    console.log(`✅ Video sped up successfully: ${outputPath}`);
    return { videoPath: outputPath, speedFactor };
  } catch (error: any) {
    console.error(
      `FFmpeg speed adjustment failed with exit code ${error.status}`
    );
    console.error(error.stderr?.toString());
    throw new Error(
      `FFmpeg speed adjustment failed: ${error.stderr?.toString()}`
    );
  }
}
