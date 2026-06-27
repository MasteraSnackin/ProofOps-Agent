import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import {
  customers,
  deals,
  getBestMatches,
  type Customer,
  type Consent,
  type Deal,
  type DealStage,
  type Evidence,
  type ProofMatch,
  type ProofRun,
} from "../src/domain.js";

type Env = Record<string, string | undefined>;
type JsonBody = Record<string, unknown>;
type AttioRecord = { data?: { id?: { record_id?: string }; values?: Record<string, unknown> } };
type FixtureRecord = {
  id: string;
  object_slug: string;
  record_id: string;
  scenario?: string;
  values: Record<string, unknown>;
};
type RequestMeta = {
  idempotencyKey?: string;
  webhookVerified: boolean;
};

const jsonHeaders = { "content-type": "application/json" };
const runCache = new Map<string, { expiresAt: number; run: ProofRun }>();
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let fixtureCache:
  | {
      dealRecords: FixtureRecord[];
      proofRecords: FixtureRecord[];
      workflowPayloads: JsonBody[];
      deals: Deal[];
      customers: Customer[];
    }
  | undefined;

export function proofopsApiPlugin(env: Env): Plugin {
  return {
    name: "proofops-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleProofOpsApi(req, res, env, next);
      });
    },
  };
}

export async function handleProofOpsApi(req: IncomingMessage, res: ServerResponse, env: Env, next?: () => void) {
  const pathname = req.url?.split("?")[0];
  if (!pathname?.startsWith("/api/")) {
    if (next) {
      next();
      return;
    }
    sendJson(res, 404, { error: "Unknown ProofOps API route" });
    return;
  }

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      const fixtureData = loadFixtureData();
      sendJson(res, 200, {
        ok: true,
        partners: {
          attio: Boolean(env.ATTIO_API_KEY),
          tavily: Boolean(env.TAVILY_API_KEY),
          gemini: Boolean(env.GOOGLE_API_KEY),
          slng: Boolean(env.SLNG_API_KEY),
          superlinked: Boolean(env.SUPERLINKED_API_KEY && env.SIE_ENDPOINT),
        },
        attioObjects: {
          deals: env.ATTIO_DEAL_OBJECT || "not configured",
          proofAssets: env.ATTIO_PROOF_OBJECT || "not configured",
        },
        automation: {
          n8nWebhook: Boolean(env.N8N_WEBHOOK_URL),
        },
        fixtures: {
          deals: fixtureData.dealRecords.length,
          proofAssets: fixtureData.proofRecords.length,
          workflowPayloads: fixtureData.workflowPayloads.length,
          totalExamples: fixtureData.dealRecords.length + fixtureData.proofRecords.length + fixtureData.workflowPayloads.length,
        },
        dataSources: {
          crm: env.ATTIO_DEAL_OBJECT && env.ATTIO_PROOF_OBJECT ? "attio" : "fixture",
          publicEvidence: env.TAVILY_API_KEY ? "tavily-live-web" : "stored-notes",
          retrieval: env.SUPERLINKED_API_KEY && env.SIE_ENDPOINT ? "superlinked-live-sie" : "local",
        },
        webhookSecurity: env.PROOFOPS_WEBHOOK_SECRET ? "shared secret enabled" : "open in local demo",
        writeMode: env.ATTIO_WRITE_MODE || "dry-run",
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/deals") {
      const fixtureData = loadFixtureData();
      sendJson(res, 200, {
        data: fixtureData.deals,
        meta: {
          source: fixtureData.deals.length ? "fixture-crm" : "domain-fallback",
          count: fixtureData.deals.length,
        },
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/voice/tts") {
      const body = await readJson(req);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!env.SLNG_API_KEY) {
        sendJson(res, 401, { error: "SLNG_API_KEY is not configured" });
        return;
      }

      if (!text) {
        sendJson(res, 400, { error: "Missing text for SLNG speech synthesis" });
        return;
      }

      const audio = await slngTextToSpeech(text, env);
      sendBinary(res, audio.statusCode, audio.contentType, audio.body);
      return;
    }

    if (req.method === "POST" && pathname === "/api/voice/stt") {
      if (!env.SLNG_API_KEY) {
        sendJson(res, 401, { error: "SLNG_API_KEY is not configured" });
        return;
      }

      const contentType = headerValue(req, "content-type");
      if (!contentType?.includes("multipart/form-data")) {
        sendJson(res, 400, { error: "Expected multipart/form-data with an audio field" });
        return;
      }

      const transcript = await slngSpeechToText(req, contentType, env);
      sendText(res, transcript.statusCode, transcript.contentType, transcript.body);
      return;
    }

    if (req.method === "POST" && (pathname === "/api/proof/run" || pathname === "/api/attio/workflow")) {
      const isWorkflow = pathname === "/api/attio/workflow";
      if (isWorkflow && !isWebhookAuthorised(req, env)) {
        sendJson(res, 401, { error: "ProofOps webhook secret missing or invalid" });
        return;
      }

      const body = await readJson(req);
      const idempotencyKey = isWorkflow ? getIdempotencyKey(req, body) : undefined;
      const cached = idempotencyKey ? getCachedRun(idempotencyKey) : undefined;

      if (cached) {
        sendJson(res, 200, markDuplicate(cached));
        return;
      }

      const run = await runProofOps(body, env, {
        idempotencyKey,
        webhookVerified: isWorkflow ? Boolean(env.PROOFOPS_WEBHOOK_SECRET) : false,
      });

      if (idempotencyKey) {
        cacheRun(idempotencyKey, run, env);
      }

      sendJson(res, 200, run);
      return;
    }

    sendJson(res, 404, { error: "Unknown ProofOps API route" });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Unknown ProofOps API error",
    });
  }
}

