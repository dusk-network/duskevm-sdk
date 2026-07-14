// Generated from the public Dusk L1 SDK interface.
// Do not edit manually; run npm run import:l1-interface -- <artifact-path>.

export const duskL1ContractInterfaceSource = {
  "schemaVersion": 1,
  "revision": "b39613569e35e03e1d7f9937ce6bb4e838a797ef",
  "interfaceDigestSha256": "98ccf77cf5be61b4dc9d297fb6a13a90058f0dc0922d30daeffb729a0a27cab4"
} as const;

export const duskL1WireFormats = {
  "bridgeAssetRecipientV1": {
    "tag": 2,
    "version": 1,
    "externalKind": 0,
    "contractKind": 1,
    "rawPublicKeyBytes": 193,
    "contractIdBytes": 32
  },
  "nativeContractCreditV1": {
    "tag": 32,
    "version": 1,
    "contractIdBytes": 32
  }
} as const;

export const duskL1ContractMethods = {
  "l1StandardBridge": {
    "depositETHToWithValue": {
      "name": "depositETHToWithValue",
      "stateMutability": "write",
      "inputs": [
        {
          "name": "to",
          "rustType": "EVMAddress"
        },
        {
          "name": "amount_lux",
          "rustType": "u64"
        },
        {
          "name": "min_gas_limit",
          "rustType": "u32"
        },
        {
          "name": "extra_data",
          "rustType": "Vec < u8 >"
        }
      ],
      "output": "()"
    },
    "bridgeERC20To": {
      "name": "bridgeERC20To",
      "stateMutability": "write",
      "inputs": [
        {
          "name": "l1_token",
          "rustType": "EVMAddress"
        },
        {
          "name": "l2_token",
          "rustType": "EVMAddress"
        },
        {
          "name": "to",
          "rustType": "EVMAddress"
        },
        {
          "name": "amount",
          "rustType": "U256"
        },
        {
          "name": "min_gas_limit",
          "rustType": "u32"
        },
        {
          "name": "extra_data",
          "rustType": "Vec < u8 >"
        }
      ],
      "output": "()"
    }
  },
  "l1Erc721Bridge": {
    "bridgeERC721To": {
      "name": "bridgeERC721To",
      "stateMutability": "write",
      "inputs": [
        {
          "name": "local_token",
          "rustType": "EVMAddress"
        },
        {
          "name": "remote_token",
          "rustType": "EVMAddress"
        },
        {
          "name": "to",
          "rustType": "EVMAddress"
        },
        {
          "name": "token_id",
          "rustType": "U256"
        },
        {
          "name": "min_gas_limit",
          "rustType": "u32"
        },
        {
          "name": "extra_data",
          "rustType": "Vec < u8 >"
        }
      ],
      "output": "()"
    }
  },
  "optimismPortal": {
    "proveWithdrawalTransaction": {
      "name": "proveWithdrawalTransaction",
      "stateMutability": "write",
      "inputs": [
        {
          "name": "withdrawal",
          "rustType": "WithdrawalTransaction"
        },
        {
          "name": "dispute_game_index",
          "rustType": "U256"
        },
        {
          "name": "output_root_proof",
          "rustType": "OutputRootProof"
        },
        {
          "name": "withdrawal_proof",
          "rustType": "Vec < Vec < u8 > >"
        }
      ],
      "output": "()"
    },
    "finalizeWithdrawalTransaction": {
      "name": "finalizeWithdrawalTransaction",
      "stateMutability": "write",
      "inputs": [
        {
          "name": "withdrawal",
          "rustType": "WithdrawalTransaction"
        }
      ],
      "output": "()"
    },
    "finalizeWithdrawalTransactionExternalProof": {
      "name": "finalizeWithdrawalTransactionExternalProof",
      "stateMutability": "write",
      "inputs": [
        {
          "name": "withdrawal",
          "rustType": "WithdrawalTransaction"
        },
        {
          "name": "proof_submitter_addr",
          "rustType": "EVMAddress"
        }
      ],
      "output": "()"
    },
    "checkWithdrawal": {
      "name": "checkWithdrawal",
      "stateMutability": "read",
      "inputs": [
        {
          "name": "withdrawal_hash",
          "rustType": "Bytes32"
        },
        {
          "name": "proof_submitter",
          "rustType": "EVMAddress"
        }
      ],
      "output": "()"
    },
    "profileFinalizeWithdrawalTransaction": {
      "name": "profileFinalizeWithdrawalTransaction",
      "stateMutability": "write",
      "inputs": [
        {
          "name": "withdrawal",
          "rustType": "WithdrawalTransaction"
        }
      ],
      "output": "FinalizeWithdrawalGasProfile"
    }
  }
} as const;
