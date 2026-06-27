# ProofOps Three-Minute Demo Voiceover

## Segment 1: Problem and Setup

ProofOps is an Attio agent for stalled sales deals. The problem is simple: a buyer asks for proof, the sales team searches old notes and case studies, and the deal slows down while everyone checks what can actually be shared. ProofOps turns that into one workflow. It starts from an Attio-style stalled deal, reads the buyer context, finds the most relevant customer proof, checks consent, verifies public sources, and prepares the next CRM action.

## Segment 2: Run the Agent

Here I select Camden Integrated Care Board. The deal is stalled, the buyer needs evidence from a similar public health organisation, and the risk is visible before the workflow runs. I click Find proof for this deal. The agent now reads the CRM context, builds a local consent-aware baseline, reranks proof candidates with Superlinked, searches live public evidence with Tavily, asks Gemini for the judgement and draft copy, and keeps Attio write-back in dry-run mode for safety.

## Segment 3: Generated Reference, Consent and Sources

The generated result recommends Northstar Health Trust as the strongest proof match. It shows the reference contact, Maya Hughes, and the consent status: approved until the fifteenth of December twenty twenty-six. This is the key value of the agent. It does not just say a customer is similar. It tells the seller whether the reference can be used, why it fits the buyer objections, and what action should happen next.

## Segment 4: Sponsor Stack in the Workflow

This is where the sponsor stack matters. Attio is the CRM entry point and the write-back target. Superlinked improves proof retrieval after the deterministic local match. Tavily adds live public sources for evidence. Google DeepMind Gemini turns the ranked match and evidence into judgement, risks, a CRM note and a buyer email draft. SLNG powers spoken input and spoken output. n8n can sit around the webhook route as the automation handoff.

## Segment 5: Live Evidence and CRM Action

Now I open the Evidence tab. These are live Tavily sources, shown separately from CRM proof notes, so the seller can see which claims come from public web evidence and which claims come from internal CRM records. In the Attio writes tab, ProofOps prepares the CRM-ready summary, follow-up task and reference request email. The write-back is rehearsed because the demo is in dry-run mode, so it is safe to show without mutating CRM records.

## Segment 6: GitHub Evidence for Judges

I also show the GitHub repo so judges can verify the sponsor usage. The sponsor page lists every partner, why it is used and where it appears in the demo. The architecture page shows the data-flow diagrams, sequence diagrams, webhook path, SLNG voice path, deployment view and trust boundaries. That makes the sponsor integration auditable, not just a slide claim.

## Segment 7: Close

So the full workflow is: Attio supplies the sales context, Superlinked improves retrieval, Tavily verifies public evidence, Gemini generates the judgement and copy, SLNG adds voice input and output, and n8n provides the automation boundary. In three minutes, ProofOps turns a stalled deal into a consent-safe, source-backed proof recommendation with a ready CRM action and clear sponsor evidence.
