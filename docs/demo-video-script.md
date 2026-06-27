# ProofOps Three-Minute Demo Voiceover

## Segment 1: Problem and Setup

ProofOps is an Attio agent for stalled sales deals. The problem is simple: a buyer asks for proof, the sales team searches old notes and case studies, and the deal slows down while everyone checks what can actually be shared. ProofOps turns that into one workflow. It starts from an Attio-style stalled deal, reads the buyer context, finds the most relevant customer proof, checks consent, verifies public sources, and prepares the next CRM action.

## Segment 2: Run the Agent

Here I select Camden Integrated Care Board. The deal is stalled, the buyer needs evidence from a similar public health organisation, and the risk is visible before the workflow runs. I click Find proof for this deal. The agent now reads the CRM context, builds a local consent-aware baseline, reranks proof candidates with Superlinked, searches live public evidence with Tavily, asks Gemini for the judgement and draft copy, and keeps Attio write-back in dry-run mode for safety.

## Segment 3: Generated Reference, Consent and Sources

The generated result recommends Northstar Health Trust as the strongest proof match. It shows the reference contact, Maya Hughes, and the consent status: approved until the fifteenth of December twenty twenty-six. This is the key value of the agent. It does not just say a customer is similar. It tells the seller whether the reference can be used, why it fits the buyer objections, and what action should happen next.

## Segment 4: Live Evidence

Now I open the Evidence tab. These are live Tavily sources, shown separately from CRM proof notes, so the seller can see which claims come from public web evidence and which claims come from internal CRM records. The trace also shows that Superlinked completed semantic retrieval and Gemini generated the proof judgement. That gives the demo clear provenance instead of a black-box recommendation.

## Segment 5: Attio Write-Back and Voice

In the Attio writes tab, ProofOps prepares the CRM-ready summary, follow-up task and reference request email. The write-back is rehearsed because the demo is in dry-run mode, so it is safe to show without mutating CRM records. SLNG is used for the voice layer: the same generated proof summary can be spoken back to the user, and the app also supports voice input for proof requests.

## Segment 6: Close

So the full workflow is: Attio supplies the sales context, Superlinked improves retrieval, Tavily verifies public evidence, Gemini generates the judgement and copy, SLNG adds voice input and output, and n8n can sit around the webhook as the automation handoff. In three minutes, ProofOps turns a stalled deal into a consent-safe, source-backed proof recommendation with a ready CRM action.