async function runProofOps(body: JsonBody, env: Env, meta: RequestMeta): Promise<ProofRun> {
  const selected = await selectDeal(body, env);
  const inventory = await loadProofInventory(env);
  const trace: ProofRun["trace"] = [
    {
      label: "Attio trigger",
      detail: selected.traceDetail,
      status: "complete",
    },
    inventory.trace,
  ];

  let matches = getBestMatches(selected.deal, inventory.customers);
  let retrievalProvider: ProofRun["retrievalProvider"] = "local";
  let evidenceProvider: ProofRun["evidenceProvider"] = "demo";
  let reasoningProvider: ProofRun["reasoningProvider"] = "local";

  const superlinkedKey = env.SUPERLINKED_API_KEY;
  if (superlinkedKey && env.SIE_ENDPOINT) {
    const reranked = await rerankWithSuperlinked(selected.deal, matches, env);
    matches = reranked.matches;
    retrievalProvider = reranked.used ? "superlinked" : "local";
    trace.push(reranked.trace);
  } else {
    trace.push({
      label: "Superlinked retrieval",
      detail: "Awaiting SUPERLINKED_API_KEY and SIE_ENDPOINT; using deterministic local proof ranking.",
      status: "skipped",
    });
  }

  const tavilyKey = env.TAVILY_API_KEY;
  if (tavilyKey) {
    const enriched = await enrichWithTavily(selected.deal, matches, env);
    matches = enriched.matches;
    evidenceProvider = enriched.used ? "tavily" : "demo";
    trace.push(enriched.trace);
  } else {
    trace.push({
      label: "Tavily evidence",
      detail: "Awaiting TAVILY_API_KEY; showing stored evidence and internal Attio notes.",
      status: "skipped",
    });
  }

  const googleKey = env.GOOGLE_API_KEY;
  if (googleKey) {
    const reasoned = await rankWithGemini(selected.deal, matches, googleKey, env.GEMINI_MODEL || "gemini-2.5-flash");
    matches = reasoned.matches;
    reasoningProvider = reasoned.used ? "gemini" : "local";
    trace.push(reasoned.trace);
  } else {
    trace.push({
      label: "Gemini reasoning",
      detail: "Awaiting GOOGLE_API_KEY; using deterministic local scoring and drafts.",
      status: "skipped",
    });
  }

  const attioWrite = await writeAttioTask(selected.deal, matches[0], env, selected.recordId);
  trace.push({
    label: "Attio write-back",
    detail: attioWrite.error || describeAttioWrite(attioWrite.status),
    status: attioWrite.status === "failed" ? "failed" : attioWrite.status === "skipped" ? "skipped" : "complete",
  });

  return {
    deal: selected.deal,
    matches,
    mode:
      selected.source === "attio" ||
      inventory.source === "attio" ||
      retrievalProvider === "superlinked" ||
      evidenceProvider === "tavily" ||
      reasoningProvider === "gemini" ||
      Boolean(env.ATTIO_API_KEY)
        ? "live"
        : "demo",
    dataProvider: selected.source === "attio" || inventory.source === "attio" ? "attio" : "demo",
    retrievalProvider,
    evidenceProvider,
    reasoningProvider,
    idempotencyKey: meta.idempotencyKey,
    security: {
      webhookVerified: meta.webhookVerified,
      duplicateSuppressed: false,
    },
    attioWrite,
    trace,
  };
}

function loadFixtureData() {
  if (fixtureCache) return fixtureCache;

  const dealRecords = readFixtureFile<FixtureRecord[]>("data/test-deals.json", []);
  const proofRecords = readFixtureFile<FixtureRecord[]>("data/test-proof-assets.json", []);
  const workflowPayloads = readFixtureFile<JsonBody[]>("data/test-workflow-payloads.json", []);

  fixtureCache = {
    dealRecords,
    proofRecords,
    workflowPayloads,
    deals: dealRecords.map(fixtureDealToDeal),
    customers: proofRecords.map(fixtureProofToCustomer).filter(Boolean) as Customer[],
  };

  return fixtureCache;
}

function readFixtureFile<T>(relativePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(resolve(rootDir, relativePath), "utf8")) as T;
  } catch {
    return fallback;
  }
}

function fixtureDealToDeal(record: FixtureRecord): Deal {
  const values = record.values;

  return {
    id: record.id,
    company: fixtureString(values, "name", "Unnamed deal"),
    stage: fixtureStage(values.stage),
    value: formatCurrency(fixtureString(values, "value", "Unknown")),
    owner: fixtureString(values, "owner", "Unassigned"),
    stalledDays: fixtureNumber(values, "stalled_days", 14),
    segment: fixtureString(values, "segment", "Unknown segment"),
    useCase: fixtureString(values, "use_case", "Proof request from Attio fixture"),
    objections: fixtureList(values.objections),
    risk: fixtureString(values, "risk", "Deal needs relevant proof before the next buyer response."),
    nextMeeting: fixtureString(values, "next_meeting", "Next customer touchpoint"),
  };
}

