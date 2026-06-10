// ════════════════════════════════════════════════════════════════
// api/generate.js — Pantreo serverless endpoint (v2)
// Replace the ENTIRE contents of api/generate.js with this file.
//
// FIXES THE "AI IS FAILING" BUG: the previous version I gave you
// hardcoded the model `claude-sonnet-4-20250514`, which has been
// retired — every call (text AND photo) was bouncing off the
// Anthropic API. This version uses current models.
//
// ALSO ADDS:
// • API-key fallback — works whether your Vercel env var is named
//   ANTHROPIC_API_KEY, CLAUDE_API_KEY, or ANTHROPIC_KEY
// • Cost routing — meal plans use Sonnet 4.6 (quality matters),
//   recipes/estimates/photo scans use Haiku 4.5 (3–5x cheaper,
//   plenty smart for those tasks). The app sends a `task` hint.
// • Real error messages passed back to the app instead of a
//   generic failure, so you can see what broke in the UI.
// ════════════════════════════════════════════════════════════════

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_B64 = 1_500_000; // ~1.1 MB binary; the app sends ~200–400 KB

const MODEL_PLAN = process.env.ANTHROPIC_MODEL_PLAN || 'claude-sonnet-4-6';
const MODEL_FAST = process.env.ANTHROPIC_MODEL_FAST || 'claude-haiku-4-5-20251001';

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
    return res.status(500).json({
      error: 'Server is missing the Anthropic API key env var',
    });
  }

  // Optional image (photo macro scanning)
  let content = prompt;
  if (image) {
    if (
      typeof image.data !== 'string' ||
      !ALLOWED_IMAGE_TYPES.includes(image.media_type) ||
      image.data.length > MAX_IMAGE_B64
    ) {
      return res.status(400).json({ error: 'Invalid image' });
    }
    content = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.media_type,
          data: image.data,
        },
      },
      { type: 'text', text: prompt },
    ];
  }

  // Plans get the smarter model; everything else runs on Haiku.
  const model = task === 'plan' ? MODEL_PLAN : MODEL_FAST;

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
      // Surface Anthropic's actual error so the app (and you) can see it
      const msg =
        (data.error && data.error.message) || 'AI request failed (' + r.status + ')';
      return res.status(502).json({ error: msg });
    }

    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: 'Something went wrong reaching the AI' });
  }
}

// Required for photo scans — Vercel's default 1 MB body limit
// intermittently rejects base64 images with 413 errors without this.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};
