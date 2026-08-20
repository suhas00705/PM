# PM Portal — Push to GitHub (Windows / PowerShell)

This package contains the complete PulseBoard / PM Portal source, including the
**search box + collapsible filters dropdown** added to the Leads and Potentials tabs.

> **Nothing has been pushed.** The Claude session that prepared this package is blocked
> from pushing by its Git proxy, so every command below runs on **your** machine.

---

## ⚠️ Read this first — pick the right path

The brief described the target repo as "new/empty". That is **not** true of
`Project_management_elmeasure` — it already contains the full project history
(latest upstream commit `3e54a8b`), and it is the repo currently wired to Vercel.

Choose the path that matches your situation:

| Situation | Use |
|---|---|
| Pushing updates to the **existing** `Project_management_elmeasure` repo | **Path A** (recommended) |
| Pushing into a genuinely **empty new** repo, e.g. `PM-portal` | **Path B** |

Using Path B against a repo that already has history will be rejected as a
non-fast-forward, and forcing it would destroy the existing history. Don't force it.

---

## Step 0 — Extract the package

```powershell
cd $HOME\Downloads
Expand-Archive -Path .\PM-portal-ready.zip -DestinationPath $HOME\Projects\PM-portal -Force
cd $HOME\Projects\PM-portal
dir
```

---

# Path A — Push to the existing `Project_management_elmeasure` repo

This preserves upstream history and replays only the new work on top of it.

### A1. Clone a fresh copy of the real repo (in a separate folder)

```powershell
cd $HOME\Projects
git clone https://github.com/suhas00705/Project_management_elmeasure.git pm-live
cd pm-live
git pull
```

### A2. Copy the updated source over the clone

```powershell
$src = "$HOME\Projects\PM-portal"
$dst = "$HOME\Projects\pm-live"

Copy-Item "$src\index.html"                  "$dst\" -Force
Copy-Item "$src\.gitignore"                  "$dst\" -Force
Copy-Item "$src\vercel.json"                 "$dst\" -Force
Copy-Item "$src\package.json"                "$dst\" -Force
Copy-Item "$src\api\*"                       "$dst\api\"  -Recurse -Force
Copy-Item "$src\lib\*"                       "$dst\lib\"  -Recurse -Force
Copy-Item "$src\GITHUB_PUSH_INSTRUCTIONS.md" "$dst\" -Force
```

### A3. Confirm the remote is correct

```powershell
git remote -v
```

Expected:

```
origin  https://github.com/suhas00705/Project_management_elmeasure.git (fetch)
origin  https://github.com/suhas00705/Project_management_elmeasure.git (push)
```

### A4. Review exactly what changed

```powershell
git status
git diff --stat
```

You should see `index.html` and `.gitignore` as modified. `index.html` will show as a
tiny line-count change (`2 insertions, 2 deletions`) — that is expected: each dashboard
is stored as a single base64-encoded line inside `index.html`, so a whole-dashboard
change reads as one changed line per dashboard.

### A5. Commit and push

```powershell
git add .
git commit -m "Add search box and collapsible filters dropdown to Leads and Potentials tabs"
git push -u origin main
```

If your default branch is `master` rather than `main`, substitute it:

```powershell
git branch --show-current
git push -u origin master
```

---

# Path B — Push into a genuinely empty new repo (e.g. `PM-portal`)

Only use this when the target repo has **no commits at all**.

```powershell
cd $HOME\Projects\PM-portal

git init
git branch -M main
git add .
git commit -m "Initial project setup"

git remote add origin https://github.com/suhas00705/PM-portal.git
git remote -v
git status

git push -u origin main
```

To target `Project_management_elmeasure` instead (again: only if it is truly empty):

```powershell
git remote add origin https://github.com/suhas00705/Project_management_elmeasure.git
git push -u origin main
```

---

## Step — Dependencies

There is **nothing to install**. This project has no runtime dependencies and no build step:

- `package.json` declares no `dependencies` and no `devDependencies`
- there is no bundler, no TypeScript, no framework
- `index.html` is a single self-contained file served statically
- `api/*.js` are Vercel serverless functions using only built-in `fetch`

`npm install` is therefore optional and will simply do nothing:

```powershell
node --version    # must be 18 or newer
npm install       # optional; no packages to fetch
```

---

## Step — Environment variables

**Do not create a `.env` file for production.** These are set in the Vercel dashboard at
*Project → Settings → Environment Variables*. They are already configured on the existing
deployment; you only need to re-enter them if you deploy a brand-new Vercel project.

| Variable | Required | Purpose |
|---|---|---|
| `ZOHO_CLIENT_ID` | yes | Zoho OAuth client ID |
| `ZOHO_CLIENT_SECRET` | yes | Zoho OAuth client secret |
| `ZOHO_REFRESH_TOKEN` | yes | Long-lived Zoho refresh token |
| `ZOHO_ACCOUNTS_DOMAIN` | no | Defaults to `https://accounts.zoho.com` (use `.in` / `.eu` if your org is regional) |
| `ZOHO_API_DOMAIN` | no | Defaults to `https://www.zohoapis.com` |

If you want to run the functions locally with `vercel dev`, create a **local-only**
`.env.local` (already covered by `.gitignore`, so it can never be committed):

```powershell
@"
ZOHO_CLIENT_ID=your_client_id_here
ZOHO_CLIENT_SECRET=your_client_secret_here
ZOHO_REFRESH_TOKEN=your_refresh_token_here
ZOHO_ACCOUNTS_DOMAIN=https://accounts.zoho.com
ZOHO_API_DOMAIN=https://www.zohoapis.com
"@ | Out-File -FilePath .env.local -Encoding utf8

# verify it is ignored by git — this must print nothing:
git check-ignore -v .env.local
```

Replace the placeholders with real values. **Never commit this file.**

---

## Step — Verify the deploy

Once pushed, if the repo is linked to Vercel it will auto-deploy within a minute or two.

```powershell
git log --oneline -3
```

Then check the Vercel dashboard for the new deployment, and confirm on the live site that:

1. The **Leads** tab shows a search box and a `Filters ▾` button.
2. Typing in the search box narrows the table live.
3. Clicking `Filters ▾` opens the filter panel; clicking outside closes it.
4. The same works on the **Potentials** tab.

---

## Troubleshooting

**`error: failed to push some refs` / non-fast-forward**
The remote has commits yours don't. Use Path A. Never `--force` this repo.

**`fatal: remote origin already exists`**

```powershell
git remote set-url origin https://github.com/suhas00705/Project_management_elmeasure.git
```

**Push asks for a password**
GitHub no longer accepts account passwords. Use a Personal Access Token as the password,
or install Git Credential Manager (bundled with Git for Windows) and authenticate in the browser.

**GitHub push protection blocks the push**
Check that no `.env` file was staged: `git ls-files | Select-String "\.env"` should print nothing.