function fixtureProofToCustomer(record: FixtureRecord): Customer | undefined {
  const values = record.values;
  const company = fixtureString(values, "company", "");
  if (!company) return undefined;
  const fixtureUrl = fixtureString(values, "evidence_url", undefined);
  const isPlaceholderUrl = fixtureUrl?.includes("example.org") || fixtureUrl?.includes("example.com");

  return {
    id: record.id,
    company,
    sector: fixtureString(values, "sector", "Unknown sector"),
    segment: fixtureString(values, "segment", "Unknown segment"),
    champion: fixtureString(values, "champion", "Account owner"),
    consent: fixtureConsent(values.consent),
    consentExpiresAt: fixtureString(values, "consent_expires_at", undefined),
    outcomes: fixtureList(values.outcomes, ["Outcome recorded in fixture proof asset"]),
    products: fixtureList(values.products, ["proof asset"]),
    objectionsHandled: fixtureList(values.objections_handled, ["buyer risk"]),
    signals: fixtureList(values.signals, ["stored proof asset"]),
    renewalHealth: fixtureNumber(values, "renewal_health", 75),
    evidence: [
      {
        title: fixtureString(values, "evidence_title", "Fixture proof evidence"),
        source: fixtureString(values, "evidence_source", "Fixture proof asset"),
        type: fixtureUrl && !isPlaceholderUrl ? "website" : "note",
        claim: fixtureString(values, "evidence_claim", "Evidence stored in the fixture proof asset."),
        confidence: fixtureNumber(values, "evidence_confidence", 75),
        url: fixtureUrl && !isPlaceholderUrl ? fixtureUrl : undefined,
        provider: "fixture",
      },
    ],
  };
}

async function selectDeal(body: JsonBody, env: Env): Promise<{ deal: Deal; source: "demo" | "attio"; recordId?: string; traceDetail: string }> {
  const inlineDeal = normaliseInlineDeal(body.deal);
  if (inlineDeal) {
    return {
      deal: inlineDeal,
      source: "demo",
      traceDetail: `Accepted inline deal payload for ${inlineDeal.company}.`,
    };
  }

  const recordId = getDealId(body);
  const attioDeal = recordId ? await loadAttioDeal(recordId, env) : undefined;
  if (attioDeal) {
    return {
      deal: attioDeal,
      source: "attio",
      recordId,
      traceDetail: `Read live Attio deal record ${recordId}.`,
    };
  }

  const fixtures = loadFixtureData();
  const fixtureRecord = fixtures.dealRecords.find((candidate) => candidate.id === recordId || candidate.record_id === recordId || candidate.id === body.dealId);
  const fixtureDeal = fixtureRecord ? fixtureDealToDeal(fixtureRecord) : undefined;
  const deal = fixtureDeal || deals.find((candidate) => candidate.id === recordId) || deals.find((candidate) => candidate.id === body.dealId) || deals[0];
  return {
    deal,
    source: "demo",
    recordId: fixtureRecord?.record_id || recordId,
    traceDetail: fixtureRecord
      ? `Loaded fixture deal ${deal.company} from ${fixtureRecord.record_id}.`
      : recordId
        ? `No Attio deal mapping found for ${recordId}; using demo deal ${deal.company}.`
        : `Loaded demo deal ${deal.company}.`,
  };
}

function getDealId(body: JsonBody) {
  if (typeof body.dealId === "string") return body.dealId;
  return extractDealIdFromWebhook(body);
}

function extractDealIdFromWebhook(body: JsonBody) {
  const events = Array.isArray(body.events) ? body.events : [];
  const firstEvent = events[0] as JsonBody | undefined;
  const id = firstEvent?.id as JsonBody | undefined;
  const data = firstEvent?.data as JsonBody | undefined;
  const recordId = id?.record_id || data?.record_id || body.record_id;
  return typeof recordId === "string" ? recordId : undefined;
}

async function loadAttioDeal(recordId: string, env: Env): Promise<Deal | undefined> {
  if (!env.ATTIO_API_KEY || !env.ATTIO_DEAL_OBJECT) return undefined;

  try {
    const record = await fetchAttioRecord(env.ATTIO_DEAL_OBJECT, recordId, env.ATTIO_API_KEY);
    return {
      id: recordId,
      company: stringValue(record, env.ATTIO_DEAL_NAME_ATTRIBUTE || "name") || "Attio deal",
      stage: stageValue(record, env.ATTIO_DEAL_STAGE_ATTRIBUTE || "stage"),
      value: stringValue(record, env.ATTIO_DEAL_VALUE_ATTRIBUTE || "value") || "Unknown",
      owner: stringValue(record, env.ATTIO_DEAL_OWNER_ATTRIBUTE || "owner") || "Unassigned",
      stalledDays: numberValue(record, env.ATTIO_DEAL_STALLED_DAYS_ATTRIBUTE || "stalled_days") || 14,
      segment: stringValue(record, env.ATTIO_DEAL_SEGMENT_ATTRIBUTE || "segment") || "Unknown segment",
      useCase: stringValue(record, env.ATTIO_DEAL_USE_CASE_ATTRIBUTE || "use_case") || "Proof request from Attio",
      objections: listValue(record, env.ATTIO_DEAL_OBJECTIONS_ATTRIBUTE || "objections"),
      risk: stringValue(record, env.ATTIO_DEAL_RISK_ATTRIBUTE || "risk") || "Deal needs relevant proof before the next buyer response.",
      nextMeeting: stringValue(record, env.ATTIO_DEAL_NEXT_MEETING_ATTRIBUTE || "next_meeting") || "Next customer touchpoint",
    };
  } catch {
    return undefined;
  }
}

