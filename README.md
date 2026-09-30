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

Open http://localhost:3000. No API key or database is required. There are no third-party runtime dependencies.

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
