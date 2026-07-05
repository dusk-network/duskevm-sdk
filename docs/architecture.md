# Architecture

The SDK is a thin application layer around DuskEVM bridge workflows. It is not
part of consensus, adapter derivation, or OP-node execution.

## Package Boundary

The initial package is a single TypeScript package with internal modules:

- `envelope`: self-describing SDK delivery-envelope codecs and diagnostics.
- `l1`: Dusk L1 submission interfaces and wallet/client adapters.
- `l2`: DuskEVM viem chain definitions and EVM client helpers.
- `bridge`: cross-layer operation intent helpers.
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
collide through delimiter tricks. A deployment-specific transaction builder
converts those intents into actual Dusk L1 or EVM L2 calls. This avoids guessing
contract method names in the SDK while still giving apps a single shape to
validate, persist, submit, and track.

## Non-goals

- Do not decide canonical chain state.
- Do not synthesize adapter or op-node data.
- Do not hide OP-style withdrawal stages.
- Do not assume one Dusk wallet, Rusk node, or EVM wallet stack.
