# Demo PIM: product onboarding and retailer syndication

A dummy app and mock API for the Qyrus demo, built around the same flow Syndigo's Product Experience Cloud covers: bulk product import, validation against retailer requirements, bulk edits, and syndication of compliant records.

It uses generic names ("Demo PIM", "RetailerA", "RetailerB"), so nothing here claims to be a Syndigo screen.

## Deploy to Netlify
1. Put the folder in a Git repo and connect it to Netlify (or run `netlify deploy --prod` with the Netlify CLI). `netlify.toml` already sets the functions folder and the `/api/*` redirect.
2. Your site is then live at `https://<your-site>.netlify.app` and the API is at `https://<your-site>.netlify.app/api`.
3. Check it: open `https://<your-site>.netlify.app/api/health`. You should see `{"status":"UP", ...}`.

If you only drag and drop `index.html`, the UI still works in "local simulation" mode, but Qyrus API scripts need the deployed function, so use the Git or CLI route.

## API (base path `/api`)
| Method | Path | Purpose | Success |
|---|---|---|---|
| GET | `/health` | Service health | 200 |
| POST | `/imports` | Create import job. Body: `fileName`, `recordCount`, `retailer` | 202 |
| GET | `/imports/{jobId}` | Validation summary | 200 |
| GET | `/imports/{jobId}/rejections` | Sample rejected records | 200 |
| POST | `/records/bulk-edit` | Body: `jobId`, `operation`, `recordCount` | 200 |
| POST | `/syndications` | Body: `jobId`, `retailer` | 202 |
| GET | `/syndications/{syndicationId}` | Delivery status | 200 |
| GET | `/gtin/validate?gtin=` | GTIN-13 check digit validation | 200 |

Errors: 400 (bad file type, bad record count, unknown retailer or operation), 404 (unknown job), 409 (syndicating to a retailer the job wasn't validated against).

Rules: RetailerA rejects 4% of records, RetailerB rejects 7%. Results are derived from the job ID, so the UI and API always agree and the numbers are predictable: 50,000 records on RetailerA gives 48,000 valid and 2,000 rejected.

## UI element IDs (for Qyrus web scripts)
- Title: `Demo PIM – Product Onboarding`, with the "Import" tab selected on load
- Import: `fileName`, `recordCount`, `retailer`, `btnImport`, `importJobId`, `importStatus`
- Results: `resultsJobId`, `btnLoadResults`, `validCount`, `rejectedCount`, `qualityScore`, `reasonMessage`
- Bulk edit: `editJobId`, `editOperation`, `editCount`, `btnApplyEdit`, `updatedCount`, `auditId`
- Syndicate: `syndJobId`, `syndRetailer`, `btnSyndicate`, `syndStatus`, `recordsSent`, `recordsSkipped`, `syndicationId`

## Qyrus MCP prompt
Replace `<SITE>` with your Netlify URL.

```
In the Qyrus Demo team, go to the API service under the demoAPI project and create
the API scripts below, plus one web script, then build an end-to-end orchestration
flow named "Bulk Onboarding E2E".

BASE_URL: https://<SITE>.netlify.app/api

SCRIPT 1 (API): Health check
- GET {BASE_URL}/health
- Verify status code is 200 and "status" equals "UP"

SCRIPT 2 (API): Create bulk import job
- POST {BASE_URL}/imports
- Body: {"fileName": "catalog_50k.csv", "recordCount": 50000, "retailer": "RetailerA"}
- Verify status code is 202 and "status" equals "QUEUED"
- Store "jobId" in variable jobId

SCRIPT 3 (API): Validation results
- GET {BASE_URL}/imports/{jobId}
- Verify status code is 200 and "status" equals "COMPLETED"
- Store "validCount" in variable validCount and "rejectedCount" in variable rejectedCount
- Verify validCount equals 48000 and rejectedCount equals 2000
- Verify validCount + rejectedCount equals 50000

SCRIPT 4 (API): Data check on a rejected record
- GET {BASE_URL}/imports/{jobId}/rejections
- Store the first item's "gtin" in variable badGtin
- Verify the first item's "reasonCode" equals "INVALID_GTIN_CHECK_DIGIT"
- GET {BASE_URL}/gtin/validate?gtin={badGtin}
- Verify "valid" equals false

SCRIPT 5 (API): Bulk edit
- POST {BASE_URL}/records/bulk-edit
- Body: {"jobId": "{jobId}", "operation": "CONVERT_UNITS_OZ_TO_G", "recordCount": 5000}
- Verify status code is 200, "updated" equals 5000, "failed" equals 0
- Store "auditId" in variable auditId

SCRIPT 6 (Web): Confirm results in the UI
Launch URL: https://<SITE>.netlify.app/
Steps:
1. Open the launch URL and verify the page title is "Demo PIM – Product Onboarding"
   and the "Import" tab is selected.
2. Click the "Results" tab.
3. Enter Job ID using the variable jobId and click "Load results".
4. Read "Valid records" and store it in variable uiValidCount.
5. Read "Rejected records" and store it in variable uiRejectedCount.
6. Verify uiValidCount equals 48,000 and uiRejectedCount equals 2,000
   (the UI shows thousands separators).
7. Click the first sample rejected record and verify the reason message is shown.

SCRIPT 7 (API): Syndicate compliant records
- POST {BASE_URL}/syndications
- Body: {"jobId": "{jobId}", "retailer": "RetailerA"}
- Verify status code is 202, "status" equals "ACCEPTED"
- Verify "recordsSent" equals validCount and "recordsSkipped" equals rejectedCount
- Store "syndicationId" in variable syndicationId

SCRIPT 8 (API): Negative check
- POST {BASE_URL}/syndications
- Body: {"jobId": "{jobId}", "retailer": "RetailerB"}
- Verify status code is 409 and "error" equals "RETAILER_MISMATCH"

ORCHESTRATION: run Script 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8.
Pass jobId, validCount, rejectedCount, and badGtin between scripts.
Stop the flow if Script 1 fails.
```

Each run creates a new job ID, so every execution is independent (like the random mobile number in the loan demo).

## Things to know
- Samples exist only when there are rejected records. Use 50,000 records (or anything large enough that 4% rounds to at least 1).
- Nothing is stored. Job and syndication IDs encode the numbers they return, which keeps the demo stable but means it isn't a real data store.
