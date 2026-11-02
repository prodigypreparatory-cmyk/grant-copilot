# Grant Copilot

A grant-writing and RFP-response workspace for nonprofits. It runs as a static website on GitHub Pages. You don't need a build step or a server.

## What it does

| Area | What you get |
|---|---|
| **Find Grants** | Search open federal opportunities on Grants.gov. Run an AI fit check (score, reasons, risks) and add good matches to the pipeline. You can save searches, and new results get flagged. Prospects from foundations and city or state programs can be added by hand. |
| **RFP Reader** | Paste text or load a PDF, Word, or text file. **Read with AI** pulls out the questions, word limits, deadline, award range, required attachments, budget rules, scoring, eligibility, and a fit summary. **Quick read** does the same offline with pattern matching. |
| **Drafts** | Claude drafts each answer from your Org Vault, your closest Answer Library matches (funded answers come first), and the RFP's scoring criteria. Drafts stay within the word or character limit, and each one lists the sources it used. Missing facts show up as red `⟦NEEDS: …⟧` markers, so nothing is made up. **Revise…** rewrites a draft from your instruction. **History** keeps the last 20 versions of each answer. If AI is off or fails, the original offline engine takes over. |
| **Pipeline** | A drag-and-drop board with these stages: Prospect → Reading RFP → Drafting → Review → Submitted → Awarded / Declined → Reporting. Moving a card to Submitted runs a **pre-submission check**: answers, gaps, limits, attachments, expired documents, budget rules, award range, SAM/UEI for federal grants, and sign-off. |
| **Reminders** | A banner for deadlines, report due dates, and expiring documents. Browser notifications at 14, 7, 3, and 1 days. A **calendar file (.ics)** with alarms, so your phone or Outlook reminds you even when the app is closed. |
| **Win / loss** | Win rate, dollars won vs. asked, results by funder, decline reasons, and which library answers appear in funded applications. |
| **Exports** | Word (.docx), PDF (print to PDF), **portal copy** (plain text with character counts and copy buttons), and Markdown. |
| **Cloud (optional)** | Supabase login, sync across devices, roles (owner / writer / reviewer / director), automatic snapshots, and private file storage for the Document Library. |

Org Vault, Documents, Answer Library, and Backup work the same way they did before. Existing browser data loads automatically, and old statuses are mapped to the new stages.

## 1. Publish on GitHub Pages

1. Upload every file in this folder to the repo root. Keep the `js/` and `supabase/` folders.
2. Go to repo **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, then branch `main`, folder `/ (root)`, and save.
3. The site goes live at `https://<user>.github.io/<repo>/` within a minute or two.

> GitHub Pages on a **private** repo needs a paid GitHub plan. On a free plan, make the repo public. The code contains no organization data. Everything you type is stored in your browser or your own Supabase project, never in the repo.

## 2. Turn on AI

You have two options.

**Quick (one person, one computer).** Open **Settings → AI drafting** and paste an Anthropic API key from [console.anthropic.com](https://console.anthropic.com). Then click **Test connection**. The key is saved only in that browser. It is never included in backups or sync.

**Safer (key stays on a server).** Set up cloud sync (step 3) and deploy the `claude-proxy` function:

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set ALLOWED_EMAILS=you@yourorg.org   # optional allow-list
supabase functions deploy claude-proxy
supabase functions deploy grants-proxy
```

Then set **Settings → AI drafting → Connection** to *Through my cloud account*.

Model choices: Sonnet 5.5 is the default (fast, strong writing), Opus 5.5 gives the highest quality, and Haiku 5.5 is the cheapest.

## 3. Turn on cloud sync, accounts, and file storage (optional, about 10 minutes)

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor → New query**. Paste in `supabase/schema.sql` and click **Run**.
3. Go to **Authentication → URL Configuration** and add your GitHub Pages URL as the Site URL and as a Redirect URL.
4. From **Project Settings → API**, copy the **Project URL** and the **anon public** key.
5. In the app, open **Settings → Cloud account**. Paste both values, click **Connect**, then **Create account** (or sign in).
6. The first sign-in uploads this browser's data as your workspace. On other devices, sign in to pull it down.

**Roles.** In Settings, owners can add members by email:

- **writer**: edits everything
- **reviewer**: can also approve
- **director**: can also approve and sign off
- **owner**: can also manage members

To make approval mandatory, turn on *Require reviewer approval and director sign-off* in Settings.

## 4. Grant search notes

The app calls the public Grants.gov API (`api.grants.gov/v1/api/search2`) directly from the browser. If your browser blocks the call (a cross-origin restriction), the page says so. Deploy `grants-proxy` (step 2) and tick **Use my Supabase grants-proxy function** in Settings.

## Files

```
index.html                 app shell, vault, documents, answer library, RFP reader, drafts
js/ai.js                   Claude client, AI drafting, revise, history, AI RFP reader, file loading
js/export.js               Word / PDF / portal copy / Markdown
js/pipeline.js             board, compliance check, sign-off, reminders, .ics, win/loss
js/search.js               Grants.gov search, AI fit check, saved searches, manual prospects
js/cloud.js                Supabase auth, sync, snapshots, roles, file storage
js/settings.js             Settings page
js/boot.js                 startup
supabase/schema.sql        tables, row-level security, storage bucket
supabase/functions/*       claude-proxy and grants-proxy edge functions
```

## Ground rules the app enforces

- AI is told to use only your vault and library facts. Anything missing becomes a `⟦NEEDS⟧` marker, and the pre-submission check blocks until every marker is resolved.
- You are the submitter. Read every answer and check every number against your own records.
