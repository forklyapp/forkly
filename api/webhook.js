const crypto = require('crypto');

const SUPABASE_URL = 'https://ioqtjpimdssazsapwqwx.supabase.co';

const PRICE_TO_PLAN = {
  'price_1TceGtEW0RJSKjnPKOIsVW5H': 'basic',
  'price_1TceGuEW0RJSKjnP4ZZLu7mI': 'pro',
  'price_1TceGuEW0RJSKjnPXr6InHEN': 'family',
  'price_1TceGtEW0RJSKjnPC04L21tV': 'max',
};

// Also map payment links directly to plans as fallback
const PAYMENT_LINK_TO_PLAN = {
  'plink_1TceGtEW0RJSKjnPKOIsVW5H': 'basic',  // update these if needed
};

async function updateUserPlan(email, plan) {
  if (!email) return false;
  console.log(`Updating ${email} to plan: ${plan}`);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ plan })
    }
  );
  console.log(`Supabase update status: ${res.status}`);
  return res.ok;
}

function getPlanFromSession(session) {
  // Try to get price ID from line items
  const priceId = session.line_items?.data?.[0]?.price?.id;
  if (priceId && PRICE_TO_PLAN[priceId]) return PRICE_TO_PLAN[priceId];

  // Try amount paid as fallback
  const amount = session.amount_total;
  if (amount <= 199) return 'basic';
  if (amount <= 799) return 'pro';
  if (amount <= 999) return 'family';
  if (amount <= 1299) return 'max';

  return 'pro'; // default fallback
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // Get raw body
  let rawBody = '';
  await new Promise((resolve) => {
    req.on('data', chunk => rawBody += chunk);
    req.on('end', resolve);
  });

  // Verify Stripe signature
  try {
    const parts = sig.split(',');
    const timestamp = parts.find(p => p.startsWith('t='))?.replace('t=', '');
    const sigHash = parts.find(p => p.startsWith('v1='))?.replace('v1=', '');
    const payload = `${timestamp}.${rawBody}`;
    const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
    if (expected !== sigHash) {
      console.error('Signature mismatch');
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } catch (e) {
    console.error('Signature verification error:', e);
    return res.status(400).json({ error: 'Signature error' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  console.log('Webhook event type:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email || session.customer_email;
    const plan = getPlanFromSession(session);
    console.log(`checkout.session.completed: email=${email} plan=${plan} amount=${session.amount_total}`);
    if (email) await updateUserPlan(email, plan);
  }

  if (event.type === 'customer.subscription.deleted') {
    // Log for manual handling — email lookup requires Stripe secret key
    const sub = event.data.object;
    console.log('Subscription cancelled for customer:', sub.customer);
    // TODO: add STRIPE_SECRET_KEY to Vercel to auto-downgrade cancelled users
  }

  return res.status(200).json({ received: true });
};
