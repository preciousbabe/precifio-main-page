
const { createClient } = require('@supabase/supabase-js');
const { isAdmin, json } = require('./_shared/admin');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function decodeBody(value) {
  if (!value) return '';

  try {
    return Buffer.from(
      value.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');
  } catch {
    return '';
  }
}

function collectBodies(part, result = { text: '', html: '' }) {
  if (!part) return result;

  if (part.mimeType === 'text/plain' && part.body?.data) {
    result.text += decodeBody(part.body.data);
  }

  if (part.mimeType === 'text/html' && part.body?.data) {
    result.html += decodeBody(part.body.data);
  }

  for (const child of part.parts || []) {
    collectBodies(child, result);
  }

  return result;
}

function getHeader(headers, name) {
  return (headers || []).find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  )?.value || '';
}

function extractEmail(value) {
  const match = String(value || '').match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

async function getGmailAccessToken() {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error('Could not refresh Gmail access token');
  }

  return data.access_token;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Use POST' });
  }

  if (!isAdmin(event)) {
    return json(401, { error: 'Unauthorized' });
  }

  if (!process.env.GMAIL_REFRESH_TOKEN) {
    return json(400, { error: 'Gmail has not been connected yet' });
  }

  try {
    const accessToken = await getGmailAccessToken();

    const listResponse = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?' +
      new URLSearchParams({
        q: 'newer_than:30d -from:me -in:spam -in:trash',
        maxResults: '100'
      }),
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    const listData = await listResponse.json();

    if (!listResponse.ok) {
      console.error('Gmail list error:', listData);
      return json(502, { error: 'Could not list Gmail messages' });
    }

    let imported = 0;
    let skipped = 0;

    for (const item of listData.messages || []) {
      const detailResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );

      const email = await detailResponse.json();

      if (!detailResponse.ok) {
        skipped++;
        continue;
      }

      const headers = email.payload?.headers || [];

      const from = getHeader(headers, 'From');
      const to = getHeader(headers, 'To');
      const subject = getHeader(headers, 'Subject');
      const rfcMessageId = getHeader(headers, 'Message-ID');
      const inReplyTo = getHeader(headers, 'In-Reply-To');
      const references = getHeader(headers, 'References');

      const senderEmail = extractEmail(from);

      if (!senderEmail || senderEmail === 'hello@precifio.app' ||
          senderEmail === 'support@precifio.app') {
        skipped++;
        continue;
      }

      const bodies = collectBodies(email.payload);

      const receivedAt = email.internalDate
        ? new Date(Number(email.internalDate)).toISOString()
        : new Date().toISOString();

      // First try matching the reply to an outbound RFC Message-ID.
      const referenceIds = [
        inReplyTo,
        ...references.split(/\s+/)
      ].filter(Boolean);

      let matchedMessage = null;

      if (referenceIds.length) {
        const { data } = await supabase
          .from('email_messages')
          .select('id, lead_id')
          .eq('direction', 'outbound')
          .in('message_id', referenceIds)
          .limit(1);

        matchedMessage = data?.[0] || null;
      }

      // If no message-header match exists, match by sender email.
      let leadId = matchedMessage?.lead_id || null;

      if (!leadId) {
        const { data: lead } = await supabase
          .from('leads')
          .select('id')
          .ilike('email', senderEmail)
          .limit(1)
          .maybeSingle();

        leadId = lead?.id || null;
      }

      const { error: insertError } = await supabase
        .from('email_messages')
        .insert({
          lead_id: leadId,
          direction: 'inbound',
          provider: 'gmail',
          provider_email_id: email.id,
          message_id: rfcMessageId || null,
          from_email: senderEmail,
          to_email: extractEmail(to),
          subject: subject || '(No subject)',
          body_text: bodies.text || null,
          body_html: bodies.html || null,
          status: 'received',
          in_reply_to: inReplyTo || null,
          received_at: receivedAt
        });

      if (insertError?.code === '23505') {
        skipped++;
        continue;
      }

      if (insertError) {
        console.error('Gmail message insert error:', insertError);
        skipped++;
        continue;
      }

     if (matchedMessage?.id) {
  await supabase
    .from('email_messages')
    .update({ replied_at: receivedAt })
    .eq('id', matchedMessage.id);
}
      imported++;
    }

    return json(200, {
      ok: true,
      checked: (listData.messages || []).length,
      imported,
      skipped
    });

  } catch (error) {
    console.error('gmail-sync error:', error);
    return json(500, { error: 'Gmail synchronisation failed' });
  }
};
