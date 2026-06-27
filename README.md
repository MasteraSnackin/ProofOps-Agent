# ProofOps Agent for Attio

MVP for the Attio Agentic CRM track. It includes a local API layer so the demo can move from fixture CRM data to partner-backed mode by adding keys and Attio object mappings.

ProofOps turns closed-won customer history into consent-aware proof assets, then matches those assets to stalled deals. The current app uses fixture Attio-shaped deal/proof records until `ATTIO_DEAL_OBJECT` and `ATTIO_PROOF_OBJECT` are configured. Public evidence is live Tavily web data when `TAVILY_API_KEY` is present. The integration seam is:

1. Attio Workflow trigger: deal stalled, closed-won customer added, or manual proof request.
2. ProofOps API: reads CRM context and proof inventory.
3. Superlinked: semantically reranks the proof inventory for the deal context.
4. Tavily: verifies public evidence and sources.
5. Google DeepMind: extracts outcomes, judges proof fit, generates CRM notes and email drafts.
6. SLNG: accepts voice commands and reads the generated proof summary aloud.
7. n8n: optional external workflow shell for Attio webhook intake and notifications.
8. Attio REST API: creates the follow-up task and, when configured, updates a proof summary field.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## API Routes

- `GET /api/health` returns which partner credentials are present.
- `GET /api/deals` returns the 12 fixture-backed Attio-shaped deals.
- `POST /api/proof/run` accepts `{ "dealId": "deal-1" }` and returns a full proof-match run.
- `POST /api/attio/workflow` accepts the same shape, plus a webhook-style body for the Attio Workflow entry point.
- `POST /api/voice/stt` forwards browser microphone audio to SLNG speech-to-text.
- `POST /api/voice/tts` returns SLNG speech audio for the selected proof summary.

The default write mode is safe: no Attio mutation is attempted unless `ATTIO_API_KEY` is set and `ATTIO_WRITE_MODE=live`.
If `PROOFOPS_WEBHOOK_SECRET` is set, `/api/attio/workflow` requires either `x-proofops-secret: <secret>` or `authorization: Bearer <secret>`.
Repeated workflow calls are deduplicated with `Idempotency-Key` or the Attio deal/event id.

## Partner Usage

- Attio: workflow trigger, custom objects, notes, tasks and deal records.
- Google DeepMind: reasoning, matching, proof extraction and draft generation.
- Superlinked: semantic proof retrieval and candidate reranking through SIE.
- Tavily: live public web evidence search and source extraction.
- SLNG: spoken workflow commands and spoken proof summaries.
- n8n: optional webhook orchestration between Attio, ProofOps and follow-up tools.

## Data Sources

- Deals: fixture CRM records unless `ATTIO_DEAL_OBJECT` maps to a live Attio object.
- Proof assets: fixture CRM records unless `ATTIO_PROOF_OBJECT` maps to a live Attio object.
- Semantic ranking: live Superlinked SIE when configured.
- Public evidence: live Tavily web search when configured.
- Stored evidence notes: fixture or Attio CRM notes, labelled separately from Tavily sources in the Evidence tab.

## Test Data

Attio-shaped test records live in `data/`. The local API now loads these fixtures for `/api/deals` and proof matching when live Attio credentials are not configured:

- `data/test-deals.json`: 12 deal examples.
- `data/test-proof-assets.json`: 20 proof asset examples.
- `data/test-workflow-payloads.json`: 8 workflow payload examples.
- `data/attio-field-map.example.json`: suggested Attio object and attribute map.

Total counted examples: 40.

## Environment

Copy `.env.example` to `.env` and fill only the keys you want to test:

