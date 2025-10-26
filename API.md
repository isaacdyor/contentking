# ContentKing Video Processing API

A serverless video editing service that automatically removes filler words, eliminates dead space, adjusts speaking speed, and generates subtitles.

## Endpoints

### POST /upload

Generate presigned S3 URLs for uploading video files.

**Request:**
```json
{
  "filenames": ["video1.mp4", "video2.mov"]
}
```

**Response:** `200 OK`
```json
[
  {
    "key": "uploads/550e8400-e29b-41d4-a716-446655440000.mp4",
    "uploadUrl": "https://bucket.s3.amazonaws.com/uploads/550e8400-e29b-41d4-a716-446655440000.mp4?AWSAccessKeyId=..."
  }
]
```

**Parameters:**
- `filenames` (string[], required) - Array of video filenames

**Supported formats:** `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`

**Notes:**
- Presigned URLs expire after 1 hour
- Upload to presigned URL using HTTP PUT

**Example:**
```bash
# Get presigned URLs
curl -X POST https://your-api-url/upload \
  -H "Content-Type: application/json" \
  -d '{"filenames": ["my-video.mp4"]}'

# Upload file
curl -X PUT "PRESIGNED_URL" --upload-file my-video.mp4
```

---

### POST /process

Start an asynchronous video processing job.

**Request:**
```json
{
  "keys": [
    "uploads/550e8400-e29b-41d4-a716-446655440000.mp4"
  ]
}
```

**Response:** `200 OK`
```json
{
  "jobId": "770e8400-e29b-41d4-a716-446655440002"
}
```

**Parameters:**
- `keys` (string[], required) - Array of S3 object keys from `/upload`

**Processing operations:**
1. Transcription (Deepgram nova-3)
2. Filler word removal (AI-powered)
3. Dead space removal (-35dB threshold, 50ms minimum)
4. Speed optimization (target: 200 WPM, max 1.7x)
5. Subtitle generation (ASS format, burned in)
6. Video concatenation (1080x1920 @ 30fps)

**Example:**
```bash
curl -X POST https://your-api-url/process \
  -H "Content-Type: application/json" \
  -d '{"keys": ["uploads/550e8400-e29b-41d4-a716-446655440000.mp4"]}'
```

---

### GET /status/:jobId

Check processing status and retrieve result URL.

**URL Parameters:**
- `jobId` (string, required) - UUID from `/process` response

**Response (Processing):** `200 OK`
```json
{
  "jobId": "770e8400-e29b-41d4-a716-446655440002",
  "status": "processing",
  "keys": ["uploads/550e8400-e29b-41d4-a716-446655440000.mp4"],
  "createdAt": 1698765432
}
```

**Response (Completed):** `200 OK`
```json
{
  "jobId": "770e8400-e29b-41d4-a716-446655440002",
  "status": "completed",
  "keys": ["uploads/550e8400-e29b-41d4-a716-446655440000.mp4"],
  "createdAt": 1698765432,
  "resultUrl": "https://bucket.s3.amazonaws.com/output/770e8400-e29b-41d4-a716-446655440002.mp4?AWSAccessKeyId=...",
  "updatedAt": 1698765532
}
```

**Response (Failed):** `200 OK`
```json
{
  "jobId": "770e8400-e29b-41d4-a716-446655440002",
  "status": "failed",
  "keys": ["uploads/550e8400-e29b-41d4-a716-446655440000.mp4"],
  "createdAt": 1698765432,
  "errorMessage": "Transcription failed: Unable to process audio track",
  "updatedAt": 1698765532
}
```

**Response (Not Found):** `404 Not Found`
```json
{
  "error": "Job not found"
}
```

**Response fields:**
- `jobId` (string) - Job UUID
- `status` (string) - One of: `processing`, `completed`, `failed`
- `keys` (string[]) - S3 keys processed
- `createdAt` (number) - Unix timestamp
- `updatedAt` (number, optional) - Unix timestamp
- `resultUrl` (string, optional) - Presigned download URL (expires in 1 hour)
- `errorMessage` (string, optional) - Error details if failed

**Notes:**
- Poll every 5-10 seconds until status is not `processing`
- Processing time typically 2-5x video duration

**Example:**
```bash
curl -X GET https://your-api-url/status/770e8400-e29b-41d4-a716-446655440002
```

---

## Usage Flow

```
1. POST /upload with filenames
   ↓ receive presigned URLs

2. Upload videos to S3 using presigned URLs (HTTP PUT)
   ↓

3. POST /process with S3 keys
   ↓ receive jobId

4. Poll GET /status/:jobId every 5-10 seconds
   ↓

5. Download result from resultUrl when status is "completed"
```

### JavaScript Example

```javascript
// 1. Get presigned URLs
const uploadResponse = await fetch('https://your-api-url/upload', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ filenames: ['video1.mp4'] })
});
const uploads = await uploadResponse.json();

// 2. Upload files to S3
for (let i = 0; i < uploads.length; i++) {
  await fetch(uploads[i].uploadUrl, {
    method: 'PUT',
    body: files[i],
    headers: { 'Content-Type': files[i].type }
  });
}

// 3. Start processing
const processResponse = await fetch('https://your-api-url/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ keys: uploads.map(u => u.key) })
});
const { jobId } = await processResponse.json();

// 4. Poll for completion
const pollStatus = async () => {
  const statusResponse = await fetch(`https://your-api-url/status/${jobId}`);
  const status = await statusResponse.json();

  if (status.status === 'processing') {
    setTimeout(pollStatus, 5000);
  } else if (status.status === 'completed') {
    window.location.href = status.resultUrl;
  } else {
    console.error('Processing failed:', status.errorMessage);
  }
};
pollStatus();
```

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| 200 | OK | Request successful |
| 400 | Bad Request | Invalid request body or parameters |
| 404 | Not Found | Job ID does not exist |
| 500 | Internal Server Error | Unexpected server error |

### Common Errors

**Invalid filenames:**
```json
{
  "error": "Validation failed",
  "issues": [
    {
      "path": ["filenames", 0],
      "message": "Unsupported file format. Must be mp4, mov, avi, mkv, or webm"
    }
  ]
}
```

**Processing failures:**
Common reasons for `status: "failed"`:
- Corrupted or invalid video file
- Unsupported video codec
- Missing audio track
- Transcription service timeout
- Lambda timeout (15 minutes)

**Expired URLs:**
Presigned URLs expire after 1 hour. Request new URLs via `/upload` or `/status/:jobId`.

---

## Output Specifications

- **Resolution:** 1080x1920 (vertical, 9:16 aspect ratio)
- **Frame rate:** 30 fps
- **Format:** MP4 (H.264 video, AAC audio)
- **Subtitles:** Burned in (not separate file)

---

## Rate Limits

No explicit rate limiting currently implemented. AWS Lambda limits apply:
- Concurrent executions: 1000 (default account limit)
- Memory: 3008 MB per function
- Timeout: 15 minutes per execution
