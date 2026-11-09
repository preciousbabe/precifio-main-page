
const crypto = require('crypto');

exports.handler = async (event) => {
  const setupToken = process.env.PRECIFIO_ADMIN_TOKEN;

  if (!setupToken || event.queryStringParameters?.setup !== setupToken) {
    return {
      statusCode: 401,
      body: 'Unauthorized'
    };
  }

  const clientId = process.env.GMAIL_CLIENT_ID;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return {
      statusCode: 500,
      body: 'Missing Gmail OAuth environment variables'
    };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const value = String(timestamp);

  const signature = crypto
    .createHmac('sha256', setupToken)
    .update(value)
    .digest('hex');

  const state = `${value}.${signature}`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state
  });

  return {
    statusCode: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`
    },
    body: ''
  };
};
