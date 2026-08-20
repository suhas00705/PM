# Pushing PM Portal to `suhas00705/PM`

**Target repo:** https://github.com/suhas00705/PM — confirmed to exist, public, **and completely empty (zero commits)**.
**Source folder:** `C:\Users\suhas.s\Downloads\PMportalready` — no `.git` folder yet, so this will be a fresh `git init`.

Because the target repo is genuinely empty, this is the simple path: init locally, add the remote, push. No cloning, no merge conflicts, no force-push.

> The `GITHUB_PUSH_INSTRUCTIONS.md` already sitting in that folder is **out of date**. It was written for the old `Project_management_elmeasure` repo and tells you to extract a zip that no longer applies. Ignore it — this document replaces it.

---

## ⚠️ Step 0 — Read this before you push (the repo is public)

Seven files hard-code your Supabase project URL and anon key directly in the source:

| File | Line |
|---|---|
| `lib/supabaseLeads.js` | 3 |
| `lib/supabasePotentials.js` | 3 |
| `api/pm-order-details.js` | 8 |
| `api/sync-potentials-qty.js` | 4 |
| `api/sync-pm-lastyear.js` | 4 |
| `api/sync-pm-prepaid.js` | 4 |
| `api/sync-pm-baskets.js` | 23 |

The key is `xfdfbrfudsaxqgpsdboa.supabase.co` + an `anon` JWT valid until 2036.

A Supabase *anon* key is normally safe to expose — **but only when Row Level Security is switched on**. Your code uses that same key to `DELETE` and `POST` rows in `PM_Desk`, `leads_cache` and `potentials_cache`. If those inserts and deletes succeed today, RLS is either off or wide open, which means anyone who reads your public repo can wipe or rewrite your dashboard tables.

**Your Zoho credentials are fine** — `lib/zohoAuth.js` reads them from `process.env`, nothing is hard-coded. Only Supabase is exposed.

Pick one before pushing:

- **Flip the repo to private** (Settings → General → Change visibility). One click, done, and everything below still works.
- **Enable RLS on Supabase** so the anon key can only read, and use a `service_role` key from a Vercel env var for the writes. Correct fix, more work.
- **Move the URL + key into env vars** so at least they aren't in git history. Helps, but the deployed key is still reachable — this alone is not enough if RLS is off.
- **Push public as-is**, accepting the risk. Only sensible if you've already confirmed RLS is locked down.

Ask me and I'll do the env-var refactor across all seven files for you.

---

## Step 1 — Move the project out of Downloads (recommended)

`Downloads` is a scratch folder — it gets cleaned out, synced, and re-downloaded over. Give the repo a permanent home:

```powershell
New-Item -ItemType Directory -Force -Path $HOME\Projects
Move-Item $HOME\Downloads\PMportalready $HOME\Projects\PM
cd $HOME\Projects\PM
dir
```

You should see: `api`, `lib`, `index.html`, `package.json`, `vercel.json`, `.gitignore`, `README.md`.

If you'd rather not move it, just use `cd $HOME\Downloads\PMportalready` everywhere below instead.

> If you do move it, tell me — I'll need to re-request folder access to keep helping with the files.

---

## Step 2 — Confirm git is installed

```powershell
git --version
```

Expect something like `git version 2.4x.x.windows.1`.

If it errors, install Git for Windows from https://git-scm.com/download/win — accept all defaults. That bundle includes **Git Credential Manager**, which is what handles your GitHub sign-in in Step 4. Close and reopen PowerShell afterwards.

---

## Step 3 — Set your identity (once per machine)

Every commit is stamped with this. Use the email tied to your GitHub account so commits link to your profile.

```powershell
git config --global user.name  "Suhas S"
git config --global user.email "your-github-email@example.com"
git config --global init.defaultBranch main
```

Check it:

```powershell
git config --global --list
```

---

## Step 4 — Initialise, commit, and push

```powershell
cd $HOME\Projects\PM

git init
git branch -M main
git add .
git status
```

