import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  Brain,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ClipboardCheck,
  Database,
  ExternalLink,
  FileCheck2,
  Filter,
  Link2,
  Mail,
  Mic,
  Network,
  Play,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Target,
  UserCheck,
  Volume2,
} from "lucide-react";
import "./styles.css";
import { deals as fallbackDeals, getBestMatches, type Deal, type ProofMatch, type ProofRun } from "./domain";

type RunStatus = "idle" | "running" | "complete" | "error";
type VoiceStatus = "idle" | "recording" | "transcribing" | "speaking" | "error";
type DealsResponse = {
  data?: Deal[];
  meta?: {
    source?: string;
    count?: number;
  };
};

function App() {
  const [dealList, setDealList] = useState<Deal[]>(fallbackDeals);
  const [dealSource, setDealSource] = useState("domain fallback");
  const [selectedDealId, setSelectedDealId] = useState(fallbackDeals[0].id);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [activeTab, setActiveTab] = useState<"matches" | "writes" | "sources">("matches");
  const [run, setRun] = useState<ProofRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const selectedDeal = dealList.find((deal) => deal.id === selectedDealId) ?? dealList[0] ?? fallbackDeals[0];
  const fallbackMatches = useMemo(() => getBestMatches(selectedDeal), [selectedDeal]);
  const matches = run?.deal.id === selectedDeal.id ? run.matches : fallbackMatches;
  const topMatch = matches[0];
  const runComplete = status === "complete";
  const showResults = status === "complete" || status === "error";

  useEffect(() => {
    let cancelled = false;

    fetch("/api/deals")
      .then((response) => {
        if (!response.ok) throw new Error(`Deals API returned ${response.status}`);
        return response.json() as Promise<DealsResponse>;
      })
      .then((payload) => {
        const incoming = payload.data?.length ? payload.data : fallbackDeals;
        if (cancelled) return;

        setDealList(incoming);
        setDealSource(payload.meta?.source === "fixture-crm" ? "fixture CRM" : "domain fallback");
        setSelectedDealId((current) => (incoming.some((deal) => deal.id === current) ? current : incoming[0].id));
      })
      .catch(() => {
        if (cancelled) return;
        setDealList(fallbackDeals);
        setDealSource("domain fallback");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      stopVoiceStream(mediaStreamRef);
    };
  }, []);

  const runAgent = async (dealOverride?: Deal) => {
    const targetDeal = dealOverride || selectedDeal;
    const targetFallbackMatches = getBestMatches(targetDeal);
    setStatus("running");
    setError(null);
    setActiveTab("matches");
    try {
      const response = await fetch("/api/proof/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dealId: targetDeal.id }),
      });
      if (!response.ok) {
        throw new Error(`ProofOps API returned ${response.status}`);
      }
      const payload = (await response.json()) as ProofRun;
      setRun(payload);
      setStatus("complete");
    } catch (apiError) {
      setRun({
        deal: targetDeal,
        matches: targetFallbackMatches,
        mode: "demo",
        dataProvider: "demo",
        retrievalProvider: "local",
        evidenceProvider: "demo",
        reasoningProvider: "local",
        security: {
          webhookVerified: false,
          duplicateSuppressed: false,
        },
        attioWrite: {
          status: "failed",
          error: apiError instanceof Error ? apiError.message : "Unknown API error",
        },
        trace: [
          {
            label: "API fallback",
            detail: "Local UI used embedded mock records because the ProofOps API run failed.",
            status: "failed",
          },
        ],
      });
      setError(apiError instanceof Error ? apiError.message : "Unknown API error");
      setStatus("error");
    }
  };

  const startVoiceRecording = async () => {
    setVoiceError(null);
    setVoiceTranscript("");

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceStatus("error");
      setVoiceError("This browser cannot record microphone audio.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const audio = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stopVoiceStream(mediaStreamRef);
        void transcribeVoice(audio);
      };
      recorder.onerror = () => {
        stopVoiceStream(mediaStreamRef);
        setVoiceStatus("error");
        setVoiceError("Voice capture failed.");
      };

      recorder.start();
      setVoiceStatus("recording");
    } catch (recordingError) {
      setVoiceStatus("error");
      setVoiceError(recordingError instanceof Error ? recordingError.message : "Microphone permission was not granted.");
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      setVoiceStatus("transcribing");
      mediaRecorderRef.current.stop();
    }
  };

  const transcribeVoice = async (audio: Blob) => {
    try {
      if (!audio.size) {
        throw new Error("No audio was captured.");
      }

      setVoiceStatus("transcribing");
      const formData = new FormData();
      formData.append("audio", audio, "proofops-command.webm");
      formData.append("model", "nova-3");

      const response = await fetch("/api/voice/stt", {
        method: "POST",
        body: formData,
      });
      const text = await response.text();
      const payload = parseMaybeJson(text);
      if (!response.ok) {
        throw new Error(extractApiError(payload) || `SLNG transcription returned ${response.status}`);
      }

      const transcript = extractTranscript(payload);
      if (!transcript) {
        throw new Error("SLNG returned no transcript.");
      }

      setVoiceTranscript(transcript);
      setVoiceStatus("idle");

      const transcriptDeal = findDealInTranscript(transcript, dealList);
      const targetDeal = transcriptDeal || selectedDeal;
      if (transcriptDeal && transcriptDeal.id !== selectedDeal.id) {
        setSelectedDealId(transcriptDeal.id);
        setRun(null);
        setError(null);
      }
      if (shouldRunFromTranscript(transcript)) {
        void runAgent(targetDeal);
      }
    } catch (voiceFailure) {
      setVoiceStatus("error");
      setVoiceError(voiceFailure instanceof Error ? voiceFailure.message : "SLNG transcription failed.");
    }
  };

  const speakSummary = async () => {
    if (!run) return;

    setVoiceStatus("speaking");
    setVoiceError(null);

    try {
      const response = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: formatVoiceSummary(run) }),
      });

      if (!response.ok) {
        const payload = parseMaybeJson(await response.text());
        throw new Error(extractApiError(payload) || `SLNG speech returned ${response.status}`);
      }

      const audio = new Audio(URL.createObjectURL(await response.blob()));
      audio.onended = () => {
        URL.revokeObjectURL(audio.src);
        setVoiceStatus("idle");
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audio.src);
        setVoiceStatus("error");
        setVoiceError("Generated speech could not be played.");
      };
      await audio.play();
    } catch (voiceFailure) {
      setVoiceStatus("error");
      setVoiceError(voiceFailure instanceof Error ? voiceFailure.message : "SLNG speech failed.");
    }
  };

  return (
    <main className="shell">
      <Sidebar />
      <section className="workspace">
        <Header status={status} onRun={() => runAgent()} />
        <div className="grid">
          <section className="panel deals-panel">
            <PanelTitle icon={<Target size={17} />} title="Attio Trigger" action="Workflow" />
            <div className="trigger-card">
              <div className="trigger-icon"><CircleDashed size={20} /></div>
              <div>
                <p className="eyebrow">Trigger</p>
                <h2>Deal stalled for 14 days</h2>
                <p>ProofOps reads CRM context, semantically matches proof, verifies live public evidence with Tavily and writes the next action back to Attio.</p>
              </div>
            </div>
            <div className="toolbar">
              <div className="searchbox">
                <Search size={15} />
                <span>{dealList.length} deals from {dealSource}</span>
              </div>
              <button className="icon-button" aria-label="Filter deals" title="Filter deals">
                <Filter size={16} />
              </button>
            </div>
            <div className="deal-list">
              {dealList.map((deal) => (
                <button
                  className={`deal-row ${deal.id === selectedDealId ? "active" : ""}`}
                  key={deal.id}
                  onClick={() => {
                    setSelectedDealId(deal.id);
                    setStatus("idle");
                    setRun(null);
                    setError(null);
                    setVoiceTranscript("");
                    setVoiceError(null);
                  }}
                >
                  <span className="company-mark">{deal.company.slice(0, 1)}</span>
                  <span className="deal-main">
                    <strong>{deal.company}</strong>
                    <small>{deal.stage} · {deal.value} · {deal.stalledDays}d quiet</small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
          </section>

          <section className="panel deal-detail">
            <PanelTitle icon={<Building2 size={17} />} title="Selected Deal" action={selectedDeal.stage} />
            <div className="metric-row">
              <Metric label="Value" value={selectedDeal.value} />
              <Metric label="Owner" value={selectedDeal.owner} />
              <Metric label="Next" value={selectedDeal.nextMeeting} />
            </div>
            <div className="detail-block">
              <p className="label">Use Case</p>
              <p>{selectedDeal.useCase}</p>
            </div>
            <div className="detail-block">
              <p className="label">Deal Risk</p>
              <p>{selectedDeal.risk}</p>
            </div>
            <div className="chips">
              {selectedDeal.objections.map((objection) => (
                <span key={objection}>{objection}</span>
              ))}
            </div>
          </section>

          <section className="panel agent-panel">
            <PanelTitle icon={<Sparkles size={17} />} title="ProofOps Agent" action={status === "running" ? "Running" : runComplete ? "Complete" : status === "error" ? "Fallback" : "Ready"} />
            <div className="agent-flow">
              <FlowStep icon={<Database size={18} />} label="Read Attio" active={status !== "idle"} done={runComplete && run?.dataProvider === "attio"} />
              <FlowStep icon={<Network size={18} />} label="Semantic Match" active={status !== "idle"} done={runComplete && run?.retrievalProvider === "superlinked"} />
              <FlowStep icon={<Search size={18} />} label="Verify Evidence" active={status !== "idle"} done={runComplete && run?.evidenceProvider === "tavily"} />
              <FlowStep icon={<Brain size={18} />} label="Rank Proof" active={status !== "idle"} done={runComplete && run?.reasoningProvider === "gemini"} />
              <FlowStep icon={<ClipboardCheck size={18} />} label="Write Back" active={runComplete} done={runComplete && run?.attioWrite.status === "created"} />
            </div>
            <button className="run-button" onClick={() => runAgent()} disabled={status === "running"}>
              {status === "running" ? <RefreshCcw size={18} className="spin" /> : <Play size={18} />}
              {status === "running" ? "Matching proof" : "Find proof for this deal"}
            </button>
            <VoiceControls
              status={voiceStatus}
              transcript={voiceTranscript}
              error={voiceError}
              hasRun={Boolean(run)}
              onRecord={voiceStatus === "recording" ? stopVoiceRecording : startVoiceRecording}
              onSpeak={speakSummary}
            />
            <p className="agent-note">
              {run ? formatRunSummary(run) : "Ready for Attio Workflow input. Add keys when you want live evidence, reasoning and CRM write-back."}
            </p>
            {error && <p className="error-note">API fallback: {error}</p>}
          </section>

          <section className="panel results-panel">
            <div className="tabs">
              <button className={activeTab === "matches" ? "selected" : ""} onClick={() => setActiveTab("matches")}>
                <BadgeCheck size={15} /> Matches
              </button>
              <button className={activeTab === "writes" ? "selected" : ""} onClick={() => setActiveTab("writes")}>
                <FileCheck2 size={15} /> Attio writes
              </button>
              <button className={activeTab === "sources" ? "selected" : ""} onClick={() => setActiveTab("sources")}>
                <BookOpenCheck size={15} /> Evidence
              </button>
            </div>
            {!showResults && (
              <div className="empty-state">
                <Network size={30} />
                <h2>No proof match generated yet</h2>
                <p>Run the workflow to create consent-aware proof recommendations for {selectedDeal.company}.</p>
              </div>
            )}
            {showResults && <OutcomeSnapshot deal={selectedDeal} match={topMatch} run={run} />}
            {showResults && <ReferencePack match={topMatch} run={run} />}
            {showResults && activeTab === "matches" && <MatchesView matches={matches} />}
            {showResults && activeTab === "writes" && <WritesView deal={selectedDeal} match={topMatch} run={run} />}
            {showResults && activeTab === "sources" && <SourcesView match={topMatch} />}
            {showResults && run && <TraceView run={run} />}
          </section>
        </div>
      </section>
    </main>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">P</div>
        <div>
          <strong>ProofOps</strong>
          <span>Attio agent</span>
        </div>
      </div>
      <nav>
        <a className="active"><Activity size={17} /> Workflow</a>
        <a><UserCheck size={17} /> References</a>
        <a><ShieldCheck size={17} /> Consent</a>
        <a><Link2 size={17} /> Sources</a>
      </nav>
      <div className="partner-stack">
        <p>Partner stack</p>
        <Partner name="Attio" role="CRM action layer" />
        <Partner name="Google DeepMind" role="Reasoning and drafts" />
        <Partner name="Superlinked" role="Semantic proof retrieval" />
        <Partner name="Tavily" role="Evidence search" />
        <Partner name="SLNG" role="Voice input and output" />
      </div>
    </aside>
  );
}

function Header({ status, onRun }: { status: RunStatus; onRun: () => void }) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Attio Track · Agentic CRM</p>
        <h1>ProofOps Agent</h1>
      </div>
      <div className="topbar-actions">
        <span className={`status-pill ${status}`}>
          {status === "complete" ? <CheckCircle2 size={15} /> : <CircleDashed size={15} />}
          {status === "complete" ? "Proof ready" : status === "running" ? "Agent running" : status === "error" ? "Fallback result" : "Demo ready"}
        </span>
        <button className="primary-button" onClick={onRun}>
          <Sparkles size={16} /> Run workflow
        </button>
      </div>
    </header>
  );
}

