import { getTranscript } from "./getTranscript";
import { removeDeadspace } from "./removeDeadspace";
import { speedUpVideo } from "./speedUpVideo";
import { generateSubtitles } from "./generateSubtitles";

export async function editVideoClip(videoPath: string): Promise<string> {
  // Remove deadspace from video
  const deadspaceRemovedPath = await removeDeadspace(videoPath);

  // Get transcript for the cleaned video
  const transcript = await getTranscript(deadspaceRemovedPath);
  console.log(`VIDEO TRANSCRIPT 🔥\n${JSON.stringify(transcript, null, 2)}`);

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
