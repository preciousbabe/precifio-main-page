
const crypto = require('crypto');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const { code, state, error } = params;

    if (error) {
      return {
        statusCode: 400,
        body: `Google authorisation failed: ${escapeHtml(error)}`
      };
    }

    if (!code || !state) {
      return { statusCode: 400, body: 'Missing OAuth code or state' };
    }

    const [timestamp, suppliedSignature] = state.split('.');
    const setupToken = process.env.PRECIFIO_ADMIN_TOKEN;

    const expectedSignature = crypto
      .createHmac('sha256', setupToken || '')
      .update(String(timestamp))
      .digest('hex');

    const a = Buffer.from(expectedSignature);
    const b = Buffer.from(suppliedSignature || '');

    if (
      !setupToken ||
      a.length !== b.length ||
      !crypto.timingSafeEqual(a, b) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 600
    ) {
      return { statusCode: 401, body: 'Invalid or expired OAuth state' };
    }

    const tokenResponse = await fetch(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          code,
          client_id: process.env.GMAIL_CLIENT_ID,
          client_secret: process.env.GMAIL_CLIENT_SECRET,
          redirect_uri: process.env.GMAIL_REDIRECT_URI,
          grant_type: 'authorization_code'
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Google token exchange failed:', tokenData);

      return {
        statusCode: 502,
        body: 'Google token exchange failed. Check your OAuth configuration.'
      };
    }

    if (!tokenData.refresh_token) {
      return {
        statusCode: 400,
        body: 'Google did not return a refresh token. Revoke the existing Precifio permission in your Google Account and authorise again.'
      };
    }

    const safeToken = escapeHtml(tokenData.refresh_token);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Precifio Gmail connected</title></head>
<body style="font-family:Arial;max-width:700px;margin:50px auto;padding:20px">
  <h2>Gmail authorisation successful</h2>
  <p>Copy this refresh token into your local .env file as GMAIL_REFRESH_TOKEN.</p>
  <textarea id="token" style="width:100%;height:100px">${safeToken}</textarea>
  <p><button onclick="navigator.clipboard.writeText(document.getElementById('token').value)">Copy refresh token</button></p>
  <p>Keep this token private. Do not share it or commit it to GitHub.</p>
</body>
</html>`
    };

  } catch (error) {
    console.error('gmail-callback error:', error);
    return { statusCode: 500, body: 'Gmail authorisation failed' };
  }
};
