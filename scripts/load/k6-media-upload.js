/**
 * Media upload E2E: login → create-upload-url → PUT file to presigned URL → complete-upload.
 * Tests signed URL, MinIO, media DB, outbox. Requires sample file or in-memory body.
 *
 * Usage:
 *   BASE_URL=... TOKEN=... k6 run scripts/load/k6-media-upload.js
 *   Or create sample-image.jpg (small JPEG) in repo root or pass MEDIA_SAMPLE_PATH.
 */
import http from 'k6/http';
import { check } from 'k6';

const BASE = (__ENV.BASE_URL || 'https://off-campus-housing.local').replace(/\/$/, '');
const SKIP_TLS = (__ENV.K6_INSECURE_SKIP_TLS || '0') === '1';
const TOKEN = __ENV.TOKEN || '';

function parseHosts() {
  const r = __ENV.K6_RESOLVE || '';
  if (!r) return {};
  const parts = r.split(':');
  if (parts.length < 3) return {};
  return { [parts[0]]: parts[parts.length - 1] };
}

export const options = {
  ...parseHosts(),
  vus: 5,
  iterations: 20,
  thresholds: {
    http_req_duration: ['p(95)<400', 'max<1500'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  const opts = { headers };
  if (SKIP_TLS) opts.insecureSkipTLSVerify = true;

  const createRes = http.post(
    `${BASE}/api/media/create-upload-url`,
    JSON.stringify({ filename: 'image.jpg', content_type: 'image/jpeg', size_bytes: 1024 }),
    opts
  );
  if (createRes.status !== 200 && createRes.status !== 201) {
    return;
  }
  const uploadUrl = createRes.json('upload_url');
  const mediaId = createRes.json('media_id');
  if (!uploadUrl) return;

  const smallJpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  ]);
  const putRes = http.put(uploadUrl, smallJpeg.buffer, {
    headers: { 'Content-Type': 'image/jpeg' },
  });
  check(putRes, { 'upload 200': (r) => r.status === 200 });

  if (mediaId) {
    const completeRes = http.post(
      `${BASE}/api/media/complete-upload`,
      JSON.stringify({ media_id: mediaId }),
      opts
    );
    check(completeRes, { 'complete 200': (r) => r.status === 200 || r.status === 201 });
  }
}
