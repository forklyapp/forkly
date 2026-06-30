// ════════════════════════════════════════════════════════════════
// api/generate.js — Pantreo serverless endpoint (v3)
// THIS FILE GOES IN THE /api FOLDER — NOT the repo root.
// Replace the ENTIRE contents of api/generate.js with this file.
//
// WHAT CHANGED FROM v2 (this fixes "can't generate macros" on scans):
// • Photos now ALWAYS go to a vision-capable model. v2 routed by
//   `task`, and the scan sends task:'fast' — if anything about that
//   combo failed, the scan died with a generic error. Now: if an
//   image is present, we use the vision model, period.
// • Raised the accepted image size (compressed phone photos were
//   occasionally rejected as "Invalid image") and the Vercel body
//   limit to 6mb.
// • Error responses now include Anthropic's actual message, and the
//   function logs full errors to the Vercel console so you can see
//   exactly what failed.
// ════════════════════════════════════════════════════════════════

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_B64 = 4000000; // ~3 MB binary — generous; app sends far less

// Both Sonnet and Haiku 4.5 support vision. Sonnet is most reliable on food photos.
const MODEL_PLAN   = process.env.ANTHROPIC_MODEL_PLAN   || 'claude-sonnet-4-6';
const MODEL_FAST   = process.env.ANTHROPIC_MODEL_FAST   || 'claude-haiku-4-5-20251001';
const MODEL_VISION = process.env.ANTHROPIC_MODEL_VISION || 'claude-sonnet-4-6';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, maxTokens, image, task } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }
  if (prompt.length > 8000) {
    return res.status(400).json({ error: 'Prompt too long' });
  }

  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_API_KEY ||
    process.env.ANTHROPIC_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing the Anthropic API key' });
  }

  let content = prompt;
  let model = task === 'plan' ? MODEL_PLAN : MODEL_FAST;

  if (image) {
    if (typeof image.data !== 'string' || !ALLOWED_IMAGE_TYPES.includes(image.media_type)) {
      return res.status(400).json({ error: 'Invalid image format' });
    }
    if (image.data.length > MAX_IMAGE_B64) {
      return res.status(400).json({ error: 'Image too large — please use a smaller photo' });
    }
    // ANY image request uses the vision model, regardless of task hint.
    model = MODEL_VISION;
    content = [
      {
        type: 'image',
        source: { type: 'base64', media_type: image.media_type, data: image.data },
      },
      { type: 'text', text: prompt },
    ];
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: Math.min(parseInt(maxTokens) || 1500, 4000),
        messages: [{ role: 'user', content }],
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      const msg = (data.error && data.error.message) || ('AI request failed (' + r.status + ')');
      console.error('Anthropic error', r.status, JSON.stringify(data).slice(0, 500));
      return res.status(502).json({ error: msg });
    }

    const text = (data.content || [])
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('\n');

    if (!text) {
      return res.status(502).json({ error: 'AI returned an empty response' });
    }

    return res.status(200).json({ text: text });
  } catch (e) {
    console.error('generate.js exception', e);
    return res.status(500).json({ error: 'Something went wrong reaching the AI' });
  }
}

// Required for photo scans — without this, base64 images hit Vercel's
// 1 MB default body limit and fail with a 413 before reaching this code.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
};
