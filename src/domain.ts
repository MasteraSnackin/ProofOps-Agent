export type Consent = "approved" | "pending" | "restricted" | "expired";
export type DealStage = "Discovery" | "Evaluation" | "Stalled" | "Procurement";

export type ConsentPolicy = {
  label: string;
  externalUse: string;
  nextAction: string;
  severity: "clear" | "needs-action" | "blocked";
};

export type Customer = {
  id: string;
  company: string;
  sector: string;
  segment: string;
  champion: string;
  consent: Consent;
  consentExpiresAt?: string;
  outcomes: string[];
  products: string[];
  objectionsHandled: string[];
  signals: string[];
  evidence: Evidence[];
  renewalHealth: number;
};

export type Deal = {
  id: string;
  company: string;
  stage: DealStage;
  value: string;
  owner: string;
  stalledDays: number;
  segment: string;
  useCase: string;
  objections: string[];
  risk: string;
  nextMeeting: string;
};

export type Evidence = {
  title: string;
  source: string;
  type: "press" | "website" | "review" | "note" | "case-study";
  claim: string;
  confidence: number;
  url?: string;
  provider?: "attio" | "fixture" | "tavily";
};

export type ProofAsset = {
  id: string;
  customerId: string;
  title: string;
  summary: string;
  outcome: string;
  confidence: number;
  tags: string[];
};

export type ProofMatch = {
  customer: Customer;
  asset: ProofAsset;
  score: number;
  consentPolicy: ConsentPolicy;
  fit: string[];
  objectionMatch: string[];
  risks: string[];
  riskExplanation: string;
  recommendedAction: string;
  email: string;
  note: string;
};

export type ProofRun = {
  deal: Deal;
  matches: ProofMatch[];
  mode: "demo" | "live";
  dataProvider: "demo" | "attio";
  retrievalProvider: "local" | "superlinked";
  evidenceProvider: "demo" | "tavily";
  reasoningProvider: "local" | "gemini";
  idempotencyKey?: string;
  security: {
    webhookVerified: boolean;
    duplicateSuppressed: boolean;
  };
  attioWrite: {
    status: "dry-run" | "created" | "skipped" | "failed";
    taskId?: string;
    summaryUpdated?: boolean;
    error?: string;
  };
  trace: Array<{
    label: string;
    detail: string;
    status: "complete" | "skipped" | "failed";
  }>;
};

