
const {
  json,
  safeEqual,
  createSessionCookie
} = require('./_shared/admin');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const expected = process.env.PRECIFIO_ADMIN_TOKEN;
    const { token } = JSON.parse(event.body || '{}');

    if (!expected || !token || !safeEqual(expected, token)) {
      return json(401, { error: 'Invalid admin password' });
    }

    return json(200, { ok: true }, {
      'Set-Cookie': createSessionCookie()
    });

  } catch (error) {
    console.error('Admin login error:', error);
    return json(400, { error: 'Invalid login request' });
  }
};
