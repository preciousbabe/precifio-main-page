
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { json } = require('./_shared/admin');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function verifySignature(event) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const headers = event.headers || {};

  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signature = headers['svix-signature'];

  if (!secret || !id || !timestamp || !signature) return false;

  const timestampNumber = Number(timestamp);

  if (!Number.isFinite(timestampNumber)) return false;

  // Reject webhook requests older than five minutes.
  if (Math.abs(Date.now() / 1000 - timestampNumber) > 300) {
    return false;
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const secretValue = secret.replace(/^whsec_/, '');
  const key = Buffer.from(secretValue, 'base64');

  const expected = crypto
    .createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');

  return signature.split(' ').some((part) => {
    const [version, supplied] = part.split(',');

    if (version !== 'v1' || !supplied) return false;

    const a = Buffer.from(expected);
    const b = Buffer.from(supplied);

    return a.length === b.length &&
      crypto.timingSafeEqual(a, b);
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!verifySignature(event)) {
    return json(401, { error: 'Invalid webhook signature' });
  }

  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');

    const payload = JSON.parse(rawBody);
    const eventType = payload.type;
    const data = payload.data || {};

    const webhookId = event.headers['svix-id'];
    const providerEmailId = data.email_id;

    if (!eventType || !webhookId) {
      return json(400, { error: 'Invalid webhook payload' });
    }

    // Find the corresponding email, if this is a Resend email event.
    let message = null;

    if (providerEmailId) {
      const { data: found } = await supabase
        .from('email_messages')
       .select('id, status, open_count, click_count, first_opened_at')
        .eq('provider_email_id', providerEmailId)
        .maybeSingle();

      message = found;
    }

    // Record the event. The unique provider_event_id prevents duplicates.
    const { data: insertedEvent, error: eventError } = await supabase
      .from('email_events')
      .insert({
        message_id: message?.id || null,
        provider_event_id: webhookId,
        provider_email_id: providerEmailId || null,
        event_type: eventType,
        recipient_email: Array.isArray(data.to)
          ? data.to[0]
          : (data.to || null),
        event_data: payload,
        occurred_at: payload.created_at || new Date().toISOString()
      })
      .select('id')
      .maybeSingle();

    if (eventError?.code === '23505') {
      return json(200, { ok: true, duplicate: true });
    }

    if (eventError) {
      console.error('Webhook event insert error:', eventError);
      return json(500, { error: 'Could not record webhook event' });
    }

    // If the send function has not yet saved the Resend ID,
    // keep the event. It can be reconciled later.
    if (!message) {
      return json(200, {
        ok: true,
        recorded: true,
        matched: false
      });
    }

    const now = payload.created_at || new Date().toISOString();
    const update = { last_event_at: now };

    switch (eventType) {
      case 'email.sent':
  if (!['delivered', 'bounced', 'complained'].includes(message.status)) {
    update.status = 'sent';
  }

  if (data.message_id) {
    update.message_id = data.message_id;
  }
  break;

      case 'email.delivered':
        if (!['bounced', 'complained'].includes(message.status)) {
          update.status = 'delivered';
          update.delivered_at = now;
        }
        break;

      case 'email.delivery_delayed':
        if (!['delivered', 'bounced', 'complained'].includes(message.status)) {
          update.status = 'delayed';
        }
        break;

      case 'email.bounced':
        update.status = 'bounced';
        update.bounced_at = now;
        break;

      case 'email.complained':
        update.status = 'complained';
        break;

      case 'email.failed':
        update.status = 'failed';
        break;

      case 'email.opened':
        update.first_opened_at = undefined;
        update.last_opened_at = now;
        update.open_count = (message.open_count || 0) + 1;
        break;

      case 'email.clicked':
        update.click_count = (message.click_count || 0) + 1;
        break;
    }

    // Remove undefined values so Supabase leaves existing columns untouched.
    Object.keys(update).forEach((key) => {
      if (update[key] === undefined) delete update[key];
    });

    const { error: updateError } = await supabase
      .from('email_messages')
      .update(update)
      .eq('id', message.id);

    if (updateError) {
      console.error('Webhook message update error:', updateError);
      return json(500, { error: 'Could not update email status' });
    }

    // Set first_opened_at only once.
    if (eventType === 'email.opened' && !message.first_opened_at) {
      await supabase
        .from('email_messages')
        .update({ first_opened_at: now })
        .eq('id', message.id)
        .is('first_opened_at', null);
    }

    return json(200, { ok: true, matched: true });

  } catch (error) {
    console.error('email-webhook error:', error);
    return json(500, { error: 'Webhook processing failed' });
  }
};
