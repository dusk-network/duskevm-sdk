// Generated from the public Dusk L1 SDK interface.
// Do not edit manually; run npm run import:l1-interface -- <artifact-path>.

/** Source revision and digest for the imported public Dusk L1 interface. */
export const duskL1ContractInterfaceSource = {
  "schemaVersion": 1,
  "revision": "568bed93a884690f8f0b2a2aaf5269efce2803d2",
  "interfaceDigestSha256": "28c13006a82c593886e6b755d70f56f350a5116428b8912afce5ea4d6f3ad6d2"
} as const;

/** Public bridge recipient wire-format constants owned by the L1 contracts. */
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

/** Allowlisted Dusk L1 method signatures used by this SDK. */
export const duskL1ContractMethods = {
  "l1CrossDomainMessenger": {
    "sendMessage": {
      "name": "sendMessage",
      "stateMutability": "write",
      "inputs": [
        {
          "name": "target",
          "rustType": "EVMAddress"
        },
        {
          "name": "message",
          "rustType": "Vec < u8 >"
        },
        {
          "name": "min_gas_limit",
          "rustType": "u32"
        }
      ],
      "output": "()"
    }
  },
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
    },
    "claimNativeCredit": {
      "name": "claimNativeCredit",
      "stateMutability": "write",
      "inputs": [
        {
          "name": "credit_id",
          "rustType": "Bytes32"
        },
        {
          "name": "payload",
          "rustType": "Vec < u8 >"
        }
      ],
      "output": "bool"
    },
    "nativeCredit": {
      "name": "nativeCredit",
      "stateMutability": "read",
      "inputs": [
        {
          "name": "credit_id",
          "rustType": "Bytes32"
        }
      ],
      "output": "(Bytes32 , EVMAddress , u64 , Bytes32 , u8)"
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
