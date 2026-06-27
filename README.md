# ProofOps Agent

Consent-aware proof matching for stalled Attio deals.

## Badges

![Status](https://img.shields.io/badge/status-MVP-blue)
![React](https://img.shields.io/badge/React-19-61dafb)
![Vite](https://img.shields.io/badge/Vite-7-646cff)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)

## Description

ProofOps is a hackathon MVP for the Attio Agentic CRM track. It helps a sales team find the right customer proof for a stalled deal, check whether the proof can be shared, verify public evidence, and prepare the next CRM action.

The current project uses fixture Attio-shaped CRM records for deals and proof assets until live Attio object mappings are configured. The partner integrations are real where keys are present: Superlinked reranks proof candidates, Tavily fetches live public web evidence, Gemini generates proof judgement and drafts, and SLNG powers voice input/output.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Partner and Sponsor Usage](#partner-and-sponsor-usage)
- [Architecture Overview](#architecture-overview)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [n8n Workflow](#n8n-workflow)
- [Screenshots or Demo](#screenshots-or-demo)
- [Deployment](#deployment)
- [API Reference](#api-reference)
- [Tests](#tests)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Licence](#licence)
- [Contact or Support](#contact-or-support)

## Features

- Attio-style workflow trigger for stalled deals.
- Consent-aware proof matching with approved, pending, restricted and expired states.
- Superlinked SIE semantic reranking across proof candidates.
- Tavily live web evidence search with source links and confidence labels.
- Gemini-generated proof judgement, notes, risks, next action and email draft.
- SLNG voice command recording and spoken proof summaries.
- n8n webhook configuration for optional external orchestration.
- Safe Attio write-back mode: CRM mutations stay disabled unless `ATTIO_WRITE_MODE=live`.
- Fixture dataset with 12 deals, 20 proof assets and 8 workflow payload examples.

## Tech Stack

- React 19
- TypeScript 5
- Vite 7
- Vite middleware API in `server/proofops-api.ts`
- Lucide React icons
- Node.js verified locally with `v24.14.0`
- npm verified locally with `11.9.0`

Partner services:

- Attio REST API
- Superlinked SIE Gateway
- Tavily Search API
- Google Gemini API
- SLNG speech-to-text and text-to-speech
- n8n webhook automation

## Partner and Sponsor Usage

See [SPONSORS.md](SPONSORS.md) for the partner technologies used in ProofOps and why each one matters to the demo.

## Architecture Overview

```mermaid
flowchart LR
  User["Sales user"] --> WebApp["ProofOps React app"]
  Attio["Attio Workflow"] --> API["ProofOps API"]
  N8N["n8n webhook"] --> API
  WebApp --> API
  API --> FixtureCRM[("Fixture CRM records")]
  API --> AttioAPI["Attio REST API"]
  API --> Superlinked["Superlinked SIE rerank"]
  API --> Tavily["Tavily live web evidence"]
  API --> Gemini["Gemini judgement and drafts"]
  API --> SLNG["SLNG voice I/O"]
```

The React app calls local API routes exposed by Vite middleware. The API reads fixture or Attio CRM data, reranks proof candidates with Superlinked, enriches them with live Tavily web evidence, asks Gemini for the final judgement, and keeps Attio write-back in dry-run mode unless live mutation is explicitly enabled.

For detailed data-flow, sequence, deployment, fallback and sponsor-placement diagrams, see [ARCHITECTURE.md](ARCHITECTURE.md).

## n8n Workflow

ProofOps includes an importable n8n workflow for the automation handoff:

[n8n/proofops-attio-workflow.json](n8n/proofops-attio-workflow.json)

Setup and test instructions are in [docs/n8n-workflow.md](docs/n8n-workflow.md).

The workflow receives an Attio-style event, normalises `dealId` and idempotency data, calls `POST /api/attio/workflow`, then returns a concise proof summary. ProofOps keeps the sponsor API keys server-side; n8n only calls the ProofOps API.

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/MasteraSnackin/ProofOps-Agent.git
cd ProofOps-Agent
npm install
```

Create local environment configuration:

```bash
cp .env.example .env
```

Fill only the keys you want to test. Keep `.env` private; it is intentionally ignored by git.

## Usage

Start the local app:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

Build the app:

```bash
npm run build
```

Preview a production build:

```bash
npm run preview
```

Run a proof match directly:

```bash
curl -X POST http://127.0.0.1:5173/api/proof/run \
  -H "content-type: application/json" \
  --data '{"dealId":"deal-1"}'
```

## Configuration

Environment variables are listed in [.env.example](.env.example). The most important groups are:

| Variable | Purpose |
| --- | --- |
| `ATTIO_API_KEY` | Attio API token. Required for live Attio reads or writes. |
| `ATTIO_WRITE_MODE` | Keep as `dry-run` unless live CRM mutation is intended. |
| `ATTIO_DEAL_OBJECT` | Attio object slug for live deal records. |
| `ATTIO_PROOF_OBJECT` | Attio object slug for live proof asset records. |
| `TAVILY_API_KEY` | Enables live public web evidence search. |
| `TAVILY_SEARCH_DEPTH` | Tavily search depth, default `advanced`. |
| `TAVILY_MAX_RESULTS` | Result count per Tavily search, default `4`. |
| `TAVILY_EXCLUDE_DOMAINS` | Comma-separated domains excluded from evidence search. |
| `GOOGLE_API_KEY` | Enables Gemini reasoning and draft generation. |
| `GEMINI_MODEL` | Gemini model, default `gemini-2.5-flash`. |
| `SUPERLINKED_API_KEY` | Enables Superlinked SIE reranking. |
| `SIE_ENDPOINT` | Superlinked SIE Gateway endpoint. |
| `SUPERLINKED_RERANK_MODEL` | Reranker model, default `Qwen/Qwen3-Reranker-0.6B`. |
| `SLNG_API_KEY` | Enables SLNG speech-to-text and text-to-speech. |
| `SLNG_TTS_URL` | SLNG TTS endpoint. |
| `SLNG_STT_URL` | SLNG STT endpoint. |
| `N8N_WEBHOOK_URL` | Optional n8n webhook endpoint for orchestration. |
| `PROOFOPS_WEBHOOK_SECRET` | Optional shared-secret variable for `/api/attio/workflow`; set only in private `.env` files or deployment secret storage. |

Current data-source behaviour:

- Deals: fixture CRM records unless `ATTIO_DEAL_OBJECT` maps to a live Attio object.
- Proof assets: fixture CRM records unless `ATTIO_PROOF_OBJECT` maps to a live Attio object.
- Public evidence: live Tavily web search when `TAVILY_API_KEY` is configured.
- Retrieval: live Superlinked SIE when `SUPERLINKED_API_KEY` and `SIE_ENDPOINT` are configured.
- Attio writes: dry-run unless `ATTIO_WRITE_MODE=live`.

## Screenshots or Demo

Production demo:

[https://proofops.vercel.app](https://proofops.vercel.app)

Narrated three-minute demo video:

[Watch or download the SLNG voiceover demo video](docs/assets/proofops-agent-demo-voiceover.mp4)

The current video shows the live agent workflow and then opens the GitHub sponsor and architecture documentation so judges can see how Attio, Superlinked, Tavily, Google DeepMind Gemini, SLNG and n8n are used.

Voiceover script:

[docs/demo-video-script.md](docs/demo-video-script.md)

Animated workflow capture:

<img src="docs/assets/proofops-agent-demo.gif" alt="Animated ProofOps workflow showing deal selection, proof matching, live sources and Attio write-back" width="960">

The video and capture show ProofOps moving from a stalled Attio-style deal to a generated proof recommendation with reference contact, consent status, live Tavily sources, Gemini judgement, Superlinked retrieval and dry-run Attio write-back.

### Demo Frames

| Step | Screenshot | What it shows |
| --- | --- | --- |
| 1 | <img src="docs/assets/proofops-01-ready.jpg" alt="ProofOps ready state" width="320"> | Camden Integrated Care Board is selected and the agent is ready to run. |
| 2 | <img src="docs/assets/proofops-02-running.jpg" alt="ProofOps running state" width="320"> | The workflow starts and the agent begins reading CRM context, matching proof and checking evidence. |
| 3 | <img src="docs/assets/proofops-03-generated-reference.jpg" alt="ProofOps generated reference result" width="320"> | The generated result recommends Northstar Health Trust, shows the reference contact and confirms consent is approved until 2026-12-15. |
| 4 | <img src="docs/assets/proofops-04-live-sources.jpg" alt="ProofOps live source evidence" width="320"> | The Evidence tab shows live Tavily source links and confidence labels. |
| 5 | <img src="docs/assets/proofops-05-attio-writeback.jpg" alt="ProofOps Attio write-back preview" width="320"> | The Attio writes tab shows the CRM-ready note, follow-up task and draft reference request. |
| 6 | <img src="docs/assets/proofops-06-github-sponsors.jpg" alt="ProofOps GitHub sponsor page" width="320"> | The GitHub sponsor page lists each partner technology, why it is used and where it appears in the demo. |
| 7 | <img src="docs/assets/proofops-07-github-architecture.jpg" alt="ProofOps GitHub architecture diagrams" width="320"> | The GitHub architecture page shows sponsor placement and data-flow diagrams for the agent workflow. |

Local demo path:

1. Start the app with `npm run dev`.
2. Select a stalled deal.
3. Click `Find proof for this deal`.
4. Review matched proof, consent status, live Tavily sources, Attio write preview and trace.
5. Use `Record` or `Listen` in the SLNG voice panel if microphone and audio playback are available.

For a public n8n or Attio webhook demo, expose the local app first:

```bash
ngrok http 5173
```

Then point n8n or Attio Workflow to the tunnel URL.

## Deployment

The project is configured for Vercel with [vercel.json](vercel.json).

Vercel build settings:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- API functions: explicit route files under `api/`

Deploy with the Vercel CLI:

```bash
vercel --prod
```

Set the same server-side environment variables in Vercel Project Settings before relying on live integrations. At minimum, configure the keys for the partners you want active in production. Keep `ATTIO_WRITE_MODE=dry-run` until live CRM mutation is intended.

After deployment, verify:

```bash
curl https://your-vercel-domain.vercel.app/api/health
```

## API Reference

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Returns configured partners, data sources, fixture counts and write mode. |
| `GET` | `/api/deals` | Returns fixture-backed or mapped Attio deal records. |
| `POST` | `/api/proof/run` | Runs the full proof matching workflow. |
| `POST` | `/api/attio/workflow` | Webhook-compatible proof workflow entry point. |
| `POST` | `/api/voice/stt` | Forwards browser audio to SLNG speech-to-text. |
| `POST` | `/api/voice/tts` | Returns SLNG speech audio for a proof summary. |

Example `/api/proof/run` body:

```json
{
  "dealId": "deal-1"
}
```

Example Attio/n8n webhook body:

```json
{
  "dealId": "attio-record-id",
  "source": "attio-workflow"
}
```

When `PROOFOPS_WEBHOOK_SECRET` is set, `/api/attio/workflow` requires either the `x-proofops-secret` header or an `authorization` bearer header containing the configured secret value. Do not commit that value to git.

Repeated workflow calls are deduplicated with `Idempotency-Key` or the Attio deal/event id.

## Tests

There is no dedicated automated test suite yet.

Current verification commands:

```bash
npm run build
```

```bash
npm exec tsc -- --noEmit --skipLibCheck \
  --jsx react-jsx \
  --module ESNext \
  --moduleResolution Bundler \
  --target ES2022 \
  --lib ES2022,DOM \
  --allowSyntheticDefaultImports \
  src/main.tsx src/domain.ts server/proofops-api.ts vite.config.ts
```

Recommended next test work:

- Add a `tsconfig.json` and a `typecheck` npm script.
- Add unit tests for proof scoring, consent policy and Superlinked score blending.
- Add API tests for `/api/proof/run`, `/api/health` and webhook idempotency.
- Add browser tests for the main workflow and Evidence tab labels.

## Roadmap

- Map live Attio `deals` and `proof_assets` objects.
- Seed or create the Attio proof asset schema.
- Add safe live write-back for tasks and `proofops_summary`.
- Add a proper test suite and CI workflow.
- Add screenshots or a short demo recording.
- Add deployment instructions once a production host is chosen.
- Decide whether reference requests are handled by Attio tasks, n8n, email tooling or a dedicated workflow.

## Contributing

Contributions are welcome once repository guidelines are added.

Suggested workflow:

1. Create a feature branch.
2. Keep secrets out of git.
3. Run the build and type-check commands.
4. Document any new environment variables.
5. Open a pull request with a short description and verification notes.

## Licence

`<ADD LICENSE>`

No licence file is currently present in this repository.

## Contact or Support

`<ADD CONTACT OR SUPPORT CHANNEL>`

For hackathon judging, start with the local demo at `http://127.0.0.1:5173/` and review `/api/health` to confirm which integrations are active.
