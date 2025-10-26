import { getTranscript } from "./getTranscript";
import { removeFillerWords } from "./removeFillerWords";
import { removeDeadspace } from "./removeDeadspace";
import { speedUpVideo } from "./speedUpVideo";
import { generateSubtitles } from "./generateSubtitles";

export async function editVideoClip(videoPath: string): Promise<string> {
  // Get initial transcript for filler word detection
  const initialTranscript = await getTranscript(videoPath);
  console.log(`INITIAL TRANSCRIPT 🔥\n${JSON.stringify(initialTranscript, null, 2)}`);

  // Remove filler words from video
  const { videoPath: fillerRemovedPath } = await removeFillerWords(
    videoPath,
    initialTranscript
  );

  // Remove deadspace from video
  const deadspaceRemovedPath = await removeDeadspace(fillerRemovedPath);

  // Get transcript for the cleaned video (after filler removal + deadspace removal)
  const transcript = await getTranscript(deadspaceRemovedPath);
  console.log(`FINAL TRANSCRIPT 🔥\n${JSON.stringify(transcript, null, 2)}`);

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
