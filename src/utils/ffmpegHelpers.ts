import path from "path";

export interface Segment {
  start: number;
  end: number;
}

/**
 * Inverts segments to remove into segments to keep.
 * Used for ffmpeg select filters which require positive conditions.
 */
export function invertSegmentsToKeep(removeSegments: Segment[]): Segment[] {
  const keepSegments: Segment[] = [];
  let currentTime = 0;

  for (const segment of removeSegments) {
    if (segment.start > currentTime) {
      keepSegments.push({
        start: currentTime,
        end: segment.start,
      });
    }
    currentTime = segment.end;
  }

  // Add final segment from last removal to end of video
  keepSegments.push({ start: currentTime, end: 999999 });

  return keepSegments;
}

/**
 * Generates an output file path with a suffix added to the filename.
 */
export function generateOutputPath(inputPath: string, suffix: string): string {
  const parsedPath = path.parse(inputPath);
  return path.join(parsedPath.dir, `${parsedPath.name}_${suffix}${parsedPath.ext}`);
}
