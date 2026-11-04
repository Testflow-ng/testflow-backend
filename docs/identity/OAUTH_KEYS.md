# OAuth keys and settings Testflow needs

Two features, two different sets of keys.

1. **Continue with Google** (main Testflow and Testflow for Everyone).
2. **Log in with Testflow** (an organisation's own site lets a person sign in with their main Testflow
   account, with an authorize page like GitHub's).

Never commit real values. They go in the backend host's environment (Render) and in `backend/.env` locally.

---

## 1. Continue with Google

Nothing exists in the code yet. The owner of the Google account that owns the project does these steps in
https://console.cloud.google.com :

1. Create a project (for example "Testflow").
2. **APIs & Services → OAuth consent screen**
   - User type: External.
   - App name: Testflow. Support email: the support address.
   - App logo: the Testflow logo (120×120 px).
   - App domain links: home `https://testflow.com.ng`, privacy `https://testflow.com.ng/privacy`,
     terms `https://testflow.com.ng/terms`.
   - Authorized domains: `testflow.com.ng`.
   - Scopes: `openid`, `email`, `profile` only. Nothing sensitive, so no Google review is needed.
   - Publishing status: **In production** (while it says "Testing", only listed test users can sign in).
3. **Credentials → Create credentials → OAuth client ID → Web application**
   - Authorized JavaScript origins:
     - `https://testflow.com.ng`
     - `http://localhost:5173`
   - Authorized redirect URIs (Google does not allow wildcards, so every organisation site uses the same
     one; the backend hands the person back to the right site afterwards):
     - `https://api.testflow.com.ng/api/auth/google/callback`
     - `http://localhost:5000/api/auth/google/callback`
4. Copy the two values Google shows once.

### Values to give the backend developer

| Variable | What it is | Where it comes from |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Public client id, ends in `.apps.googleusercontent.com` | Google Cloud, Credentials |
| `GOOGLE_CLIENT_SECRET` | Secret. Server only, never in the frontend | Google Cloud, Credentials |
| `GOOGLE_REDIRECT_URI` | `https://api.testflow.com.ng/api/auth/google/callback` (local: `http://localhost:5000/api/auth/google/callback`) | Must match the console exactly, character for character |

The frontend needs only `GOOGLE_CLIENT_ID`, and only if the Google button uses Google's own script. If the
backend does the whole redirect (recommended), the frontend needs no Google key.

---

## 2. Log in with Testflow

The backend already has this: `POST /api/auth/oauth/authorize` and `POST /api/auth/oauth/token`, with PKCE
and one-time codes. It stays switched off until at least one client is allowed.

| Variable | What it is |
|---|---|
| `AUTH_CLIENTS` | JSON list of allowed apps. Example below. Empty means every client is refused. |

```json
[
  {
    "id": "testflow-everyone",
    "redirectUris": [
      "https://api.testflow.com.ng/api/auth/testflow/callback",
      "http://localhost:5000/api/auth/testflow/callback"
    ]
  }
]
```

Rules the backend already enforces: redirect URIs must match exactly, must use https (local http only
outside production), and must not carry a fragment.

No Google-style secret is needed, because the organisation sites are the same Testflow app and use PKCE.

---

## 3. Settings both features depend on

| Variable | Value |
|---|---|
| `CLIENT_URL` | `https://testflow.com.ng` (main app) |
| Cookies | The refresh cookie must work on organisation hosts such as `x.testflow.com.ng` and custom domains. Cross-site cookies need `SameSite=None; Secure`, so check `config/cookies.js`. |
| CORS | The API must allow each organisation host that signs people in. |
| Custom domains | A custom domain cannot be a Google redirect URI, which is why the single shared callback above is used. |

---

## 4. What I need back

- Confirmation the OAuth consent screen is **In production**.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, sent to the backend developer privately (not in chat or git).
- The production API host (`api.testflow.com.ng` assumed).