async function loadProofInventory(env: Env): Promise<{ customers: Customer[]; source: "demo" | "attio"; trace: ProofRun["trace"][number] }> {
  if (!env.ATTIO_API_KEY || !env.ATTIO_PROOF_OBJECT) {
    const fixtureData = loadFixtureData();
    return {
      customers: fixtureData.customers.length ? fixtureData.customers : customers,
      source: "demo",
      trace: {
        label: "Proof inventory",
        detail: fixtureData.customers.length
          ? `Loaded ${fixtureData.customers.length} fixture proof assets. Configure ATTIO_PROOF_OBJECT to read live Attio proof assets.`
          : "Using demo proof assets. Configure ATTIO_PROOF_OBJECT to read live proof assets.",
        status: "skipped",
      },
    };
  }

  try {
    const records = await queryAttioRecords(env.ATTIO_PROOF_OBJECT, env.ATTIO_API_KEY);
    const mapped = records.map((record, index) => attioRecordToCustomer(record, env, index)).filter(Boolean) as Customer[];
    return mapped.length
      ? {
          customers: mapped,
          source: "attio",
          trace: {
            label: "Proof inventory",
            detail: `Read ${mapped.length} live proof asset records from Attio.`,
            status: "complete",
          },
        }
      : {
          customers: loadFixtureData().customers.length ? loadFixtureData().customers : customers,
          source: "demo",
          trace: {
            label: "Proof inventory",
            detail: "Attio proof object returned no usable records; using fixture proof assets.",
            status: "failed",
          },
        };
  } catch (error) {
    const fixtureData = loadFixtureData();
    return {
      customers: fixtureData.customers.length ? fixtureData.customers : customers,
      source: "demo",
      trace: {
        label: "Proof inventory",
        detail: `Live proof inventory failed; using fixture proof assets: ${error instanceof Error ? error.message : "unknown error"}.`,
        status: "failed",
      },
    };
  }
}

async function enrichWithTavily(deal: Deal, matches: ProofMatch[], env: Env) {
  try {
    const enrichedTopThree = await Promise.all(
      matches.slice(0, 3).map(async (match) => {
        const evidence = await tavilyEvidence(deal, match, env);
        return evidence.length
          ? {
              ...match,
              customer: {
                ...match.customer,
                evidence: [...evidence, ...match.customer.evidence],
              },
            }
          : match;
      })
    );

    return {
      matches: [...enrichedTopThree, ...matches.slice(3)],
      used: true,
      trace: {
        label: "Tavily evidence",
        detail: "Ran live Tavily web searches for the top three proof candidates and attached source-linked public evidence.",
        status: "complete" as const,
      },
    };
  } catch (error) {
    return {
      matches,
      used: false,
      trace: {
        label: "Tavily evidence",
        detail: `Live Tavily evidence search failed; stored CRM/test notes are still shown: ${errorMessage(error)}.`,
        status: "failed" as const,
      },
    };
  }
}

