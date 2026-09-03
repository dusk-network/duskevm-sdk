# Changelog

Notable changes to `@dusk/evm-sdk` are documented here.

## Unreleased

- Add full-`ContractId` and opaque payload routing to the fixed
  `dusk_xdm_execute` receiver for zero-value L2-to-Dusk calls, without target
  registration or 20-byte address mapping.
- Add generic XDM deployment validation, L2 submission, dispute-game proof
  discovery, Portal maturity state, delivery tracking, and exact-message
  replay helpers for both directions.
- Add typed preparation and submission for zero-value Dusk-to-DuskEVM contract
  calls through the deployment's Dusk L1 Cross Domain Messenger.
- Rename the existing SDK delivery envelope and bridge operation fields to
  identify them explicitly as deposit metadata.
- Keep bridge value transfers, asset recipients, and native contract credits
  separate from arbitrary application calls.
- Add native contract-credit withdrawal preparation, authenticated OP message
  parsing, authoritative L1 state reads, lifecycle status, and claim submission.
- Preserve DRC20 amounts as raw atomic units and require L2 representations to
  use the corresponding DRC20 display decimals.
- Align the Dusk Connect adapter with the current wallet and DuskApp APIs,
  including data-driver encoding, explicit privacy, nested gas, decoded reads,
  average gas-price selection, and transaction-handle tracking.

## 0.1.0-beta.3

- Track deposits from the Dusk adapter receipt to the deterministically derived
  DuskEVM transaction and distinguish pending, delivered, and conclusive
  cross-domain failure states.

## 0.1.0-beta.2

- Encode native DuskEVM withdrawals with the adapter-supported
  `bridgeETHTo(address,uint32,bytes)` selector.

## 0.1.0-beta.1

Initial public prerelease:

- Dusk L1 client, gas, submission, and confirmation primitives.
- DuskEVM chain definitions, viem clients, OP bridge ABIs, and call encoders.
- Native, DRC20, and DRC721 deposit preparation and submission.
- Canonical Dusk withdrawal-recipient encoding and validation.
- OP withdrawal message parsing, hashing, proof request building, and lifecycle status.
- Narrow generated Dusk L1 contract interface sourced from the private contracts project.
