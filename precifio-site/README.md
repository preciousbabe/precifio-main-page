# PRECIFIO AI SOLUTIONS — Multi-Page Website

Plain HTML / CSS / JS. No build step. Just open `index.html` or deploy the folder statically.

## Pages
| File | Purpose |
|---|---|
| `index.html` | Home — three revenue engines, proof-of-capability, roadmap |
| `services.html` | Full AI services menu (9 service lines) |
| `build.html` | "Build With Precifio" — Prototype / MVP / Custom System packages + à-la-carte |
| `products.html` | Extract, Calculators, Notes — each with "custom build" CTAs |
| `partners.html` | White-label, subcontractor & referral models |
| `about.html` | Mission, values, story |
| `contact.html` | Support channels + project intake form |

## Brand
- Palette extracted from the official logo: deep blue `#0A53FF`, blue `#2E7CFF`, sky `#5EA8FF`, light `#9CC8FF`, navy `#0A1F5C`.
- Logo lives in `assets/logo.png` (also used for the favicon).

## Contact form wiring
The form in `contact.html` posts JSON to `/api/contact`. A ready Node backend is in `server/`:

```bash
cd server
cp .env.example .env   # fill in your keys
npm install
npm start              # listens on :3001
```

Then either:
- proxy `/api` to `localhost:3001` from your web server (nginx/vercel/netlify function), **or**
- change `data-endpoint="/api/contact"` on the form to your full URL, e.g. `https://api.precifio.app/api/contact`.

If the endpoint is unreachable, the form automatically falls back to opening a prefilled
email to hello@precifio.app — so no lead is ever lost.

### Supabase table for leads
```sql
create table leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text,
  service text not null,
  budget text,
  message text not null,
  created_at timestamptz default now()
);
```

### Resend
Use your verified sending domain as the `from` address in `server/index.js`
(default shown uses Resend's test domain).

## Deploy
Static files only for the frontend — Netlify, Vercel, GitHub Pages, Cloudflare Pages,
or any nginx/Apache host all work as-is. Deploy `server/` separately (Railway, Render,
VPS, etc.).


## Backend Option A (recommended): Supabase Edge Function — no Node server needed

Your old support page used `mailto:` links (no backend at all). The new intake form posts
JSON to an endpoint; this Edge Function IS that endpoint, living inside your existing Supabase
project.

1. In Supabase dashboard → SQL Editor, run:
   ```sql
   create table leads (
     id uuid primary key default gen_random_uuid(),
     name text not null, email text not null, company text,
     service text not null, budget text, message text not null,
     created_at timestamptz default now()
   );
   ```
2. Install the Supabase CLI (one time): `npm install -g supabase`
3. From the `precifio-site` folder:
   ```bash
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase secrets set RESEND_API_KEY=re_your_key
   supabase functions deploy contact
   ```
4. In `contact.html`, replace `YOUR-PROJECT-REF` in the form's `data-endpoint`
   with your real project ref:
   `https://YOUR-PROJECT-REF.supabase.co/functions/v1/contact`

> The `from` address (`hello@precifio.app`) must be a domain verified in Resend.
> If the endpoint is unreachable, the form falls back to opening a prefilled email.

## Backend Option B: Node server (in `/server`)

See `/server/README` steps: `npm install`, fill `.env`, deploy to Railway/Render.
Only needed if you prefer a standalone server over Supabase Edge Functions.