async function tavilyEvidence(deal: Deal, match: ProofMatch, env: Env): Promise<Evidence[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: compactHeaders({
      authorization: `Bearer ${env.TAVILY_API_KEY}`,
      "content-type": "application/json",
      "x-project-id": env.TAVILY_PROJECT_ID,
    }),
    body: JSON.stringify({
      query: tavilyQuery(deal, match),
      search_depth: env.TAVILY_SEARCH_DEPTH || "advanced",
      max_results: Number(env.TAVILY_MAX_RESULTS || 4),
      include_answer: true,
      include_raw_content: false,
      exclude_domains: tavilyExcludedDomains(env),
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily returned ${response.status}`);
  }

  const payload = (await response.json()) as { answer?: string; results?: Array<{ title?: string; url?: string; score?: number; content?: string }> };
  return (payload.results || [])
    .filter((result) => result.url && !result.url.includes("example."))
    .map((result) => ({
      title: result.title || "Live public evidence",
      source: "Tavily live web",
      type: "website" as const,
      claim: result.content ? truncate(result.content, 210) : payload.answer ? truncate(payload.answer, 210) : "Tavily found a public source relevant to this proof candidate.",
      confidence: result.score ? Math.round(Math.min(1, result.score) * 100) : 72,
      url: result.url,
      provider: "tavily" as const,
    }));
}

function tavilyQuery(deal: Deal, match: ProofMatch) {
  const parts = [
    deal.segment,
    match.customer.sector,
    deal.useCase,
    ...deal.objections,
    ...match.customer.products.slice(0, 2),
    "case study",
    "public evidence",
    "digital transformation",
  ];
  return parts.filter(Boolean).join(" ");
}

function tavilyExcludedDomains(env: Env) {
  return (env.TAVILY_EXCLUDE_DOMAINS || "linkedin.com,facebook.com,x.com,twitter.com,instagram.com")
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);
}

async function rerankWithSuperlinked(deal: Deal, matches: ProofMatch[], env: Env) {
  const model = env.SUPERLINKED_RERANK_MODEL || "Qwen/Qwen3-Reranker-0.6B";

  try {
    const response = await fetchWithRetry(`${normaliseEndpoint(env.SIE_ENDPOINT)}/v1/score/${model}`, {
      method: "POST",
      headers: compactHeaders({
        authorization: `Bearer ${env.SUPERLINKED_API_KEY}`,
        "content-type": "application/json",
        "x-sie-machine-profile": env.SIE_MACHINE_PROFILE,
        "x-sie-pool": env.SIE_POOL,
      }),
      body: JSON.stringify({
        instruction: "Rank customer proof assets by relevance to the stalled sales deal. Prefer same-sector, same-segment, matching objections, and consent-safe evidence.",
        query: {
          id: deal.id,
          text: superlinkedDealText(deal),
          metadata: {
            company: deal.company,
            segment: deal.segment,
            stage: deal.stage,
          },
        },
        items: matches.map((match) => ({
          id: match.customer.id,
          text: superlinkedProofText(match),
          metadata: {
            company: match.customer.company,
            segment: match.customer.segment,
            sector: match.customer.sector,
            consent: match.customer.consent,
            localScore: match.score,
          },
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`SIE score returned ${response.status}`);
    }

    const payload = (await response.json()) as { model?: string; scores?: Array<{ item_id?: string; score?: number; rank?: number }> };
    const scores = payload.scores || [];
    if (!scores.length) {
      throw new Error("SIE returned no scores");
    }

    const scoreByCustomerId = new Map(scores.map((entry) => [entry.item_id, entry]).filter(([id]) => typeof id === "string") as Array<[string, { item_id?: string; score?: number; rank?: number }]>);
    const reranked = matches
      .map((match) => applySuperlinkedScore(match, scoreByCustomerId.get(match.customer.id)))
      .sort((a, b) => b.score - a.score);

    return {
      matches: reranked,
      used: true,
      trace: {
        label: "Superlinked retrieval",
        detail: `Semantic reranked ${scores.length} proof candidates with ${payload.model || model}.`,
        status: "complete" as const,
      },
    };
  } catch (error) {
    return {
      matches,
      used: false,
      trace: {
        label: "Superlinked retrieval",
        detail: `Semantic rerank failed; local deterministic ranking retained: ${errorMessage(error)}.`,
        status: "failed" as const,
      },
    };
  }
}

function applySuperlinkedScore(match: ProofMatch, scoreEntry?: { score?: number; rank?: number }): ProofMatch {
  if (typeof scoreEntry?.score !== "number") return match;
  const semanticScore = Math.round(Math.max(0, Math.min(1, scoreEntry.score)) * 100);
  const blendedScore = Math.max(32, Math.min(99, Math.round(match.score * 0.35 + semanticScore * 0.65)));
  const semanticFit = `Superlinked semantic rank ${typeof scoreEntry.rank === "number" ? scoreEntry.rank + 1 : "n/a"} with ${semanticScore}% relevance`;

  return {
    ...match,
    score: blendedScore,
    fit: [semanticFit, ...match.fit.filter((item) => !item.startsWith("Superlinked semantic rank"))].slice(0, 4),
  };
}

function superlinkedDealText(deal: Deal) {
  return [
    `Company: ${deal.company}`,
    `Stage: ${deal.stage}`,
    `Segment: ${deal.segment}`,
    `Use case: ${deal.useCase}`,
    `Objections: ${deal.objections.join(", ")}`,
    `Risk: ${deal.risk}`,
    `Next meeting: ${deal.nextMeeting}`,
  ].join("\n");
}

function superlinkedProofText(match: ProofMatch) {
  const customer = match.customer;
  return [
    `Customer: ${customer.company}`,
    `Sector: ${customer.sector}`,
    `Segment: ${customer.segment}`,
    `Consent: ${customer.consent}`,
    `Outcomes: ${customer.outcomes.join(", ")}`,
    `Products: ${customer.products.join(", ")}`,
    `Objections handled: ${customer.objectionsHandled.join(", ")}`,
    `Signals: ${customer.signals.join(", ")}`,
    `Proof asset: ${match.asset.summary}`,
    `Evidence: ${customer.evidence.map((evidence) => `${evidence.title}: ${evidence.claim}`).join(" | ")}`,
  ].join("\n");
}

async function rankWithGemini(deal: Deal, matches: ProofMatch[], apiKey: string, model: string) {
  try {
    const prompt = [
      "You are ProofOps, an Attio sales proof agent.",
      "Return strict JSON with keys note, email, fit, risks, riskExplanation, recommendedAction, objectionMatch.",
      "Do not invent customer claims. Use only the supplied deal, proof match and evidence.",
      "Keep evidence and claims separate. If consent is restricted, recommend anonymised proof or approval request.",
      `Deal: ${JSON.stringify(deal)}`,
      `Top proof match: ${JSON.stringify(matches[0])}`,
    ].join("\n\n");

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini returned ${response.status}`);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
    const parsed = parseJsonObject(text);
    const topMatch = {
      ...matches[0],
      note: typeof parsed.note === "string" ? parsed.note : matches[0].note,
      email: typeof parsed.email === "string" ? parsed.email : matches[0].email,
      fit: isStringArray(parsed.fit) ? parsed.fit : matches[0].fit,
      risks: isStringArray(parsed.risks) ? parsed.risks : matches[0].risks,
      riskExplanation: typeof parsed.riskExplanation === "string" ? parsed.riskExplanation : matches[0].riskExplanation,
      recommendedAction: typeof parsed.recommendedAction === "string" ? parsed.recommendedAction : matches[0].recommendedAction,
      objectionMatch: isStringArray(parsed.objectionMatch) ? parsed.objectionMatch : matches[0].objectionMatch,
    };

    return {
      matches: [topMatch, ...matches.slice(1)],
      used: true,
      trace: {
        label: "Gemini reasoning",
        detail: `Generated proof judgement, next action and drafts with ${model}.`,
        status: "complete" as const,
      },
    };
  } catch (error) {
    return {
      matches,
      used: false,
      trace: {
        label: "Gemini reasoning",
        detail: `Gemini judgement failed; deterministic local judgement is shown: ${error instanceof Error ? error.message : "unknown error"}.`,
        status: "failed" as const,
      },
    };
  }
}

