# Clinical

A simple clinical study search interface backed by the public ClinicalTrials.gov v2 API. Search conditions, treatments, locations, and recruitment status; browse paginated results and open study details with eligibility criteria and contacts.

## Run locally

Use Node.js 22 or 24.

```sh
npm ci
npm run build
npm test
npm start
```

Open http://localhost:3000. Manual study search needs no API key or database. The optional assistant requires an OpenAI API key and a separate access password. There are no third-party runtime dependencies.

## Deploy on Render

- Name: Clinical
- Service: Web Service
- Language: Node
- Repository: LargeLow/clinical
- Branch: main
- Region: Oregon
- Root Directory: leave blank
- Build: `npm ci && npm run build`
- Start: `npm start`
- Compute: $7/month instance selected by the owner
- Health check: `/health`
- Set `NODE_VERSION` to `22` if Render's default runtime does not match the package engine range.

The server binds to `0.0.0.0` using Render's `PORT` environment variable. HTTPS is provided by Render. Connect through the Git provider for automatic deploys.

## Data behavior

API base: https://clinicaltrials.gov/api/v2

`GET /studies` searches, `GET /studies/{nctId}` retrieves full details. Search pages contain 20 results, ranked by relevance. The nextPageToken is passed as pageToken without changing the search filters. A short, bounded in-memory cache stores responses for five minutes. No visitor accounts, analytics, or persistent search history are collected. Study text is displayed as text, never injected as HTML; Markdown formatting in eligibility text is preserved as plain text.

ClinicalTrials.gov updates weekdays. Records may have missing fields, and recruitment status does not confirm individual eligibility. The interface links to the source record and directs users to study contacts. It is independent of ClinicalTrials.gov.

API reference: https://clinicaltrials.gov/data-api/api

## API routes

- `/api/studies?condition=diabetes&status=RECRUITING`
- `/api/studies/NCT01234567`
- `/health`

Requests have timeouts, inputs are validated, upstream failures are surfaced as readable errors. The backend only requests the fixed ClinicalTrials.gov API host.


## Nikki’s research workspace

Conversational onboarding covers territory, clinics, indications, investigators, study preferences and working preferences. AI preference changes are suggestions requiring acceptance. Manual searches support sponsor/collaborator, phase and study type. Blank location searches all countries; specify United States for US-site-only discovery. Shortlist up to 50 studies, export Excel-compatible CSV, and prepare source-linked Grok/Claude handoffs. Those handoffs copy/download text; there are no direct Grok, Claude, Microsoft 365 or corporate workspace integrations. External findings can be pasted back for discussion; no general web browsing or platform registration is performed by the assistant.

Preferences and shortlist are kept in memory for the visit unless the user selects Remember. That opt-in stores them in localStorage on that browser, not in a shared database. Conversations are session-only and the API receives at most the last ten messages. This is a single-person pilot, not a multi-user CRM or a PI registration tracker. No patient data is needed.

### Activate the AI on Render

Use the owner's joe@uptechprojects.com OpenAI Platform account. Create a dedicated Clinical project, enable API billing, and create a project API key. Put the key directly in Render's Environment settings, not in chat, browser frontend code or GitHub.

- `OPENAI_API_KEY`: project API key.
- `CLINICAL_ACCESS_PASSWORD`: a separate access password of at least 12 characters; shared only with intended users.
- `OPENAI_MODEL`: optional; defaults to `gpt-5-mini`.
- `AI_DAILY_REQUEST_LIMIT`: optional; defaults to 100 chat requests per UTC day per running process. Each search chat uses at most two model calls.

Save and redeploy, then unlock the assistant on the website. The API uses Responses with structured outputs, `store:false`, bounded message lengths, 2,500 output tokens per call and low reasoning effort. OpenAI's other retention policies still apply; `store:false` is not a zero-retention guarantee. Returned registry evidence is summarized with NCT identifiers. No patient recruitment or site acceptance is inferred from a recruiting status.

Sessions use signed, HttpOnly, Secure, SameSite=Strict cookies lasting 12 hours. Restarting the server invalidates sessions. Password login has a global 30-attempt hourly limit; chat has an eight-request minute limit and one concurrent request. Request counters are in memory and reset on restart; they are not durable dollar-budget enforcement. Monitor OpenAI usage and billing; persistent quota enforcement would require durable storage. The assistant stays disabled until both its API key and password are configured.

### Verification

`npm test` checks registry mapping, validation, proxy failures, AI configuration/authentication, same-origin request markers, mocked Responses output, registry-backed chat, request limits and key non-disclosure. A real AI completion requires the configured account and billing; mocks do not verify model access. Browser smoke checks cover search, shortlist, profile edits and handoff copying.

## Resumable onboarding and Joe's feedback inbox

Nine optional onboarding questions cover goals, territory, clinic/PI fit, workflow, pipeline, PI platforms, monitoring, outputs and build priorities. Answers can be reviewed and edited; confirmed assistant preferences are explicitly entered on the review screen. No chat transcript is shared automatically. Feedback has a preview and a separate Send to Joe action, with optional onboarding context. Joe has separate owner access; status and responses are visible to Nikki.

Required runtime setup:

- Attach a small persistent Render disk at `/var/data` and set `CLINICAL_DATA_DIR=/var/data`. This adds storage cost and disables zero-downtime deployments. Never set the path to the ordinary ephemeral project directory.
- Set `CLINICAL_ADMIN_PASSWORD` to a separate owner password, at least 12 characters. Do not reuse Nikki's assistant password.
- Set `RESEND_API_KEY` (send permission only) and `FEEDBACK_FROM` to a verified Resend sender, e.g. `joe@uptechprojects.com`. Email recipient is fixed server-side to `joe@uptechprojects.com`.

Runtime storage is a bounded, single-workspace JSON document, saved using serialized atomic replacement and file fsync. It is appropriate for this single-instance pilot, not multi-user concurrent work. Owner inbox access does not expose the complete onboarding/profile record; only submission context Nikki chose to include. Suggestion content should still contain only professional workflow information; the shared password is a pilot access mechanism, not a corporate identity system.

Feedback is saved first. Notifications are tracked as pending/failed/sent (sent means accepted by Resend, not guaranteed inbox delivery). Owner retry uses a stable Resend idempotency key. Resend's idempotency window still applies: after it expires, manually retrying an ambiguously failed send can produce another notification. There is no background retry or delivery-webhook integration in this version. Unconfigured storage returns an explicit error rather than silently using ephemeral files. Onboarding drafts are retained in this browser until overwritten; shared workspace saving is separate from the existing browser-only shortlist option. Locking access does not delete a local draft.

Tests cover independent access, persistence across restart, duplicate submissions, email failure/retry, concurrent writes, corrupt-file preservation and missing-storage behavior.
