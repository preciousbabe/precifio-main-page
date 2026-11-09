
const loginPanel = document.getElementById('loginPanel');
const appPanel = document.getElementById('appPanel');

const loginForm = document.getElementById('loginForm');
const adminToken = document.getElementById('adminToken');
const loginButton = document.getElementById('loginButton');
const loginNotice = document.getElementById('loginNotice');

const emailForm = document.getElementById('emailForm');
const leadSelect = document.getElementById('leadSelect');
const leadDetails = document.getElementById('leadDetails');
const leadCount = document.getElementById('leadCount');

const sendButton = document.getElementById('sendButton');
const sendNotice = document.getElementById('sendNotice');

const addProspectButton = document.getElementById('addProspectButton');
const addProspectPanel = document.getElementById('addProspectPanel');
const addProspectForm = document.getElementById('addProspectForm');
const saveProspectButton = document.getElementById('saveProspectButton');
const cancelProspectButton = document.getElementById('cancelProspectButton');
const prospectNotice = document.getElementById('prospectNotice');


let leads = [];

function showNotice(element, message, type = '') {
  element.textContent = message;
  element.className = `notice ${type}`;
}

function hideNotice(element) {
  element.classList.add('hidden');
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.headers || {})
    }
  });

  let data = {};

  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function showApp() {
  loginPanel.classList.add('hidden');
  appPanel.classList.remove('hidden');
}

function showLogin() {
  appPanel.classList.add('hidden');
  loginPanel.classList.remove('hidden');
}

async function loadLeads() {
  leadCount.textContent = 'Loading prospects...';
  document.getElementById('refreshButton').disabled = true;

  try {
    const data = await api('/.netlify/functions/list-leads');

    leads = data.leads || [];

    leadSelect.replaceChildren(
      new Option('Choose a prospect', '')
    );

    leads.forEach((lead) => {
      const label = `${lead.name} — ${lead.email}`;
      leadSelect.add(new Option(label, lead.id));
    });

    leadCount.textContent = `${leads.length} prospects loaded`;

    leadDetails.classList.add('hidden');

  } catch (error) {
    if (error.message === 'Unauthorized') {
      showLogin();
      return;
    }

    leadCount.textContent = error.message;
  } finally {
    document.getElementById('refreshButton').disabled = false;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  loginButton.disabled = true;
  loginButton.textContent = 'Signing in...';
  hideNotice(loginNotice);

  try {
    await api('/.netlify/functions/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: adminToken.value })
    });

    adminToken.value = '';
    showApp();
    await loadLeads();

  } catch (error) {
    showNotice(loginNotice, error.message, 'error');
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Sign in';
  }
});

leadSelect.addEventListener('change', () => {
  const lead = leads.find(item => item.id === leadSelect.value);

  if (!lead) {
    leadDetails.classList.add('hidden');
    return;
  }

  leadDetails.replaceChildren();

  const lines = [
    ['Name', lead.name],
    ['Email', lead.email],
    ['Company', lead.company],
    ['Service', lead.service],
    ['Budget', lead.budget]
  ];

  lines.forEach(([label, value]) => {
    const line = document.createElement('div');
    const strong = document.createElement('strong');

    strong.textContent = `${label}: `;
    line.append(strong, document.createTextNode(value || '—'));
    leadDetails.appendChild(line);
  });

  leadDetails.classList.remove('hidden');
});

emailForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const leadId = leadSelect.value;

  if (!leadId) {
    showNotice(sendNotice, 'Please select a prospect.', 'error');
    sendNotice.classList.remove('hidden');
    return;
  }

  sendButton.disabled = true;
  sendButton.textContent = 'Sending...';
  hideNotice(sendNotice);

  try {
    const result = await api('/.netlify/functions/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: leadId,
        from_email: document.getElementById('fromEmail').value,
        subject: document.getElementById('subject').value.trim(),
        body_text: document.getElementById('bodyText').value
      })
    });

    showNotice(
      sendNotice,
      `Email accepted by Resend. Resend ID: ${result.resend_email_id}`,
      'success'
    );

    document.getElementById('subject').value = '';
    document.getElementById('bodyText').value = '';

  } catch (error) {
    showNotice(sendNotice, error.message, 'error');
  } finally {
    sendNotice.classList.remove('hidden');
    sendButton.disabled = false;
    sendButton.textContent = 'Send email';
  }
});

document.getElementById('refreshButton').addEventListener(
  'click',
  loadLeads
);

document.getElementById('logoutButton').addEventListener(
  'click',
  async () => {
    try {
      await api('/.netlify/functions/admin-logout', {
        method: 'POST'
      });
    } finally {
      leads = [];
      showLogin();
    }
  }
);



addProspectButton.addEventListener('click', () => {
  addProspectPanel.classList.remove('hidden');
  hideNotice(prospectNotice);
  document.getElementById('prospectName').focus();
});

cancelProspectButton.addEventListener('click', () => {
  addProspectForm.reset();
  addProspectPanel.classList.add('hidden');
  hideNotice(prospectNotice);
});

addProspectForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  saveProspectButton.disabled = true;
  saveProspectButton.textContent = 'Saving...';
  hideNotice(prospectNotice);

  try {
    const result = await api('/.netlify/functions/add-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('prospectName').value.trim(),
        email: document.getElementById('prospectEmail').value.trim(),
        company: document.getElementById('prospectCompany').value.trim(),
        service: document.getElementById('prospectService').value.trim(),
        notes: document.getElementById('prospectNotes').value.trim()
      })
    });

    await loadLeads();

    // Automatically select the prospect we just saved.
    leadSelect.value = result.lead.id;
    leadSelect.dispatchEvent(new Event('change'));

    addProspectForm.reset();
    addProspectPanel.classList.add('hidden');

    showNotice(
      sendNotice,
      `${result.lead.name} has been saved and selected. You can now compose an email.`,
      'success'
    );

    sendNotice.classList.remove('hidden');

  } catch (error) {
    showNotice(prospectNotice, error.message, 'error');
    prospectNotice.classList.remove('hidden');
  } finally {
    saveProspectButton.disabled = false;
    saveProspectButton.textContent = 'Save Prospect';
  }
});


// Check whether an existing session is valid.
(async function init() {
  try {
    await api('/.netlify/functions/list-leads');
    showApp();
    await loadLeads();
  } catch {
    showLogin();
  }
})();