async function writeAttioTask(deal: Deal, match: ProofMatch, env: Env, dealRecordId?: string): Promise<ProofRun["attioWrite"]> {
  const token = env.ATTIO_API_KEY;
  if (!token) {
    return { status: "skipped" };
  }

  if ((env.ATTIO_WRITE_MODE || "dry-run") !== "live") {
    return { status: "dry-run" };
  }

  try {
    const response = await fetch("https://api.attio.com/v2/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        data: cleanObject({
          content: `${match.recommendedAction}\n\n${match.note}`,
          format: "plaintext",
          deadline_at: deadlineIso(),
          is_completed: false,
          linked_records: linkedRecords(env, dealRecordId),
          assignees: env.ATTIO_ASSIGNEE_ID
            ? [
                {
                  referenced_actor_type: "workspace-member",
                  referenced_actor_id: env.ATTIO_ASSIGNEE_ID,
                },
              ]
            : undefined,
        }),
      }),
    });

    if (!response.ok) {
      throw new Error(`Attio task create returned ${response.status}`);
    }

    const payload = (await response.json()) as { data?: { id?: { task_id?: string } } };
    const summaryUpdated = await maybeUpdateAttioRecord(deal, match, env, dealRecordId);
    return { status: "created", taskId: payload.data?.id?.task_id, summaryUpdated };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown Attio write error",
    };
  }
}

async function slngTextToSpeech(text: string, env: Env): Promise<{ statusCode: number; contentType: string; body: Uint8Array }> {
  try {
    const response = await fetchWithRetry(env.SLNG_TTS_URL || "https://api.slng.ai/v1/tts/slng/deepgram/aura:2-en", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.SLNG_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.SLNG_TTS_MODEL || "aura-2-thalia-en",
        text: truncate(text, 1200),
      }),
    });

    const contentType = response.headers.get("content-type") || (response.ok ? "audio/mpeg" : "application/json");
    const arrayBuffer = await response.arrayBuffer();
    return {
      statusCode: response.status,
      contentType,
      body: new Uint8Array(arrayBuffer),
    };
  } catch (error) {
    return {
      statusCode: 502,
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({ error: `SLNG TTS request failed: ${errorMessage(error)}` })),
    };
  }
}

async function slngSpeechToText(req: IncomingMessage, contentType: string, env: Env): Promise<{ statusCode: number; contentType: string; body: string }> {
  const rawBody = await readRaw(req, Number(env.SLNG_AUDIO_LIMIT_BYTES || 12_000_000));
  try {
    const response = await fetchWithRetry(env.SLNG_STT_URL || "https://api.slng.ai/v1/stt/slng/deepgram/nova:3-en", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.SLNG_API_KEY}`,
        "content-type": contentType,
      },
      body: new Uint8Array(rawBody),
    });

    return {
      statusCode: response.status,
      contentType: response.headers.get("content-type") || "application/json",
      body: await response.text(),
    };
  } catch (error) {
    return {
      statusCode: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: `SLNG STT request failed: ${errorMessage(error)}` }),
    };
  }
}

async function maybeUpdateAttioRecord(deal: Deal, match: ProofMatch, env: Env, dealRecordId?: string) {
  const recordId = dealRecordId || env.ATTIO_DEAL_RECORD_ID;
  if (!env.ATTIO_API_KEY || !env.ATTIO_DEAL_OBJECT || !recordId || !env.ATTIO_PROOF_ATTRIBUTE) {
    return false;
  }

  const response = await fetch(`https://api.attio.com/v2/objects/${env.ATTIO_DEAL_OBJECT}/records/${recordId}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${env.ATTIO_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      data: {
        values: {
          [env.ATTIO_PROOF_ATTRIBUTE]: `${deal.company}: ${match.note}`,
        },
      },
    }),
  });

  return response.ok;
}

async function fetchAttioRecord(objectSlug: string, recordId: string, apiKey: string): Promise<AttioRecord> {
  const response = await fetch(`https://api.attio.com/v2/objects/${objectSlug}/records/${recordId}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Attio record read returned ${response.status}`);
  return (await response.json()) as AttioRecord;
}

async function queryAttioRecords(objectSlug: string, apiKey: string) {
  const response = await fetch(`https://api.attio.com/v2/objects/${objectSlug}/records/query`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ limit: 20 }),
  });
  if (!response.ok) throw new Error(`Attio record query returned ${response.status}`);
  const payload = (await response.json()) as { data?: AttioRecord["data"][] };
  return (payload.data || []).map((data) => ({ data }));
}