export const customers: Customer[] = [
  {
    id: "cus-1",
    company: "Northstar Health Trust",
    sector: "Healthcare",
    segment: "Public sector",
    champion: "Maya Hughes, Head of Operations",
    consent: "approved",
    consentExpiresAt: "2026-12-15",
    outcomes: ["47% faster triage", "12 hours saved per operations manager each month"],
    products: ["workflow automation", "AI intake assistant", "case routing"],
    objectionsHandled: ["data governance", "clinical safety", "procurement risk"],
    signals: ["renewed early", "expanded to three departments", "public innovation award"],
    renewalHealth: 94,
    evidence: [
      {
        title: "Digital care pathway award shortlist",
        source: "Trust website",
        type: "website",
        claim: "Public-sector innovation programme exists and can be referenced by category.",
        confidence: 83,
      },
      {
        title: "Operational efficiency note from QBR",
        source: "Attio note",
        type: "note",
        claim: "QBR note supports 47% faster triage and monthly operator time saved.",
        confidence: 92,
      },
      {
        title: "Public board paper mentions automation programme",
        source: "Board minutes",
        type: "press",
        claim: "Board-level automation programme is public enough to cite without private figures.",
        confidence: 78,
      },
    ],
  },
  {
    id: "cus-2",
    company: "BoroughWorks Council",
    sector: "Local government",
    segment: "Public sector",
    champion: "Elliot Stone, Transformation Lead",
    consent: "pending",
    outcomes: ["31% lower case backlog", "first response SLA improved from 5 days to 36 hours"],
    products: ["citizen service automation", "document extraction", "CRM enrichment"],
    objectionsHandled: ["legacy systems", "union concerns", "accessibility"],
    signals: ["positive pilot report", "budget uplift", "requested procurement template"],
    renewalHealth: 88,
    evidence: [
      {
        title: "Customer services improvement plan",
        source: "Council portal",
        type: "website",
        claim: "Council has a public services improvement agenda aligned with the buyer.",
        confidence: 80,
      },
      {
        title: "Pilot retrospective",
        source: "Attio note",
        type: "note",
        claim: "Internal pilot note supports backlog reduction and SLA improvement.",
        confidence: 88,
      },
      {
        title: "Transformation budget increase",
        source: "Public budget doc",
        type: "press",
        claim: "Budget source validates transformation priority but not private performance metrics.",
        confidence: 76,
      },
    ],
  },
  {
    id: "cus-3",
    company: "Meridian Logistics",
    sector: "Logistics",
    segment: "Enterprise",
    champion: "Priya Nair, VP Customer Success",
    consent: "expired",
    consentExpiresAt: "2026-03-31",
    outcomes: ["18% higher renewal rate", "support escalations down 22%"],
    products: ["account intelligence", "renewal risk monitor", "Slack alerts"],
    objectionsHandled: ["tool sprawl", "integration cost", "low CRM trust"],
    signals: ["reference-friendly champion", "published podcast mention", "multi-year renewal"],
    renewalHealth: 91,
    evidence: [
      {
        title: "Podcast mention on renewal operations",
        source: "Industry podcast",
        type: "press",
        claim: "Public mention validates operational theme but not the exact private outcome.",
        confidence: 74,
      },
      {
        title: "Expansion deal closed-won note",
        source: "Attio note",
        type: "note",
        claim: "Internal note supports expansion and renewal impact.",
        confidence: 86,
      },
      {
        title: "Public customer logo page",
        source: "Company website",
        type: "website",
        claim: "Relationship can be referenced internally; external use needs fresh approval.",
        confidence: 70,
      },
    ],
  },
  {
    id: "cus-4",
    company: "Finch Robotics",
    sector: "Manufacturing",
    segment: "Mid-market",
    champion: "Luca Greer, Revenue Operations",
    consent: "restricted",
    outcomes: ["9 hours saved weekly", "quote turnaround cut from 4 days to same-day"],
    products: ["sales engineering assistant", "quote automation"],
    objectionsHandled: ["margin leakage", "technical accuracy", "security review"],
    signals: ["private reference only", "security sign-off complete"],
    renewalHealth: 79,
    evidence: [
      {
        title: "Quote automation value note",
        source: "Attio note",
        type: "note",
        claim: "Internal note supports weekly time saved and same-day quote turnaround.",
        confidence: 91,
      },
      {
        title: "Security review completion",
        source: "Attio task",
        type: "note",
        claim: "Security concern was handled, but named external reference is restricted.",
        confidence: 84,
      },
    ],
  },
];

export const deals: Deal[] = [
  {
    id: "deal-1",
    company: "Camden Integrated Care Board",
    stage: "Stalled",
    value: "£182k",
    owner: "Ari Lane",
    stalledDays: 18,
    segment: "Public sector",
    useCase: "AI triage and operational workflow automation for referral backlog reduction",
    objections: ["data governance", "clinical safety", "evidence from similar public health buyer"],
    risk: "Champion asked for proof before board review and has not replied since.",
    nextMeeting: "Board prep call in 5 days",
  },
  {
    id: "deal-2",
    company: "Crownbridge Council",
    stage: "Evaluation",
    value: "£96k",
    owner: "Sam Patel",
    stalledDays: 9,
    segment: "Public sector",
    useCase: "Citizen service automation for inbound document-heavy requests",
    objections: ["legacy systems", "accessibility", "staff adoption"],
    risk: "Evaluation committee wants evidence from another council.",
    nextMeeting: "Procurement discovery tomorrow",
  },
  {
    id: "deal-3",
    company: "Quarry & Co",
    stage: "Procurement",
    value: "£74k",
    owner: "Noor Ahmed",
    stalledDays: 5,
    segment: "Mid-market",
    useCase: "Automated quote generation for technical sales team",
    objections: ["technical accuracy", "security review"],
    risk: "Commercial approval paused until engineering signs off.",
    nextMeeting: "Security review in 8 days",
  },
];

export function buildProofAssets(inventory: Customer[] = customers): ProofAsset[] {
  return inventory.flatMap((customer, index) => [
    {
      id: `asset-${customer.id || index + 1}`,
      customerId: customer.id,
      title: `${customer.company} proof card`,
      summary: `${customer.company} used ${customer.products[0]} to deliver ${customer.outcomes[0]}.`,
      outcome: customer.outcomes[0],
      confidence: Math.min(97, customer.renewalHealth + (customer.consent === "approved" ? 4 : customer.consent === "expired" ? -14 : -7)),
      tags: [customer.segment, customer.sector, ...customer.products, ...customer.objectionsHandled],
    },
  ]);
}