function PanelTitle({ icon, title, action }: { icon: React.ReactNode; title: string; action: string }) {
  return (
    <div className="panel-title">
      <div><span>{icon}</span><h2>{title}</h2></div>
      <button className="mini-button">{action}<ChevronDown size={14} /></button>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FlowStep({ icon, label, active, done }: { icon: React.ReactNode; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flow-step ${active ? "active" : ""}`}>
      <span>{done ? <Check size={18} /> : icon}</span>
      <strong>{label}</strong>
    </div>
  );
}

function VoiceControls({
  status,
  transcript,
  error,
  hasRun,
  onRecord,
  onSpeak,
}: {
  status: VoiceStatus;
  transcript: string;
  error: string | null;
  hasRun: boolean;
  onRecord: () => void;
  onSpeak: () => void;
}) {
  const isRecording = status === "recording";
  const isBusy = status === "transcribing" || status === "speaking";

  return (
    <div className={`voice-panel ${isRecording ? "recording" : ""}`}>
      <div className="voice-head">
        <div>
          <p className="eyebrow">SLNG voice</p>
          <strong>{voiceStatusLabel(status)}</strong>
        </div>
        <span className={`voice-dot ${status}`} />
      </div>
      <div className="voice-actions">
        <button className="voice-button" onClick={onRecord} disabled={isBusy} title="Record voice command">
          {isRecording ? <Square size={15} /> : <Mic size={15} />}
          {isRecording ? "Stop" : status === "transcribing" ? "Transcribing" : "Record"}
        </button>
        <button className="voice-button secondary" onClick={onSpeak} disabled={!hasRun || isRecording || isBusy} title="Play spoken proof summary">
          <Volume2 size={15} />
          Listen
        </button>
      </div>
      {transcript && <p className="voice-transcript">"{transcript}"</p>}
      {error && <p className="voice-error">{error}</p>}
    </div>
  );
}

function Partner({ name, role }: { name: string; role: string }) {
  return (
    <div className="partner">
      <span>{name.slice(0, 1)}</span>
      <div>
        <strong>{name}</strong>
        <small>{role}</small>
      </div>
    </div>
  );
}

function MatchesView({ matches }: { matches: ProofMatch[] }) {
  return (
    <div className="match-grid">
      {matches.slice(0, 3).map((match, index) => (
        <article className={`match-card ${index === 0 ? "best" : ""}`} key={match.customer.id}>
          <div className="match-head">
            <div>
              <p className="eyebrow">{index === 0 ? "Recommended proof" : "Alternative"}</p>
              <h3>{match.customer.company}</h3>
            </div>
            <strong className="score">{match.score}%</strong>
          </div>
          <p>{match.asset.summary}</p>
          <div className={`consent-card ${match.consentPolicy.severity}`}>
            <strong>{match.consentPolicy.label}</strong>
            <span>{match.consentPolicy.externalUse}</span>
          </div>
          <div className="chips">
            <span>{match.customer.segment}</span>
            <span>{match.customer.sector}</span>
            <span>{match.objectionMatch.length} objection match{match.objectionMatch.length === 1 ? "" : "es"}</span>
          </div>
          <ul className="plain-list">
            {match.fit.map((fit) => <li key={fit}>{fit}</li>)}
          </ul>
          <p className="risk-copy">{match.riskExplanation}</p>
        </article>
      ))}
    </div>
  );
}

function ReferencePack({ match, run }: { match: ProofMatch; run: ProofRun | null }) {
  const liveSources = match.customer.evidence.filter((source) => source.provider === "tavily" && source.url);
  const linkedSources = liveSources.length ? liveSources : match.customer.evidence.filter((source) => source.url);
  const shownSources = linkedSources.slice(0, 2);
  const crmSource = run?.dataProvider === "attio" ? "Live Attio proof asset" : "Fixture CRM proof asset";
  const sourceLabel = liveSources.length ? `${liveSources.length} live Tavily source${liveSources.length === 1 ? "" : "s"}` : `${match.customer.evidence.length} stored proof source${match.customer.evidence.length === 1 ? "" : "s"}`;

  return (
    <section className="reference-pack" aria-label="Generated proof reference, consent and sources">
      <article className="reference-card">
        <p className="eyebrow">Reference</p>
        <h3>{match.customer.company}</h3>
        <p>{match.customer.champion}</p>
        <div className="reference-meta">
          <span>{crmSource}</span>
          <span>{match.customer.sector}</span>
          <span>{match.customer.segment}</span>
        </div>
      </article>
      <article className={`reference-card consent-${match.consentPolicy.severity}`}>
        <p className="eyebrow">Consent</p>
        <h3>{match.consentPolicy.label}</h3>
        <p>{match.consentPolicy.externalUse}</p>
        <div className="reference-meta">
          <span>{formatConsentExpiry(match.customer.consentExpiresAt)}</span>
          <span>{match.consentPolicy.nextAction}</span>
        </div>
      </article>
      <article className="reference-card">
        <p className="eyebrow">Sources</p>
        <h3>{sourceLabel}</h3>
        {shownSources.length > 0 ? (
          <div className="mini-source-list">
            {shownSources.map((source) => (
              <a href={source.url} target="_blank" rel="noreferrer" key={`${source.title}-${source.url}`}>
                <ExternalLink size={14} />
                <span>{source.title}</span>
              </a>
            ))}
          </div>
        ) : (
          <p>{match.customer.evidence[0]?.claim || "Stored proof evidence is available for this reference."}</p>
        )}
      </article>
    </section>
  );
}

function WritesView({ deal, match, run }: { deal: Deal; match: ProofMatch; run: ProofRun | null }) {
  return (
    <div className="write-layout">
      <div className="write-card">
        <p className="eyebrow">Attio summary field</p>
        <h3>{deal.company}</h3>
        <p>{match.note}</p>
      </div>
      <div className="write-card">
        <p className="eyebrow">Attio task</p>
        <h3>{match.recommendedAction}</h3>
        <p>Owner: {deal.owner}. Due before {deal.nextMeeting.toLowerCase()}.</p>
        {run && <span className={`write-status ${run.attioWrite.status}`}>{formatWriteStatus(run.attioWrite.status)}</span>}
      </div>
      <div className="email-card">
        <div className="email-head">
          <Mail size={18} />
          <strong>Draft reference request</strong>
        </div>
        <pre>{match.email}</pre>
      </div>
    </div>
  );
}

function SourcesView({ match }: { match: ProofMatch }) {
  return (
    <div className="sources">
      {match.customer.evidence.map((source) => (
        <article className="source-row" key={`${source.title}-${source.source}`}>
          <span><ExternalLink size={16} /></span>
          <div>
            {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : <strong>{source.title}</strong>}
            <small>{source.source} · {source.type}</small>
            <p>{source.claim}</p>
          </div>
          <div className="source-badges">
            <span className={`source-tag ${source.provider === "tavily" ? "live" : ""}`}>{formatEvidenceProvider(source.provider)}</span>
            <span className="verified">{source.confidence}% confidence</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function OutcomeSnapshot({ deal, match, run }: { deal: Deal; match: ProofMatch; run: ProofRun | null }) {
  return (
    <div className="outcome-snapshot">
      <div>
        <p className="eyebrow">Before</p>
        <strong>{deal.stalledDays} days quiet</strong>
        <span>{deal.risk}</span>
      </div>
      <ArrowRight size={18} />
      <div>
        <p className="eyebrow">After</p>
        <strong>{match.customer.company} matched at {match.score}%</strong>
        <span>{match.recommendedAction}</span>
      </div>
      <div>
        <p className="eyebrow">Guardrails</p>
        <strong>{match.consentPolicy.label}</strong>
        <span>{run?.security.duplicateSuppressed ? "Duplicate workflow suppressed" : "Duplicate-safe workflow ready"}</span>
      </div>
    </div>
  );
}

function TraceView({ run }: { run: ProofRun }) {
  return (
    <div className="trace">
      {run.trace.map((step) => (
        <div className={`trace-step ${step.status}`} key={`${step.label}-${step.detail}`}>
          <span>{step.status === "complete" ? <Check size={14} /> : <CircleDashed size={14} />}</span>
          <div>
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatRunSummary(run: ProofRun) {
  const data = run.dataProvider === "attio" ? "Live Attio records" : "Fixture CRM records";
  const retrieval = run.retrievalProvider === "superlinked" ? "Superlinked semantic rerank" : "Local proof ranking";
  const evidence = run.evidenceProvider === "tavily" ? "Live Tavily web evidence" : "Stored CRM/test evidence";
  const reasoning = run.reasoningProvider === "gemini" ? "Gemini judgement" : "Local judgement";
  const write = formatWriteStatus(run.attioWrite.status);
  return `${data}. ${retrieval}. ${evidence}. ${reasoning}. ${write}.`;
}

function formatEvidenceProvider(provider: ProofMatch["customer"]["evidence"][number]["provider"]) {
  if (provider === "tavily") return "Live web";
  if (provider === "attio") return "Attio record";
  return "Fixture note";
}

function formatConsentExpiry(value: string | undefined) {
  if (!value) return "No expiry recorded";
  return `Consent expires ${value}`;
}

function formatWriteStatus(status: ProofRun["attioWrite"]["status"]) {
  if (status === "created") return "CRM write created";
  if (status === "dry-run") return "CRM write rehearsed";
  if (status === "skipped") return "Awaiting Attio key";
  return "Write needs attention";
}

function formatVoiceSummary(run: ProofRun) {
  const match = run.matches[0];
  return [
    `ProofOps matched ${run.deal.company} with ${match.customer.company} at ${match.score} percent fit.`,
    run.retrievalProvider === "superlinked" ? "Superlinked reranked the proof inventory semantically." : "Local proof ranking was used.",
    `The recommended action is: ${match.recommendedAction}.`,
    `Consent status is ${match.consentPolicy.label}.`,
    `Attio write-back status: ${formatWriteStatus(run.attioWrite.status)}.`,
  ].join(" ");
}

function voiceStatusLabel(status: VoiceStatus) {
  if (status === "recording") return "Listening";
  if (status === "transcribing") return "Transcribing";
  if (status === "speaking") return "Speaking";
  if (status === "error") return "Needs attention";
  return "Voice ready";
}

function stopVoiceStream(streamRef: React.MutableRefObject<MediaStream | null>) {
  streamRef.current?.getTracks().forEach((track) => track.stop());
  streamRef.current = null;
}

function parseMaybeJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function extractTranscript(payload: Record<string, unknown>) {
  const direct = stringValue(payload.transcript) || stringValue(payload.text);
  if (direct) return direct;

  const data = objectValue(payload.data);
  const dataTranscript = data ? stringValue(data.transcript) || stringValue(data.text) : undefined;
  if (dataTranscript) return dataTranscript;

  const results = objectValue(payload.results);
  const channels = Array.isArray(results?.channels) ? results.channels : [];
  const firstChannel = objectValue(channels[0]);
  const alternatives = Array.isArray(firstChannel?.alternatives) ? firstChannel.alternatives : [];
  const firstAlternative = objectValue(alternatives[0]);
  return stringValue(firstAlternative?.transcript) || "";
}

function extractApiError(payload: Record<string, unknown>) {
  const error = payload.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return stringValue((error as Record<string, unknown>).message);
  }
  return stringValue(payload.message) || stringValue(payload.raw);
}

function shouldRunFromTranscript(transcript: string) {
  const normalised = transcript.toLowerCase();
  return ["run", "proof", "match", "find", "recommend"].some((keyword) => normalised.includes(keyword));
}

function findDealInTranscript(transcript: string, dealList: Deal[]) {
  const normalised = transcript.toLowerCase();
  return dealList.find((deal) => normalised.includes(deal.company.toLowerCase()));
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

createRoot(document.getElementById("root")!).render(<App />);
