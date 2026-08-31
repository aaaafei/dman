import crypto from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const ENV_KEYS = [
  'XF_APP_ID',
  'XF_API_KEY',
  'XF_API_SECRET',
  'XF_SCENE_ID',
  'XF_AVATAR_ID',
  'XF_VCN',
  'XF_WS_URL',
];

function missingEnvKeys() {
  return ENV_KEYS.filter((key) => !process.env[key]);
}

/**
 * HMAC-SHA256 鉴权 URL。
 * date 必须 UTC GMT；authorization 两次 Base64；查询参数 URL encode。
 */
export function buildSignedUrl(wsUrl, apiKey, apiSecret) {
  const u = new URL(wsUrl);
  const host = u.host;
  const path = u.pathname || '/';
  const date = new Date().toUTCString();
  const origin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
  const signature = crypto.createHmac('sha256', apiSecret).update(origin).digest('base64');
  const authorization = [
    `api_key="${apiKey}"`,
    'algorithm="hmac-sha256"',
    'headers="host date request-line"',
    `signature="${signature}"`,
  ].join(', ');
  const authB64 = Buffer.from(authorization, 'utf8').toString('base64');
  const q = new URLSearchParams({ authorization: authB64, date, host });
  return `${wsUrl}?${q.toString()}`;
}

const missing = missingEnvKeys();
if (missing.length) {
  console.error(`Missing required env keys: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
const publicDir = join(__dirname, 'public');
const sdkDir = join(__dirname, 'sdk');

app.use(express.static(publicDir));
app.use('/sdk', express.static(sdkDir));

app.get('/api/config', (_req, res) => {
  res.json({
    appId: process.env.XF_APP_ID,
    sceneId: process.env.XF_SCENE_ID,
    avatarId: process.env.XF_AVATAR_ID,
    vcn: process.env.XF_VCN,
    serverUrl: process.env.XF_WS_URL,
  });
});

app.get('/api/avatar-auth', (_req, res) => {
  try {
    const signedUrl = buildSignedUrl(
      process.env.XF_WS_URL,
      process.env.XF_API_KEY,
      process.env.XF_API_SECRET,
    );
    res.json({ signedUrl });
  } catch (err) {
    console.error('avatar-auth failed:', err?.message || 'unknown');
    res.status(500).json({ error: 'failed to sign url' });
  }
});

app.listen(PORT, () => {
  console.log(`dman listening on http://localhost:${PORT}`);
});
