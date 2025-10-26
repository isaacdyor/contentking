import { getTranscript } from "./getTranscript";
import { removeFillerWords } from "./removeFillerWords";
import { removeDeadspace } from "./removeDeadspace";
import { speedUpVideo } from "./speedUpVideo";
import { generateSubtitles } from "./generateSubtitles";
import { uploadVideoToS3 } from "./uploadToS3";

export async function editVideoClip(
  videoPath: string,
  jobId: string
): Promise<string> {
  // Get initial transcript for filler word detection
  const initialTranscript = await getTranscript(videoPath);

  console.log(
    `INITIAL TRANSCRIPT 🔥\n${JSON.stringify(initialTranscript, null, 2)}`
  );

  // Remove filler words from video
  const { videoPath: fillerRemovedPath } = await removeFillerWords(
    videoPath,
    initialTranscript
  );

  // Remove deadspace from video
  const deadspaceRemovedPath = await removeDeadspace(fillerRemovedPath);

  // Wait 2 seconds to ensure file is fully flushed
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Get transcript for the cleaned video (after filler removal + deadspace removal)
  const transcript = await getTranscript(deadspaceRemovedPath);

  // Speed up video if speaking too slowly
  const { videoPath: spedUpPath, speedFactor } = await speedUpVideo(
    deadspaceRemovedPath,
    transcript
  );

  // Generate and burn in subtitles (with scaled timestamps)
  const finalVideoPath = await generateSubtitles(
    spedUpPath,
    transcript,
    speedFactor
  );

  return finalVideoPath;
}