**Stop and read `git status` before committing.** You should see 19 files (6 in the root, 10 under `api\`, 3 under `lib\`). You should **not** see `.env`, `.env.local`, `node_modules/`, `extracted/` or `verify/` — your `.gitignore` already covers all of those. Confirm with:

```powershell
git ls-files | Select-String "\.env"
```

That must print nothing. If it prints anything, stop and remove it with `git rm --cached <file>` before continuing.

Now commit and push:

```powershell
git commit -m "Initial commit: PM Portal dashboard, Zoho sync functions and Vercel config"

git remote add origin https://github.com/suhas00705/PM.git
git remote -v

git push -u origin main
```

On the first push a browser window opens for GitHub sign-in (Git Credential Manager). Sign in, approve, and it remembers you from then on. If it instead asks for a username and password at the prompt, GitHub will reject your account password — see Troubleshooting.

Verify: refresh https://github.com/suhas00705/PM and you should see all the files.

---

## Step 5 — Re-point Vercel at the new repo

Right now your Vercel project deploys from `Project_management_elmeasure`. Until you change this, pushing to `PM` deploys nothing.

1. Open https://vercel.com/dashboard and select the project behind `project-management-elmeasure.vercel.app`.
2. **Settings** (left sidebar) → **Git**.
3. Under **Connected Git Repository**, click **Disconnect**.
4. Click **Connect Git Repository** and pick `suhas00705/PM`.
   - If `PM` isn't in the list, click **Adjust GitHub App Permissions** and grant the Vercel GitHub app access to it.
5. Confirm **Production Branch** is `main` (Settings → Environments → Production → Branch Tracking).

**What survives the disconnect:** environment variables, your `.vercel.app` domain, any custom domain, and deployment history. You are re-pointing the same project, not creating a new one — so `project-management-elmeasure.vercel.app` keeps working and you don't re-enter any secrets.

**What to re-check:** the cron jobs in `vercel.json`. They re-register from the file on the next production deploy, but confirm all 14 are listed under **Settings → Cron Jobs** once the deploy finishes.

Then trigger the first deploy from the new repo:

```powershell
git commit --allow-empty -m "Trigger first deploy from PM repo"
git push
```

Watch it build in the Vercel dashboard, then load the live URL and click through **Leads**, **Potentials** and **PM Review** to confirm data still loads.

---

## Step 6 — Environment variables (reference)

These live in Vercel (**Settings → Environment Variables**), not in the repo. They're already set on the existing project and survive the repo swap — this table is only for if you ever rebuild the project from scratch.

| Variable | Required | Purpose |
|---|---|---|
| `ZOHO_CLIENT_ID` | yes | Zoho OAuth client ID |
| `ZOHO_CLIENT_SECRET` | yes | Zoho OAuth client secret |
| `ZOHO_REFRESH_TOKEN` | yes | Long-lived Zoho refresh token |
| `ZOHO_ACCOUNTS_DOMAIN` | no | Defaults to `https://accounts.zoho.com` |
| `ZOHO_API_DOMAIN` | no | Defaults to `https://www.zohoapis.com` |

There are no npm dependencies and no build step — `package.json` declares none, `index.html` is a single self-contained file, and `api/*.js` use only built-in `fetch`. `npm install` is optional and does nothing.

---

## Step 7 — Your everyday workflow from here

Once set up, every change is three commands:

```powershell
cd $HOME\Projects\PM

git status                       # see what you changed
git add .
git commit -m "Describe what you changed"
git push
```

Vercel picks up the push and deploys within a minute or two.

Useful extras:

```powershell
git log --oneline -10            # recent history
git diff                         # what changed, not yet staged
git checkout -- index.html       # throw away changes to one file
git revert <commit-sha>          # safely undo a pushed commit
```

**A note on `index.html` diffs:** each dashboard is stored as one long base64-encoded line inside `PAYLOADS`. So a change to an entire dashboard shows up as a single changed line. `git diff --stat` reporting "2 insertions, 2 deletions" for a big change is expected, not a sign something went wrong.

**Safer changes:** work on a branch instead of pushing straight to `main`. Vercel builds a preview URL for every branch, so you can check it before it goes live.

```powershell
git checkout -b feature/my-change
# ...edit...
git add .
git commit -m "My change"
git push -u origin feature/my-change
# open the preview URL Vercel posts, then merge on github.com when happy
```

---

## Troubleshooting

**`fatal: remote origin already exists`**
```powershell
git remote set-url origin https://github.com/suhas00705/PM.git
```

**`error: failed to push some refs` / non-fast-forward**
The remote has commits yours don't (e.g. you added a README on github.com). Pull them in first:
```powershell
git pull origin main --allow-unrelated-histories
git push -u origin main
```
Never `--force` unless you're certain you want to discard what's on the remote.

**Push asks for a password and rejects it**
GitHub stopped accepting account passwords over HTTPS. Either let Git Credential Manager open the browser sign-in, or generate a Personal Access Token (github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens, scope: Contents read/write on `suhas00705/PM`) and paste the token as the password.

**GitHub push protection blocks the push**
It found a secret. Check what's staged: `git ls-files | Select-String "\.env"`. See Step 0 — the Supabase key is the likely trigger.

**`src refspec main does not match any`**
You haven't committed yet. Run `git add .` then `git commit -m "..."` first.

**Vercel doesn't deploy after a push**
Settings → Git — confirm `suhas00705/PM` is connected and the production branch matches the branch you pushed to.

**Cron jobs disappeared after the repo swap**
They re-register from `vercel.json` on the next *production* deploy. Push an empty commit (Step 5) to force one.

---

## What this project actually is

For context, since the README in the folder still describes an older self-hosted Express setup that no longer exists:

- **`index.html`** — the entire front end, one self-contained file. A top bar with **Leads / Potentials / PM Review** tabs, and seven dashboards (leads, potentials, cumulative, geo-leads, geo-potentials, cumulative-potentials, pm-review) each stored base64-encoded and injected into its own `<iframe srcdoc>`. The iframes keep the dashboards isolated from each other while still shipping as a single file, and they inherit the page origin so `/api/*` fetches resolve normally.
- **`api/leads.js`, `api/potentials.js`** — fast read endpoints. They don't touch Zoho; they serve pre-synced rows out of Supabase.
- **`api/sync-*.js`** — the overnight jobs that pull from Zoho CRM into Supabase, driven by the 14 cron entries in `vercel.json` (staggered from 02:00 UTC, with a second 08:00 UTC pass for prepaid and baskets). The larger ones use a 52-second time budget and a cursor row so they resume where they left off rather than dying at Vercel's 60-second limit.
- **`api/pm-order-details.js`** — the click-to-drill-down popup on PM Review's OB/Invoicing figures, reading pre-computed detail rows instead of querying Zoho live.
- **`api/verify-pm-month.js`** — a manual diagnostic: recomputes one basket/month straight from Zoho so you can check a figure you're suspicious of. Not on any cron.
- **`lib/zohoAuth.js`** — refreshes the Zoho access token from the env vars.
- **`lib/supabaseLeads.js`, `lib/supabasePotentials.js`** — the Supabase read/write helpers.

Worth fixing at some point: `README.md` and `GITHUB_PUSH_INSTRUCTIONS.md` are both stale, and `package.json` still calls the project `pulseboard` v2.0.0. Cosmetic, but on a public repo they're the first thing anyone reads.