export const proofAssets: ProofAsset[] = buildProofAssets();

export function getConsentPolicy(customer: Customer): ConsentPolicy {
  if (customer.consent === "approved") {
    return {
      label: customer.consentExpiresAt ? `Approved until ${customer.consentExpiresAt}` : "Approved",
      externalUse: "Named proof can be used externally.",
      nextAction: "Attach proof to the deal and brief the owner.",
      severity: "clear",
    };
  }

  if (customer.consent === "pending") {
    return {
      label: "Consent pending",
      externalUse: "Do not share the customer name yet.",
      nextAction: "Send the reference request before external use.",
      severity: "needs-action",
    };
  }

  if (customer.consent === "restricted") {
    return {
      label: "Restricted",
      externalUse: "Use anonymised proof only unless the account owner approves.",
      nextAction: "Ask the owner for one-off reference approval.",
      severity: "blocked",
    };
  }

  return {
    label: customer.consentExpiresAt ? `Expired on ${customer.consentExpiresAt}` : "Expired",
    externalUse: "Previous approval has expired.",
    nextAction: "Refresh consent before using this proof externally.",
    severity: "blocked",
  };
}

export function scoreMatch(deal: Deal, customer: Customer, asset: ProofAsset): ProofMatch {
  const haystack = [customer.segment, customer.sector, ...customer.products, ...customer.objectionsHandled, ...customer.outcomes]
    .join(" ")
    .toLowerCase();
  const dealTerms = [deal.segment, deal.useCase, ...deal.objections].join(" ").toLowerCase();
  const overlap = dealTerms
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 4 && haystack.includes(term));
  const consentBonus = customer.consent === "approved" ? 18 : customer.consent === "pending" ? 6 : customer.consent === "restricted" ? -14 : -18;
  const segmentBonus = customer.segment === deal.segment ? 22 : 0;
  const objectionMatch = deal.objections.filter((objection) =>
    customer.objectionsHandled.some((handled) => handled.includes(objection) || objection.includes(handled))
  );
  const objectionBonus = objectionMatch.length * 14;
  const score = Math.max(32, Math.min(98, 45 + consentBonus + segmentBonus + objectionBonus + Math.min(overlap.length * 3, 12)));
  const firstName = customer.champion.split(" ")[0];
  const consentPolicy = getConsentPolicy(customer);
  const riskExplanation =
    consentPolicy.severity === "clear"
      ? "Low sharing risk: the proof is approved and the strongest claims are tied to stored evidence."
      : consentPolicy.severity === "needs-action"
        ? "Medium sharing risk: fit is strong, but the customer name should stay internal until consent is confirmed."
        : "High sharing risk: use anonymised wording or refresh consent before any named external reference.";

  return {
    customer,
    asset,
    score,
    consentPolicy,
    fit: [
      customer.segment === deal.segment ? `Same segment: ${customer.segment}` : `Adjacent segment: ${customer.segment}`,
      `${customer.company} handled ${customer.objectionsHandled.slice(0, 2).join(" and ")}`,
      `Outcome available: ${customer.outcomes[0]}`,
    ],
    objectionMatch,
    risks: [consentPolicy.externalUse, riskExplanation],
    riskExplanation,
    recommendedAction: consentPolicy.nextAction,
    email: `Hi ${firstName},\n\nWe are speaking with ${deal.company}, who are evaluating ${deal.useCase.toLowerCase()}.\n\nYour ${customer.company} work is the closest proof point: ${customer.outcomes[0]}. ${customer.consent === "approved" ? "Can we confirm the approved wording below is still accurate for this opportunity?" : "Would you be comfortable with us using this as a reference, or making a short intro if they ask?"}\n\nI have included the proposed wording below for approval.\n\nThanks,\n${deal.owner}`,
    note: `ProofOps matched ${customer.company} to ${deal.company} at ${score}% fit. Recommended proof: ${asset.outcome}. Consent: ${consentPolicy.label}. Next action: ${consentPolicy.nextAction}`,
  };
}

export function getBestMatches(deal: Deal, inventory: Customer[] = customers) {
  return buildProofAssets(inventory)
    .map((asset) => {
      const customer = inventory.find((candidate) => candidate.id === asset.customerId);
      if (!customer) throw new Error("Missing customer for proof asset");
      return scoreMatch(deal, customer, asset);
    })
    .sort((a, b) => b.score - a.score);
}
