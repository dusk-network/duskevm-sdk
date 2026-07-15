# Changelog

Notable changes to `@dusk/evm-sdk` are documented here.

## Unreleased

- Add full-`ContractId`, zero-value L2-to-Dusk contract-call envelope and OP
  Messenger transaction preparation.
- Rename the existing SDK delivery envelope and bridge operation fields to
  identify them explicitly as deposit metadata.
- Keep bridge value transfers, asset recipients, and native contract credits
  separate from arbitrary application calls.

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
