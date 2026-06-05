// api/generate.js — Vercel serverless function
// Proxies Claude API calls with per-user authentication + daily rate limiting.
//
// Required Vercel environment variables:
//   ANTHROPIC_API_KEY     — your Claude API key (sk-ant-...)
//   SUPABASE_SERVICE_KEY  — Supabase service_role key (you already have this for the webhook)
//
// Before deploying, run rate-limit-setup.sql in your Supabase SQL editor.

const SUPABASE_URL = 'https://ioqtjpimdssazsapwqwx.supabase.co';

// ── Tunables ──
const MODEL = 'claude-sonnet-4-20250514'; // update to your preferred Claude model
const DAILY_LIMIT = 100;                   // max AI generations per user per day (resets midnight UTC)
const MAX_TOKENS_CAP = 4000;               // hard ceiling regardless of what the client asks for

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Require a user token (the frontend sends this in the Authorization header) ──
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }

  // ── 2. Verify the token with Supabase and resolve the user ──
  let userId;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!userRes.ok) {
      return res.status(401).json({ error: 'Session expired — please log in again.' });
    }
    const user = await userRes.json();
    userId = user && user.id;
    if (!userId) {
      return res.status(401).json({ error: 'Could not verify your account.' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Auth check failed. Please try again.' });
  }

  // ── 3. Atomic per-user daily rate-limit check ──
  try {
    const rlRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_rate_limit`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: userId, p_limit: DAILY_LIMIT }),
    });
    if (rlRes.ok) {
      const rows = await rlRes.json();
      const result = Array.isArray(rows) ? rows[0] : rows;
      if (result && result.allowed === false) {
        return res.status(429).json({
          error: `You've reached your daily limit of ${DAILY_LIMIT} generations. It resets at midnight UTC.`,
        });
      }
    }
    // If the rate-limit call itself errors, we "fail open" (allow the request) so a Supabase
    // hiccup never blocks paying users. Change the block above to fail closed if you prefer.
  } catch (e) {
    // fail open — see note above
  }

  // ── 4. Validate input ──
  const body = req.body || {};
  const prompt = body.prompt;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt.' });
  }
  if (prompt.length > 8000) {
    return res.status(400).json({ error: 'Request too large.' });
  }
  const cappedTokens = Math.min(Math.max(parseInt(body.maxTokens, 10) || 1500, 1), MAX_TOKENS_CAP);

  // ── 5. Call Claude ──
  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: cappedTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!apiRes.ok) {
      // Don't leak upstream error details to the client.
      return res.status(502).json({ error: 'AI service is busy. Please try again in a moment.' });
    }

    const data = await apiRes.json();
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
