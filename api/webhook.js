const crypto = require('crypto');

const SUPABASE_URL = 'https://ioqtjpimdssazsapwqwx.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvcXRqcGltZHNzYXpzYXB3cXd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMDExODksImV4cCI6MjA5NTY3NzE4OX0.7PelTUWPtJALVjlvhZBRXtzGC8Z6FW1VIoH3X5nr528';

const PRICE_TO_PLAN = {
  'price_1TceGtEW0RJSKjnPKOIsVW5H': 'basic',
  'price_1TceGuEW0RJSKjnP4ZZLu7mI': 'pro',
  'price_1TceGuEW0RJSKjnPXr6InHEN': 'family',
  'price_1TceGtEW0RJSKjnPC04L21tV': 'max',
};

function getPlanFromPriceId(priceId) {
  return PRICE_TO_PLAN[priceId] || 'pro';
}

async function updateUserPlan(email, plan) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ plan })
    }
  );
  return res.ok;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) return res.status(500).json({ error: 'Webhook secret not configured' });

  // Verify the webhook is actually from Stripe
  let rawBody = '';
  await new Promise((resolve) => {
    req.on('data', chunk => rawBody += chunk);
    req.on('end', resolve);
  });

  const expectedSig = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  const sigHeader = sig.split(',').find(s => s.startsWith('v1='))?.replace('v1=', '');
  if (sigHeader !== expectedSig) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Handle subscription events
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email || session.customer_email;
    const priceId = session.line_items?.data?.[0]?.price?.id;
    const plan = getPlanFromPriceId(priceId);

    if (email) {
      await updateUserPlan(email, plan);
      console.log(`Updated ${email} to ${plan}`);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const email = sub.customer_email;
    if (email) await updateUserPlan(email, 'free');
  }

  return res.status(200).json({ received: true });
};
