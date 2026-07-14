# Architecture

The SDK is a thin application layer around DuskEVM bridge workflows. It is not
part of consensus, adapter derivation, or OP-node execution.

## Package Boundary

The initial package is a single TypeScript package with internal modules:

- `envelope`: self-describing SDK delivery-envelope codecs and diagnostics.
- `l1`: Dusk L1 submission interfaces, gas resolution, wait helpers, and
  wallet/client adapters.
- `l2`: DuskEVM viem chain definitions, EVM client helpers, and generated ABI
  bindings for standard token and OP bridge calls.
- `bridge`: cross-layer operation intent helpers, Dusk bridge transaction
  builders, and status metadata.
- `status`: polling and resumable operation status primitives.

Keeping one package first avoids premature publishing overhead. The public
subpath exports keep the door open to split packages later if consumers need
lighter installs.

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
  contract id before appending the SDK delivery envelope.

Applications can still inject a deployment-specific transaction builder when a
local setup uses different contract ids, gas limits, or call routing.

Withdrawals are deliberately modeled as a staged lifecycle instead of a single
helper that hides the protocol boundary:

- native withdrawals prepare an L2 standard-bridge `withdrawTo` call with the
  legacy ETH token marker and matching transaction value;
- DRC20 withdrawals prepare an L2 standard-bridge `withdrawTo` call;
- DRC721 withdrawals prepare an L2 ERC721 bridge `bridgeERC721To` call;
- `MessagePassed` receipt parsing verifies the emitted withdrawal hash against
  the decoded withdrawal payload;
- L1 prove/finalize builders produce Dusk contract-call requests for the
  OptimismPortal2 entrypoints.

The SDK does not choose a dispute game, fetch `eth_getProof`, decide output-root
validity, or resolve games. Those observations come from op-node/L2/Rusk
integration code and are passed into the SDK's L1 request builders.

The L1 request method metadata is generated from an allowlisted public
interface produced by the private contracts repository. The public SDK stores
only the generated TypeScript projection. Import an artifact downloaded from
the private CI workflow with:

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
