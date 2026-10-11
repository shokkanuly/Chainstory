# Operations viewer fixtures

`operations-synthetic.json` is a deliberately synthetic customer observer report
for HOLD, rejected funded credit, paid and returned display cases. Its fabricated
addresses, hashes, blocks and times are not public transaction evidence. The
`fixture: true` marker makes the viewer label it as a synthetic example. No source
account, key, signature, funding, Circle attestation or live receipt was used.
Lifecycle timestamps, payout and return/request anchors are also fabricated.
`operations-discovery-synthetic.json` extends the same fabricated rows with
bounded discovery coverage, a source-only hint, unmatched destination hints and
an ambiguous operation. It is not a recorded scan or evidence of unminted funds.
`operations-discovery-resumed-synthetic.json` fabricates a persistent report with
cumulative coverage and smaller new scan windows; no real journal or restart
is represented by these display examples.

Use a keyless preflight or the observer's one-shot `--report=new.json` for actual
public snapshots. All imports are still unauthenticated files in the browser;
validation checks shape/internal consistency, not consensus or signatures.


`operations-worker-synthetic.json` adds fabricated watch-process scheduling data
to the resumed discovery example. `operations-worker-outage-synthetic.json`
fabricates a temporary outage with a planned retry and no current payment rows.
These are display examples, not a running worker, real outage or public receipt.

`behavioral-shadow-synthetic.json` is a standalone ADR-043 read-only model
example with hand-written synthetic scores. It is not an operations observer
report and cannot be imported as payment/source/review evidence. The mandatory
`synthetic: true`, `authorization: none`, `enforcement: false` and
`executionPolicy: legacy-enforced` markers distinguish illustrative signal
display from enabling shadow-only execution. No measured model accuracy,
probability of loss, screening result or production baseline is represented.

`operations-behavioral-synthetic.json` embeds that illustrative model in one
synthetic held-payment row for ADR-044 report/viewer tests. Route/message identity,
synthetic provenance and check clock match the enclosing report; original
assessment capture is 30 seconds earlier. Its historical clocks deliberately
remain unchanged: a current browser shows the scores as too old. It does not
represent a newly calculated live assessment, public receipt or removed HOLD.
Old fixtures without the extension remain the backward-compatibility cases.
