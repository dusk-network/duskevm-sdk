# Architecture

The SDK is a thin application layer around DuskEVM bridge workflows. It is not
part of consensus, adapter derivation, or OP-node execution.

## Package Boundary

The initial package is a single TypeScript package with internal modules:

- `envelope`: distinct deposit and contract-call envelope codecs.
- `l1`: Dusk L1 submission interfaces, gas resolution, wait helpers, and
  wallet/client adapters.
- `l2`: DuskEVM viem chain definitions, EVM client helpers, and generated ABI
  bindings for standard token, OP bridge, and Messenger calls.
- `bridge`: cross-layer operation intent helpers, Dusk bridge transaction
  builders, and status metadata.
- `status`: polling and resumable operation status primitives.

Keeping one package avoids premature publishing overhead. The public subpath
exports keep the door open to split packages later if consumers need lighter
installs. The canonical package name is `@dusk/evm-sdk` on npm and JSR.

## Dependency Choices

- viem is the EVM runtime dependency because it is typed, modular, and fits SDK
  library use well.
- Dusk Connect and W3sper are integration points, not hard dependencies yet.
  The obvious package names are not currently available from the public NPM
  registry, so the SDK exposes narrow interfaces that those packages can adapt
  to once their publication path is stable.
- WalletConnect/Reown belongs in application UI code. The SDK accepts standard
  EVM providers and viem transports, but does not ship wallet UI.

## Bridge Intent Model

The SDK prepares explicit bridge operation intents. Intent IDs are derived from
canonical operation data with a hash so user-controlled string fields cannot
collide through delimiter tricks. The SDK ships default builders for the
current DuskEVM L1 bridge entrypoints:

- native deposits use `depositETHToWithValue`;
- DRC20 deposits use `bridgeERC20To`;
- DRC721 deposits use `bridgeERC721To`;
- DRC token deposits prefix `extraData` with the Dusk registry tag and 32-byte
  contract id before appending the SDK deposit envelope.

Applications can still inject a deployment-specific transaction builder when a
local setup uses different contract ids, gas limits, or call routing.

Withdrawals are deliberately modeled as a staged lifecycle instead of a single
helper that hides the protocol boundary:

- native withdrawals prepare the adapter-supported L2 standard-bridge
  `bridgeETHTo` call with matching transaction value;
- native contract-credit withdrawals derive the OP recipient from the full
  Dusk `ContractId`, then expose the bridge's pending/claimed state and claim
  transaction as explicit SDK stages; their WEI amount must convert to exact
  LUX and fit Dusk's `u64` native transfer amount;
- DRC20 withdrawals prepare an L2 standard-bridge `withdrawTo` call;
- DRC721 withdrawals prepare an L2 ERC721 bridge `bridgeERC721To` call;
- asset withdrawals use the generated versioned Dusk recipient wire format
  rather than unversioned account-key prefixes;
- `MessagePassed` receipt parsing verifies the emitted withdrawal hash against
  the decoded withdrawal payload;
- L1 prove/finalize builders produce Dusk contract-call requests for the
  OptimismPortal2 entrypoints.

SDK deposit envelopes are not bridge asset-recipient metadata. DRC20
and DRC721 withdrawals must use `encodeDuskExternalAssetRecipient` or
`encodeDuskContractAssetRecipient`. Native withdrawals use the external-account
format or the separate `encodeDuskNativeContractCredit` format for contract
credits. The typed withdrawal helpers require and validate these formats before
constructing L2 calldata.

DRC20 amounts remain raw atomic units across the bridge. The corresponding L2
representation should copy the DRC20's display decimals when it is created;
canonical deployment tooling should query that value and call the OP factory's
decimal-aware creation function. Neither bridge direction scales token amounts
or enforces display metadata. Native DUSK is the exception: its LUX/WEI
conversion exists because Dusk and the EVM native balance use different decimal
bases.

