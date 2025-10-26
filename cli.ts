#!/usr/bin/env bun

import { parseArgs } from "util";
import { readFileSync } from "fs";

// const API_URL =
//   "https://gi6llt2c43bge2p5evvt2hssbu0gdyfo.lambda-url.us-east-1.on.aws";
const API_URL =
  "https://pnbou6zyl3a5lauqzd2v3266em0lzzyz.lambda-url.us-east-1.on.aws";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log("Usage:");
  console.log("  bun cli.ts upload <file1.mp4> <file2.mp4> ...");
  console.log("  bun cli.ts process <key1> <key2> ...");
  process.exit(0);
}

const command = args[0];

async function uploadFiles(filePaths: string[]) {
  console.log(`Uploading ${filePaths.length} files...`);

  // Step 1: Request presigned URLs
  const filenames = filePaths.map((p) => p.split("/").pop()!);
  const uploadResponse = await fetch(`${API_URL}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filenames }),
  });

  if (!uploadResponse.ok) {
    throw new Error(
      `Failed to get upload URLs: ${await uploadResponse.text()}`
    );
  }

  const uploads: Array<{ key: string; uploadUrl: string }> =
    await uploadResponse.json();

  // Step 2: Upload each file to its presigned URL
  const keys: string[] = [];
  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const { key, uploadUrl } = uploads[i];

    console.log(`Uploading ${filePath} -> ${key}...`);

    const fileContent = readFileSync(filePath);
    const uploadResult = await fetch(uploadUrl, {
      method: "PUT",
      body: fileContent,
    });

    if (!uploadResult.ok) {
      throw new Error(
        `Failed to upload ${filePath}: ${await uploadResult.text()}`
      );
    }

    keys.push(key);
    console.log(`✓ Uploaded ${filePath}`);
  }

  console.log("\nKeys:");
  keys.forEach((key, i) => {
    console.log(`  ${filePaths[i]}: ${key}`);
  });

  return keys;
}

async function processFiles(keys: string[]) {
  console.log(`Processing ${keys.length} files...`);

  // Start the processing job
  const processResponse = await fetch(`${API_URL}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  });

  if (!processResponse.ok) {
    throw new Error(
      `Failed to start processing: ${await processResponse.text()}`
    );
  }

  const result: { jobId: string } = await processResponse.json();
  console.log(`✓ Job created: ${result.jobId}`);

  // Poll for status every 5 seconds
  console.log("Waiting for job to complete...");
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const statusResponse = await fetch(`${API_URL}/status/${result.jobId}`);

    if (!statusResponse.ok) {
      throw new Error(`Failed to check status: ${await statusResponse.text()}`);
    }

    const status = await statusResponse.json();

    if (status.status === "completed") {
      console.log("\n✓ Job completed!");
      console.log(`Result URL: ${status.resultUrl}`);
      return status;
    } else if (status.status === "failed") {
      console.log("\n✗ Job failed!");
      console.log(`Error: ${status.errorMessage}`);
      throw new Error(`Job failed: ${status.errorMessage}`);
    } else {
      process.stdout.write(".");
    }
  }
}

// Main command handling
try {
  if (command === "upload") {
    const filePaths = args.slice(1);
    if (filePaths.length === 0) {
      console.error("Error: No files specified");
      process.exit(1);
    }
    await uploadFiles(filePaths);
  } else if (command === "process") {
    const keys = args.slice(1);
    if (keys.length === 0) {
      console.error("Error: No keys specified");
      process.exit(1);
    }
    await processFiles(keys);
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
} catch (error) {
  console.error("Error:", error);
  process.exit(1);
}