function attioRecordToCustomer(record: AttioRecord, env: Env, index: number): Customer | undefined {
  const company = stringValue(record, env.ATTIO_PROOF_COMPANY_ATTRIBUTE || "company");
  if (!company) return undefined;

  return {
    id: record.data?.id?.record_id || `attio-proof-${index + 1}`,
    company,
    sector: stringValue(record, env.ATTIO_PROOF_SECTOR_ATTRIBUTE || "sector") || "Unknown sector",
    segment: stringValue(record, env.ATTIO_PROOF_SEGMENT_ATTRIBUTE || "segment") || "Unknown segment",
    champion: stringValue(record, env.ATTIO_PROOF_CHAMPION_ATTRIBUTE || "champion") || "Account owner",
    consent: consentValue(record, env.ATTIO_PROOF_CONSENT_ATTRIBUTE || "consent"),
    consentExpiresAt: stringValue(record, env.ATTIO_PROOF_CONSENT_EXPIRES_ATTRIBUTE || "consent_expires_at"),
    outcomes: listValue(record, env.ATTIO_PROOF_OUTCOMES_ATTRIBUTE || "outcomes", ["Outcome recorded in Attio"]),
    products: listValue(record, env.ATTIO_PROOF_PRODUCTS_ATTRIBUTE || "products", ["proof asset"]),
    objectionsHandled: listValue(record, env.ATTIO_PROOF_OBJECTIONS_ATTRIBUTE || "objections_handled", ["buyer risk"]),
    signals: listValue(record, env.ATTIO_PROOF_SIGNALS_ATTRIBUTE || "signals", ["stored proof asset"]),
    renewalHealth: numberValue(record, env.ATTIO_PROOF_HEALTH_ATTRIBUTE || "renewal_health") || 75,
    evidence: [
      {
        title: stringValue(record, env.ATTIO_PROOF_EVIDENCE_TITLE_ATTRIBUTE || "evidence_title") || "Attio proof evidence",
        source: "Attio proof object",
        type: "note",
        claim: stringValue(record, env.ATTIO_PROOF_EVIDENCE_CLAIM_ATTRIBUTE || "evidence_claim") || "Evidence stored in Attio.",
        confidence: numberValue(record, env.ATTIO_PROOF_EVIDENCE_CONFIDENCE_ATTRIBUTE || "evidence_confidence") || 75,
        provider: "attio",
      },
    ],
  };
}

function normaliseInlineDeal(value: unknown): Deal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Partial<Deal>;
  if (!body.id || !body.company) return undefined;
  return {
    id: String(body.id),
    company: String(body.company),
    stage: body.stage || "Stalled",
    value: body.value || "Unknown",
    owner: body.owner || "Unassigned",
    stalledDays: body.stalledDays || 14,
    segment: body.segment || "Unknown segment",
    useCase: body.useCase || "Proof request from Attio",
    objections: Array.isArray(body.objections) ? body.objections : [],
    risk: body.risk || "Deal needs relevant proof before the next buyer response.",
    nextMeeting: body.nextMeeting || "Next customer touchpoint",
  };
}

function isWebhookAuthorised(req: IncomingMessage, env: Env) {
  if (!env.PROOFOPS_WEBHOOK_SECRET) return true;
  const directSecret = headerValue(req, "x-proofops-secret");
  const auth = headerValue(req, "authorization");
  return directSecret === env.PROOFOPS_WEBHOOK_SECRET || auth === `Bearer ${env.PROOFOPS_WEBHOOK_SECRET}`;
}

function getIdempotencyKey(req: IncomingMessage, body: JsonBody) {
  const explicit = headerValue(req, "idempotency-key") || stringField(body, "idempotencyKey");
  if (explicit) return explicit;
  const eventId = Array.isArray(body.events) ? stringField(body.events[0] as JsonBody, "event_id") || stringField(body.events[0] as JsonBody, "id") : undefined;
  const dealId = getDealId(body);
  return eventId || (dealId ? `attio-proofops:${dealId}` : undefined);
}

function getCachedRun(key: string) {
  const cached = runCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt < Date.now()) {
    runCache.delete(key);
    return undefined;
  }
  return cached.run;
}

function cacheRun(key: string, run: ProofRun, env: Env) {
  const ttlMs = Number(env.PROOFOPS_IDEMPOTENCY_TTL_MS || 3_600_000);
  runCache.set(key, { run, expiresAt: Date.now() + ttlMs });
}

function markDuplicate(run: ProofRun): ProofRun {
  return {
    ...run,
    security: {
      ...run.security,
      duplicateSuppressed: true,
    },
    trace: [
      ...run.trace,
      {
        label: "Duplicate guard",
        detail: "Repeated workflow event suppressed using the idempotency key.",
        status: "complete",
      },
    ],
  };
}

function linkedRecords(env: Env, dealRecordId?: string) {
  if (env.ATTIO_LINKED_RECORDS_JSON) {
    try {
      return JSON.parse(env.ATTIO_LINKED_RECORDS_JSON);
    } catch {
      return undefined;
    }
  }

  if (env.ATTIO_DEAL_OBJECT && dealRecordId) {
    return [
      {
        target_object: env.ATTIO_DEAL_OBJECT,
        target_record_id: dealRecordId,
      },
    ];
  }

  return env.ATTIO_LINKED_RECORDS ? env.ATTIO_LINKED_RECORDS.split(",").map((value) => value.trim()) : undefined;
}

