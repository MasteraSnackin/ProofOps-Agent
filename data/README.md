# ProofOps Test Data

This folder contains 40 Attio-shaped examples for local testing and later import into Attio.
These are fixture CRM records, not live customer data. Live public web evidence is fetched at runtime through Tavily when `TAVILY_API_KEY` is configured.

## Files

- `test-deals.json`: 12 deal records, including stalled, procurement, evaluation, bad-fit and duplicate-event cases.
- `test-proof-assets.json`: 20 proof asset records covering approved, pending, restricted, expired, strong evidence and weak evidence cases.
- `test-workflow-payloads.json`: 8 API payload examples for `/api/proof/run` and `/api/attio/workflow`.
- `attio-field-map.example.json`: suggested Attio object and attribute mapping.

## Count

The 40 examples are:

- 12 deals
- 20 proof assets
- 8 workflow payloads

`attio-field-map.example.json` is support configuration and is not counted as an example.

## Shape

The records use:

- `object_slug`
- `record_id`
- `values`
- `scenario`
- `expected`

This keeps the files close to Attio imports while still being readable during the hackathon demo.
