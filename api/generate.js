// ════════════════════════════════════════════════════════════════
// api/generate.js — Pantreo serverless endpoint (Vercel)
// NOW WITH IMAGE SUPPORT for photo macro scanning.
//
// ⚠️ MERGE, DON'T BLINDLY REPLACE: if your current generate.js has
// auth checks, rate limiting, or logging, keep those and add the
// image handling marked with [IMAGE] below. If it's a plain
// prompt→Anthropic passthrough, this file is a drop-in replacement.
//
// Env vars needed (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY   (you already have this)
//   ANTHROPIC_MODEL     (optional, defaults below)
// ════════════════════════════════════════════════════════════════

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_B64 = 1_500_000; // ~1.1 MB binary; the app sends ~200–400 KB

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, maxTokens, image } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }
  if (prompt.length > 8000) {
    return res.status(400).json({ error: 'Prompt too long' });
  }

  // [IMAGE] validate the optional image payload
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

  /* ── OPTIONAL: server-side scan-limit enforcement ──────────────
  // The client already counts scans, but a determined user could call
  // this endpoint directly. To enforce server-side, add
  // SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars and uncomment:
  //
  // if (image) {
  //   const token = (req.headers.authorization || '').replace('Bearer ', '');
  //   const uRes = await fetch(process.env.SUPABASE_URL + '/auth/v1/user', {
  //     headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + token },
  //   });
  //   if (!uRes.ok) return res.status(401).json({ error: 'Log in to scan photos' });
  //   const user = await uRes.json();
  //   const since = new Date(Date.now() - 7 * 864e5).toISOString();
  //   const cRes = await fetch(
  //     `${process.env.SUPABASE_URL}/rest/v1/meal_photos?user_id=eq.${user.id}&scanned=eq.true&created_at=gte.${since}&select=id`,
  //     { method: 'HEAD', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, Prefer: 'count=exact' } }
  //   );
  //   const used = parseInt((cRes.headers.get('content-range') || '0/0').split('/')[1]) || 0;
  //   const pRes = await fetch(
  //     `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=plan`,
  //     { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY } }
  //   );
  //   const plan = ((await pRes.json())[0] || {}).plan || 'free';
  //   const limits = { pro: 9, family: 9, max: 35, trial: 35 };
  //   if (used >= (limits[plan] || 0)) {
  //     return res.status(429).json({ error: 'No AI scans left this week' });
  //   }
  // }
  ───────────────────────────────────────────────────────────────── */

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: Math.min(parseInt(maxTokens) || 1500, 4000),
        messages: [{ role: 'user', content }],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res
        .status(502)
        .json({ error: (data.error && data.error.message) || 'AI request failed' });
    }

    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: 'Something went wrong' });
  }
}

// [IMAGE] Vercel's default body limit is 1 MB — a base64 photo can
// brush against that, so raise it. Without this, scans intermittently
// fail with 413 errors on larger photos.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};
