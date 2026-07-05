# Local SDK Smoke Harness

The SDK smoke harness is an optional developer tool for an already-running
local Rusk + DuskEVM setup. It is not part of CI by default.

```sh
npm run smoke:local:dry-run
```

Dry-run builds the SDK, prepares the same operation shapes, and performs no
network calls. Real mode uses the same script:

```sh
npm run smoke:local
```

## Real Mode Inputs

Real mode needs explicit local wiring:

```sh
export SDK_SMOKE_L1_SUBMIT_ARGV='["node","./my-local-l1-submit-adapter.mjs"]'
export SDK_SMOKE_L1_STANDARD_BRIDGE_ID='<l1 standard bridge contract id>'
export SDK_SMOKE_L2_PRIVATE_KEY='0x...'
export SDK_SMOKE_L2_RPC='http://localhost:9545'
export SDK_SMOKE_L2_RECIPIENT='0x...'
export SDK_SMOKE_L1_RECIPIENT='0x...'

npm run smoke:local
```

`SDK_SMOKE_L1_SUBMIT_ARGV` is a local developer/operator input. It is a JSON
argv array executed without a shell, and must not be derived from bridge
payloads or remote user input. The program receives one
`DuskL1TransactionRequest` JSON object on stdin and must print either a
transaction hash string or JSON containing `transactionHash`, `txHash`, or
`hash`.

Request fields that are `bigint` in the SDK, such as `amountLux`, `gasLimit`,
and `gasPriceLux`, arrive at the submit adapter as decimal strings because JSON
does not encode BigInt values.

If a gas-price override is needed, `SDK_SMOKE_L1_GAS_PRICE_ARGV` follows the
same JSON argv format and must print an integer gas price or JSON containing
`gasPrice`, `price`, or `lux`.

`SDK_SMOKE_L2_RECIPIENT` controls the L1 -> L2 deposit recipient. In real mode,
it defaults to the address derived from `SDK_SMOKE_L2_PRIVATE_KEY`; if neither is
set, the script fails before submitting anything. Withdrawals use
`SDK_SMOKE_L1_RECIPIENT`, defaulting to `SDK_SMOKE_L2_RECIPIENT` when unset.

Set `SDK_SMOKE_L1_WAIT=1` only with `SDK_SMOKE_L1_WAIT_ARGV`. The wait command
uses the same JSON argv format, receives `{ "transactionHash": "...",
"options": ... }` on stdin, and must print a receipt-like JSON object with a
`transactionHash`, `txHash`, or `hash` plus a boolean `success` flag. It may also
include optional `finalized`, `blockHeight`, or `height`.

Additional knobs mirror the script defaults:

- `SDK_SMOKE_L2_CHAIN_ID`, default `745`.
- `SDK_SMOKE_L2_CHAIN_NAME`, default `DuskEVM Local`.
- `SDK_SMOKE_MIN_GAS_LIMIT`, default `200000`.
- `SDK_SMOKE_NATIVE_DEPOSIT_LUX`, default `1`.
- `SDK_SMOKE_NATIVE_WITHDRAW_WEI`, default `1000000000`.
- `SDK_SMOKE_WITHDRAW_EXTRA_DATA`, default `0x`.
- `SDK_SMOKE_L2_RECEIPT_TIMEOUT_MS`, default `120000`.
- `SDK_SMOKE_PROVE_GAS_LIMIT` and `SDK_SMOKE_FINALIZE_GAS_LIMIT`, optional
  prove/finalize request overrides.

The script prepares and can submit:

- a native L1 -> L2 deposit through the SDK L1 transaction builder;
- a native L2 -> L1 withdrawal through a viem wallet transaction;
- optional DRC20/DRC721 withdrawal calls when token env vars are provided.

## Withdrawal Prove/Finalize

The SDK does not fetch or decide withdrawal proofs. To submit prove/finalize,
provide proof data collected from the local op-node/L2/Rusk integration:

```sh
export SDK_SMOKE_PORTAL_ID='<optimism portal contract id>'
export SDK_SMOKE_WITHDRAWAL_PROOF_JSON='./withdrawal-proof.json'
npm run smoke:local
```

The proof JSON shape is:

```json
{
  "disputeGameIndex": "7",
  "outputRootProof": {
    "version": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "stateRoot": "0x...",
    "messagePasserStorageRoot": "0x...",
    "latestBlockhash": "0x..."
  },
  "withdrawalProof": ["0x..."]
}
```

When no proof JSON is provided, the script stops after parsing the L2
`MessagePassed` receipt and reports the resumable `proof_not_ready` status.

## Token Paths

Set these to prepare token withdrawal calls:

```sh
export SDK_SMOKE_DRC20_L2_TOKEN='0x...'
export SDK_SMOKE_DRC20_L1_TOKEN='0x...' # optional
export SDK_SMOKE_DRC20_AMOUNT='1'

export SDK_SMOKE_DRC721_L1_TOKEN='0x...'
export SDK_SMOKE_DRC721_L2_TOKEN='0x...'
export SDK_SMOKE_DRC721_TOKEN_ID='1'
```

By default token calls are prepared but not submitted, because token balances
and approvals are setup-specific. Set `SDK_SMOKE_SEND_TOKEN_WITHDRAWALS=1` to
submit them against a local setup that has the required balances and approvals.

## Boundary

This harness exercises SDK-generated requests and L2 calldata. It deliberately
delegates Rusk wallet submission and proof collection to local setup adapters so
the SDK remains wallet-implementation agnostic.

The packaged `scripts/*` files are internal local smoke tooling, not stable SDK
entrypoints. The supported package API is limited to the subpaths declared in
`package.json` `exports`.
