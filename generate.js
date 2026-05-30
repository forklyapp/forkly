export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Basic rate limiting header check (optional extra layer)
  const origin = req.headers.origin || '';
  const allowed = ['https://cookly.app', 'https://www.cookly.app'];
  // Allow localhost for testing, and any vercel preview URLs
  const isAllowed =
    allowed.includes(origin) ||
    origin.includes('vercel.app') ||
    origin.includes('localhost') ||
    origin === '';

  if (!isAllowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { prompt, maxTokens } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens || 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Claude API error' });
    }

    const data = await response.json();
    const text = data.content.map((b) => b.text || '').join('').trim();

    return res.status(200).json({ text });
  } catch (err) {
    console.error('Generate error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
