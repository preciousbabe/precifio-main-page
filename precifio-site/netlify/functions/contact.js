// netlify/functions/contact.js

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hello@precifio.app';
const FROM_EMAIL = 'Precifio Website <hello@precifio.app>';

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };

    return entities[char];
  });
}

exports.handler = async (event) => {
  // Allow OPTIONS requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': 'https://precifio.app',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }

  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Allow': 'POST, OPTIONS'
      },
      body: JSON.stringify({
        error: 'Method not allowed'
      })
    };
  }

  try {
    const {
      name,
      email,
      company,
      service,
      budget,
      message
    } = JSON.parse(event.body || '{}');

    // Validate required fields
    if (!name || !email || !service || !message) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Missing required fields'
        })
      };
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Invalid email'
        })
      };
    }

    // ----------------------------------------
    // 1. Save lead to Supabase
    // ----------------------------------------

    const { error: dbError } = await supabase
      .from('leads')
      .insert([
        {
          name,
          email,
          company: company || null,
          service,
          budget: budget || null,
          message
        }
      ]);

    if (dbError) {
      console.error('Supabase insert error:', dbError);

      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Could not save your project request'
        })
      };
    }

    // ----------------------------------------
    // 2. Send email through Resend
    // ----------------------------------------

    const resendResponse = await fetch(
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [NOTIFY_EMAIL],
          reply_to: email,
          subject: `New Project Inquiry — ${service}`,
          html: `
            <h2>New project brief from Precifio website</h2>

            <p>
              <strong>Name:</strong> ${escapeHtml(name)}<br>
              <strong>Email:</strong> ${escapeHtml(email)}<br>
              <strong>Company:</strong> ${escapeHtml(company || '—')}<br>
              <strong>Service:</strong> ${escapeHtml(service)}<br>
              <strong>Budget:</strong> ${escapeHtml(budget || '—')}
            </p>

            <h3>Project Details</h3>

            <p>
              ${escapeHtml(message).replace(/\n/g, '<br>')}
            </p>
          `
        })
      }
    );

    if (!resendResponse.ok) {
      const resendError = await resendResponse.text();

      console.error('Resend error:', resendError);

      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Your request was saved, but the notification email could not be sent'
        })
      };
    }

    // ----------------------------------------
    // Success
    // ----------------------------------------

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: true
      })
    };

  } catch (error) {
    console.error('Contact function error:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Server error'
      })
    };
  }
};