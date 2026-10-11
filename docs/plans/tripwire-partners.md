# Tripwire: first design-partner workflow

Prepared 2026-10-05. No outreach has been sent and no partnership is claimed.
The founder/product owner runs discovery while engineers complete the P0 backlog.

## Qualify the workflow before an integration

Target a team with recurring USDC treasury payments between Base and Ethereum,
several payment participants, documented approval needs, repeated reconciliation
work and enough delay tolerance for Standard CCTP and selected policy holds.
Verify route and workflow in conversation; a project mentioning stablecoins alone
is not a qualified prospect. Record public evidence and its date before adding
an organization to the shortlist. Do not collect personal contact data unnecessarily.

Build a 30-organization candidate list. For each, record organization/public URL,
route evidence, use case, current tools, likely decision-making role, public contact
channel, qualification status, conversation outcome and next commitment. Reach
the people responsible for treasury operations or the technical integration.

Score fit on four independently evidenced questions: repeated supported route,
costly approval/reconciliation problem, ability to supply test operations and
ownership of an integration decision. Do not infer willingness to pay from a
funding announcement or a public transaction.

## Process interview: 30 minutes

Ask the team to walk through its last real cross-chain payout:

1. What operation triggered it, and where were amount and beneficiary recorded?
2. Who created, approved, sent and reconciled it? Which authority can bypass this?
3. Which chains, token, accounts, bridge mode and mint recipient were used?
4. What checks prevent a duplicate or an incorrect amount/recipient today?
5. What happened the last time settlement or payout was delayed?
6. How much operator time did that exception require? What evidence was missing?
7. Which payments can tolerate holds, and which need a different product?
8. Could current tools solve the problem by configuration alone?
9. Who can authorize a test integration, provide sample operations and own support?
10. What measurable result would make the team continue and pay for the service?

Output: a process map, concrete pain and its frequency, permission to use sanitized
examples, trust/bypass constraints, agreed success metric and a specific next action.
Keep unknowns explicit. Interview targets: 12 substantive interviews, 3 suitable
design-partner candidates and 1 written testnet commitment; these are not achieved counts.

## Testnet pilot agreement fields

Organization and named pilot owner; supported route and contracts; who operates
and approves payments; chosen checks and mandatory inputs; test cases and observation
period; acceptable latency/manual work; exposure and initiation limits; stop/recovery
procedures; access to evidence; weekly review time; success/failure criteria;
integration responsibilities; audit/release dependencies; commercial follow-up date.

Successful technical tests alone do not establish demand. Ask whether the partner
can resolve a held operation using the provided evidence without calling our
developers, whether the workflow saves measurable time and whether it replaces
a recurring task. A useful commitment allocates a team member and real test work.

## Draft invitation for a human to review/send

We are testing Tripwire for recurring USDC treasury payments from Base to Ethereum.
It keeps each funded payout in an escrow until the agreed recipient, amount,
approvals and limits have been checked, with evidence and a recovery procedure for
held payments. We would like to understand your current approval and reconciliation
process in a 30-minute conversation. The first integration would use testnets;
the current version has not completed an external audit or a live customer pilot.

Use the invitation only after verifying the organization's fit. Record outbound
messages and commitments in the team's existing workflow; this repository contains
the discovery instructions, not a new customer-data service.

## Weekly decision record

Record actual counts, most frequent problem, alternatives already used, repeated
objections, integration requirements, evidence of willingness to commit and the
decision: continue this segment, narrow the workflow or change the hypothesis.
After 12 interviews, do not expand contracts/routes merely because nobody committed.
Review the value proposition and existing-tool alternatives with the evidence.