function describeAttioWrite(status: ProofRun["attioWrite"]["status"]) {
  if (status === "created") return "Created an Attio task and attempted the configured proof summary update.";
  if (status === "dry-run") return "Attio credentials are present; live mutation is off until ATTIO_WRITE_MODE=live.";
  if (status === "skipped") return "Awaiting ATTIO_API_KEY before CRM write-back.";
  return "Attio write failed.";
}

function readJson(req: IncomingMessage): Promise<JsonBody> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body) as JsonBody);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function readRaw(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let rejected = false;

    req.on("data", (chunk) => {
      if (rejected) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > limitBytes) {
        rejected = true;
        reject(new Error(`Audio upload exceeded ${limitBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.writeHead(statusCode, jsonHeaders);
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, statusCode: number, contentType: string, body: string) {
  res.writeHead(statusCode, { "content-type": contentType, "cache-control": "no-store" });
  res.end(body);
}

function sendBinary(res: ServerResponse, statusCode: number, contentType: string, body: Uint8Array) {
  res.writeHead(statusCode, { "content-type": contentType, "cache-control": "no-store" });
  res.end(Buffer.from(body));
}

function headerValue(req: IncomingMessage, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function compactHeaders(headers: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value)) as Record<string, string>;
}

function cleanObject<T extends Record<string, unknown>>(object: T) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function deadlineIso() {
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 2);
  return deadline.toISOString();
}

function parseJsonObject(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    }
    return {};
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function stringField(body: JsonBody, key: string) {
  const value = body?.[key];
  return typeof value === "string" ? value : undefined;
}

function fixtureString(values: Record<string, unknown>, key: string, fallback: string): string;
function fixtureString(values: Record<string, unknown>, key: string, fallback: undefined): string | undefined;
function fixtureString(values: Record<string, unknown>, key: string, fallback: string | undefined) {
  const value = values[key];
  if (typeof value === "string") return value || fallback;
  if (typeof value === "number") return String(value);
  return fallback;
}

function fixtureNumber(values: Record<string, unknown>, key: string, fallback: number) {
  const value = values[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function fixtureList(value: unknown, fallback: string[] = []) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  return fallback;
}

function fixtureStage(value: unknown): DealStage {
  const normalised = String(value || "").toLowerCase();
  if (normalised.includes("discovery")) return "Discovery";
  if (normalised.includes("evaluation")) return "Evaluation";
  if (normalised.includes("procurement")) return "Procurement";
  return "Stalled";
}

function fixtureConsent(value: unknown): Consent {
  const normalised = String(value || "").toLowerCase();
  if (normalised.includes("approved")) return "approved";
  if (normalised.includes("expired")) return "expired";
  if (normalised.includes("restricted")) return "restricted";
  return "pending";
}

function formatCurrency(value: string) {
  const match = value.match(/^GBP\s+([0-9]+)/i);
  if (!match) return value;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return value;
  return `GBP ${Math.round(amount / 1000)}k`;
}

function stringValue(record: AttioRecord, attribute: string) {
  const raw = rawValue(record, attribute);
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return String(raw);
  return undefined;
}

function numberValue(record: AttioRecord, attribute: string) {
  const raw = rawValue(record, attribute);
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function listValue(record: AttioRecord, attribute: string, fallback: string[] = []) {
  const raw = rawValue(record, attribute);
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string") return raw.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  return fallback;
}

function stageValue(record: AttioRecord, attribute: string): Deal["stage"] {
  const value = stringValue(record, attribute)?.toLowerCase() || "";
  if (value.includes("discovery")) return "Discovery";
  if (value.includes("evaluation")) return "Evaluation";
  if (value.includes("procurement")) return "Procurement";
  return "Stalled";
}

function consentValue(record: AttioRecord, attribute: string): Customer["consent"] {
  const value = stringValue(record, attribute)?.toLowerCase() || "";
  if (value.includes("approved")) return "approved";
  if (value.includes("pending")) return "pending";
  if (value.includes("expired")) return "expired";
  if (value.includes("restricted")) return "restricted";
  return "pending";
}

function rawValue(record: AttioRecord, attribute: string): unknown {
  const values = record.data?.values || {};
  const value = values[attribute];
  return unwrapAttioValue(value);
}

function unwrapAttioValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(unwrapAttioValue).filter((item) => item !== undefined && item !== "");
    return items.length === 1 ? items[0] : items;
  }

  if (!value || typeof value !== "object") return value;

  const object = value as Record<string, unknown>;
  for (const key of ["value", "target_record_id", "record_id", "title", "name", "option", "status", "full_name", "email_address", "currency_value"]) {
    if (object[key] !== undefined) return unwrapAttioValue(object[key]);
  }

  if (typeof object.referenced_actor_id === "string") return object.referenced_actor_id;
  return undefined;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function normaliseEndpoint(value: string | undefined) {
  if (!value) throw new Error("SIE_ENDPOINT is not configured");
  return value.replace(/\/$/, "");
}

async function fetchWithRetry(url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch (firstError) {
    await delay(250);
    try {
      return await fetch(url, init);
    } catch (secondError) {
      throw new Error(`${errorMessage(secondError)} after retry; first attempt: ${errorMessage(firstError)}`);
    }
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}