The exported `l2` encoding functions are lower-level OP ABI primitives. They
deliberately preserve raw `extraData` access for advanced callers and do not
enforce Dusk recipient semantics. Applications that want the SDK's canonical
recipient checks should use `prepareNativeWithdrawal`, `prepareDrc20Withdrawal`,
or `prepareDrc721Withdrawal` from the `bridge` surface.

## Application Contract Calls

Application messaging is deliberately separate from the bridge API in both
directions.

For Dusk-to-DuskEVM calls, `prepareDuskEvmContractCall` builds a Dusk contract
request to the deployment's full `L1CrossDomainMessenger` ContractId. The
message target is a 20-byte address because the destination contract runs on
the EVM. The Dusk caller is represented to L2 by its canonical EVM sender
identity. Wallet-originated and contract-originated calls remain distinct; a
wallet cannot claim a Dusk contract's sender identity.

For DuskEVM-to-Dusk calls, `prepareDuskContractCall` encodes:

```text
version:u8 || kind:u8 || target_contract_id:[32] || entrypoint_len:u16 ||
entrypoint:ASCII || fn_args:bytes
```

It then prepares `L2CrossDomainMessenger.sendMessage` to the fixed Dusk
contract-call discriminator. The complete Dusk `ContractId`, entrypoint, and
exact Piecrust arguments are message-bound; no mutable EVM-address mapping,
receiver registry, or mandatory callback is involved.

Neither typed application helper includes transaction value. The public SDK
interface exposes only zero-value `sendMessage` on the Dusk Messenger;
`sendMessageWithValue` remains excluded and the contract accepts nonzero value
only from the configured Standard Bridge. The inbound Messenger also rejects
nonzero value for the application discriminator. Value-bearing operations
remain narrow:

- native, DRC20, and DRC721 transfers enter fixed, authenticated bridge
  contracts;
- bridge recipient metadata chooses an external Dusk account or full contract
  ID after the message reaches the bridge;
- native DUSK sent to a contract becomes a claimable bridge credit using
  `encodeDuskNativeContractCredit`, not an arbitrary value-bearing callback.

The credit ID is the exact L1 Messenger replay hash decoded from the nested OP
`relayMessage`, not an SDK-generated identifier. Finalization creates a pending
credit without moving custody. A later `claimNativeCredit` call transfers the
bound amount through `receive_from_bridge`; rejection leaves the credit pending
and a successful claim is terminal.

Permissionless target entrypoints execute normally. Targets that authorize an
EVM identity authenticate the immediate Messenger and read the original L2
sender from Messenger context. Missing entrypoints, malformed arguments, and
contract failures become replayable message failures; ordinary return bytes are
ignored, matching EVM call-success semantics.

The SDK does not choose a dispute game, fetch `eth_getProof`, decide output-root
validity, or resolve games. Those observations come from op-node/L2/Rusk
integration code and are passed into the SDK's L1 request builders.

The L1 request method metadata is generated from an allowlisted public
interface produced by the private contracts repository. The application
surface includes the bridges, Portal workflow, and zero-value Messenger
`sendMessage`; it deliberately excludes Messenger value sends and wiring
methods. The public SDK stores only the generated TypeScript projection. Import
an artifact downloaded from the private CI workflow with:

```sh
npm run import:l1-interface -- /path/to/dusk-l1-public-interface.json
```

The importer verifies the artifact digest, rejects contracts or methods outside
the expected public surface, validates exact method signatures and wire-format
constants, and records the contracts revision and interface digest. The
private repository owns source conformance and artifact publication; public
SDK CI compiles and tests the committed projection without private-repository
access.

The L2 OP bridge ABI constants are generated from the pinned
`@eth-optimism/contracts-bedrock` forge artifacts. Refresh them with:

```sh
npm run generate:l2-abis
```

The generated file records artifact package version, artifact paths, and
compiler versions so reviewers can tie the SDK binding surface back to the OP
artifact source. `npm run check` reruns the generator and fails if the committed
generated file is stale.

## Non-goals

- Do not decide canonical chain state.
- Do not synthesize adapter or op-node data.
- Do not hide OP-style withdrawal stages.
- Do not assume one Dusk wallet, Rusk node, or EVM wallet stack.