```bash
ATTIO_API_KEY=
ATTIO_WRITE_MODE=dry-run
ATTIO_ASSIGNEE_ID=
ATTIO_LINKED_RECORDS=
ATTIO_LINKED_RECORDS_JSON=
ATTIO_DEAL_OBJECT=
ATTIO_DEAL_RECORD_ID=
ATTIO_PROOF_ATTRIBUTE=
ATTIO_DEAL_NAME_ATTRIBUTE=name
ATTIO_DEAL_STAGE_ATTRIBUTE=stage
ATTIO_DEAL_VALUE_ATTRIBUTE=value
ATTIO_DEAL_OWNER_ATTRIBUTE=owner
ATTIO_DEAL_STALLED_DAYS_ATTRIBUTE=stalled_days
ATTIO_DEAL_SEGMENT_ATTRIBUTE=segment
ATTIO_DEAL_USE_CASE_ATTRIBUTE=use_case
ATTIO_DEAL_OBJECTIONS_ATTRIBUTE=objections
ATTIO_DEAL_RISK_ATTRIBUTE=risk
ATTIO_DEAL_NEXT_MEETING_ATTRIBUTE=next_meeting
ATTIO_PROOF_OBJECT=
ATTIO_PROOF_COMPANY_ATTRIBUTE=company
ATTIO_PROOF_SECTOR_ATTRIBUTE=sector
ATTIO_PROOF_SEGMENT_ATTRIBUTE=segment
ATTIO_PROOF_CHAMPION_ATTRIBUTE=champion
ATTIO_PROOF_CONSENT_ATTRIBUTE=consent
ATTIO_PROOF_CONSENT_EXPIRES_ATTRIBUTE=consent_expires_at
ATTIO_PROOF_OUTCOMES_ATTRIBUTE=outcomes
ATTIO_PROOF_PRODUCTS_ATTRIBUTE=products
ATTIO_PROOF_OBJECTIONS_ATTRIBUTE=objections_handled
ATTIO_PROOF_SIGNALS_ATTRIBUTE=signals
ATTIO_PROOF_HEALTH_ATTRIBUTE=renewal_health
ATTIO_PROOF_EVIDENCE_TITLE_ATTRIBUTE=evidence_title
ATTIO_PROOF_EVIDENCE_CLAIM_ATTRIBUTE=evidence_claim
ATTIO_PROOF_EVIDENCE_CONFIDENCE_ATTRIBUTE=evidence_confidence
TAVILY_API_KEY=
TAVILY_PROJECT_ID=
TAVILY_SEARCH_DEPTH=advanced
TAVILY_MAX_RESULTS=4
TAVILY_EXCLUDE_DOMAINS=linkedin.com,facebook.com,x.com,twitter.com,instagram.com
GOOGLE_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
SLNG_API_KEY=
SLNG_TTS_URL=https://api.slng.ai/v1/tts/slng/deepgram/aura:2-en
SLNG_TTS_MODEL=aura-2-thalia-en
SLNG_STT_URL=https://api.slng.ai/v1/stt/slng/deepgram/nova:3-en
SLNG_AUDIO_LIMIT_BYTES=12000000
SUPERLINKED_API_KEY=
SIE_ENDPOINT=
SUPERLINKED_RERANK_MODEL=Qwen/Qwen3-Reranker-0.6B
SIE_MACHINE_PROFILE=
SIE_POOL=
N8N_WEBHOOK_URL=
PROOFOPS_WEBHOOK_SECRET=
PROOFOPS_IDEMPOTENCY_TTL_MS=3600000
```

## n8n Setup

Use n8n as the outer automation layer, not as the proof-matching engine.

Recommended flow:

1. Attio Workflow sends a webhook event to `N8N_WEBHOOK_URL`.
2. n8n HTTP Request calls `POST /api/proof/run` on ProofOps.
3. n8n branches on the returned consent policy and write status.
4. n8n can notify Slack/email or call Attio REST API if you want the automation outside ProofOps.

For a local demo, expose ProofOps before n8n can call it:

```bash
ngrok http 5173
```

Then use the tunnel URL in the n8n HTTP Request node:

```http
POST https://your-ngrok-url.ngrok-free.app/api/proof/run
content-type: application/json
```

Example n8n body:

```json
{
  "dealId": "deal-1",
  "source": "attio-workflow"
}
```

## Attio Setup

Create these in Attio for the best hackathon demo:

- A Workflow on a deal stage/stalled/manual trigger that calls `POST /api/attio/workflow`.
- A deal field such as `proofops_summary` for the write-back summary.
- A custom object such as `Proof Assets` with attributes for company, sector, segment, champion, consent, consent expiry, outcomes, products, objections handled, signals, renewal health, evidence title, evidence claim and evidence confidence.
- A task destination owner/member ID for `ATTIO_ASSIGNEE_ID`.

Webhook headers:

```http
content-type: application/json
x-proofops-secret: your-shared-secret
idempotency-key: {{event.id}}
```

Example body:

```json
{
  "dealId": "attio-record-id"
}
```

For a local judge demo, expose Vite with a tunnel and put the tunnel URL in the Attio Workflow:

```bash
ngrok http 5173
```

## Real Integration Plan

The adapters now live behind the Vite middleware in `server/proofops-api.ts`:

- Attio Workflow calls `/api/attio/workflow`.
- Attio proof assets are read from `ATTIO_PROOF_OBJECT` when configured.
- Superlinked runs when `SUPERLINKED_API_KEY` and `SIE_ENDPOINT` are present and reranks proof candidates with `SUPERLINKED_RERANK_MODEL`.
- Tavily runs when `TAVILY_API_KEY` is present, searches the live web for public analogue evidence, and shows source-linked claims with confidence.
- Gemini runs when `GOOGLE_API_KEY` is present and generates proof judgement, objections, risk and drafts.
- SLNG runs when `SLNG_API_KEY` is present and powers `/api/voice/stt` plus `/api/voice/tts`.
- n8n is configured with `N8N_WEBHOOK_URL`; ProofOps does not automatically send CRM data to it.
- Attio writes stay dry-run until `ATTIO_WRITE_MODE=live`.

Remaining production work:

- Fill the Attio attribute names to match your workspace.
- Configure an Attio custom field such as `proofops_summary` for the write-back summary.
- Decide whether reference requests are sent by Attio task only or handed to an email tool after consent.
