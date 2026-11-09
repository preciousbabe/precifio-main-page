
const { createClient } = require('@supabase/supabase-js');
const { isAdmin, json } = require('./_shared/admin');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!isAdmin(event)) {
    return json(401, { error: 'Unauthorized' });
  }

  try {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, email, company, service, budget, message, created_at, type')
      .in('type', ['lead', 'prospect'])
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('List leads error:', error);
      return json(500, { error: 'Could not load leads' });
    }

    return json(200, {
      ok: true,
      leads: data || []
    });

  } catch (error) {
    console.error('List leads error:', error);
    return json(500, { error: 'Server error' });
  }
};
