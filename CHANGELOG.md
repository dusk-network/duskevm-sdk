# Changelog

Notable changes to `@dusk/evm-sdk` are documented here.

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
