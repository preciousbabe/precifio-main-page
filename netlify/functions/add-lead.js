
const { createClient } = require('@supabase/supabase-js');
const { isAdmin, json } = require('./_shared/admin');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!isAdmin(event)) {
    return json(401, { error: 'Unauthorized' });
  }

  try {
    const {
      name,
      email,
      company,
      service,
      notes
    } = JSON.parse(event.body || '{}');

    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCompany = String(company || '').trim();
    const cleanService = String(service || '').trim();
    const cleanNotes = String(notes || '').trim();

    if (!cleanName || !cleanEmail) {
      return json(400, {
        error: 'Name and email address are required.'
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return json(400, {
        error: 'Please enter a valid email address.'
      });
    }

    // Prevent duplicate prospects by email.
    const { data: existing, error: lookupError } = await supabase
      .from('leads')
      .select('id, name, email')
      .ilike('email', cleanEmail)
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      console.error('Lead duplicate check error:', lookupError);
      return json(500, { error: 'Could not check existing prospects.' });
    }

    if (existing) {
      return json(409, {
        error: 'This email address is already in your leads list.',
        lead: existing
      });
    }

    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        name: cleanName,
        email: cleanEmail,
        company: cleanCompany || null,
        service: cleanService || 'General outreach',
        message: cleanNotes || 'Added manually from Precifio Email Outreach.',
        type: 'lead',
        fields: {
          source: 'manual_email_outreach',
          notes: cleanNotes
        }
      })
      .select('id, name, email, company, service, budget, message, created_at, type')
      .single();

    if (error) {
      console.error('Add lead error:', error);
      return json(500, { error: 'Could not save this prospect.' });
    }

    return json(201, {
      ok: true,
      lead
    });

  } catch (error) {
    console.error('Add lead error:', error);
    return json(400, { error: 'Invalid prospect details.' });
  }
};
