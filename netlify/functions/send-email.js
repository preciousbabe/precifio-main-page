
const { createClient } = require('@supabase/supabase-js');
const { isAdmin, json } = require('./_shared/admin');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_SENDERS = [
  'hello@precifio.app',
  'support@precifio.app'
];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!isAdmin(event)) {
    return json(401, { error: 'Unauthorized' });
  }

  let savedMessage;

  try {
    const {
      lead_id,
      subject,
      body_text,
      body_html,
      from_email = 'hello@precifio.app'
    } = JSON.parse(event.body || '{}');

    if (!lead_id || !subject || (!body_text && !body_html)) {
      return json(400, {
        error: 'lead_id, subject and an email body are required'
      });
    }

    if (!ALLOWED_SENDERS.includes(String(from_email).toLowerCase())) {
      return json(400, { error: 'Invalid sender address' });
    }

    if (
      typeof subject !== 'string' ||
      subject.length > 200 ||
      /[\r\n]/.test(subject)
    ) {
      return json(400, { error: 'Invalid subject' });
    }

    if (
      (body_text && String(body_text).length > 100000) ||
      (body_html && String(body_html).length > 200000)
    ) {
      return json(400, { error: 'Email body is too long' });
    }

    // Get the recipient from the saved lead.
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, name, email')
      .eq('id', lead_id)
      .single();

    if (leadError || !lead) {
      return json(404, { error: 'Lead not found' });
    }

    const recipient = String(lead.email).trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return json(400, { error: 'Lead has an invalid email address' });
    }

    // Save the message before sending, so failed attempts are recorded.
    const { data: message, error: insertError } = await supabase
      .from('email_messages')
      .insert({
        lead_id: lead.id,
        direction: 'outbound',
        provider: 'resend',
        from_email,
        to_email: recipient,
        subject,
        body_text: body_text || null,
        body_html: body_html || null,
        status: 'queued'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Email record insert error:', insertError);
      return json(500, { error: 'Could not record email' });
    }

    savedMessage = message;

    const resendResponse = await fetch(
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `Precifio <${from_email}>`,
          to: [recipient],
          subject,
          text: body_text || undefined,
          html: body_html || undefined
        })
      }
    );

    const resendData = await resendResponse.json();

    if (!resendResponse.ok || !resendData.id) {
      await supabase
        .from('email_messages')
        .update({ status: 'failed' })
        .eq('id', savedMessage.id);

      console.error('Resend send error:', resendData);

      return json(502, {
        error: 'Resend could not send the email',
        message_id: savedMessage.id
      });
    }

    const sentAt = new Date().toISOString();

    const { error: updateError } = await supabase
      .from('email_messages')
      .update({
        provider_email_id: resendData.id,
        status: 'sent',
        sent_at: sentAt,
        last_event_at: sentAt
      })
      .eq('id', savedMessage.id);

    if (updateError) {
      console.error('Email record update error:', updateError);

      // Resend accepted the email, even though recording its ID failed.
      return json(202, {
        ok: true,
        warning: 'Email was accepted, but its tracking record needs reconciliation',
        resend_email_id: resendData.id,
        message_id: savedMessage.id
      });
    }

    return json(200, {
      ok: true,
      message_id: savedMessage.id,
      resend_email_id: resendData.id,
      status: 'sent'
    });

  } catch (error) {
    console.error('send-email error:', error);

    if (savedMessage) {
      await supabase
        .from('email_messages')
        .update({ status: 'failed' })
        .eq('id', savedMessage.id);
    }

    return json(500, { error: 'Server error while sending email' });
  }
};
