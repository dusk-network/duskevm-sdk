// Generated from the public Dusk L1 SDK interface.
// Do not edit manually; run npm run import:l1-interface -- <artifact-path>.

/** Source revision and digest for the imported public Dusk L1 interface. */
export const duskL1ContractInterfaceSource = {
  "schemaVersion": 1,
  "revision": "1afe5abcd3274142bad3ed26315098be33f33e41",
  "interfaceDigestSha256": "1a59100274bfbbc2d5272e5cfdbe8b00283dbf1d8a8e744a5f7ed39534139826"
} as const;

/** Public wire-format constants owned by the L1 contracts. */
export const duskL1WireFormats = {
  "bridgeAssetRecipientV1": {
    "tag": 2,
    "version": 1,
    "externalKind": 0,
    "contractKind": 1,
    "rawPublicKeyBytes": 193,
    "contractIdBytes": 32
  },
  "duskContractCallV1": {
    "target": "0x6901e2c830a4e1ddf737f0cac91ed8e0694efde7",
    "version": 1,
    "kind": 1,
    "fixedHeaderBytes": 34,
    "targetContractIdBytes": 32,
    "receiverEntrypoint": "dusk_xdm_execute",
    "goldenVectorHex": "0x01011111111111111111111111111111111111111111111111111111111111111111223344"
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
    "failedMessages": {
      "name": "failedMessages",
      "stateMutability": "read",
      "inputs": [
        {
          "name": "msg_hash",
          "rustType": "Bytes32"
        }
      ],
      "output": "bool"
    },
    "relayMessage": {
      "name": "relayMessage",
      "stateMutability": "write",
      "inputs": [
        {
          "name": "nonce",
          "rustType": "U256"
        },
        {
          "name": "sender",
          "rustType": "EVMAddress"
        },
        {
          "name": "target",
          "rustType": "EVMAddress"
        },
        {
          "name": "value",
          "rustType": "U256"
        },
        {
          "name": "min_gas_limit",
          "rustType": "U256"
        },
        {
          "name": "message",
          "rustType": "Vec < u8 >"
        }
      ],
      "output": "bool"
    },
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
    },
    "successfulMessages": {
      "name": "successfulMessages",
      "stateMutability": "read",
      "inputs": [
        {
          "name": "msg_hash",
          "rustType": "Bytes32"
        }
      ],
      "output": "bool"
    }
  },
  "disputeGameFactory": {
    "findLatestGames": {
      "name": "findLatestGames",
      "stateMutability": "read",
      "inputs": [
        {
          "name": "game_type",
          "rustType": "GameType"
        },
        {
          "name": "start",
          "rustType": "U256"
        },
        {
          "name": "n",
          "rustType": "U256"
        }
      ],
      "output": "Vec < GameSearchResult >"
    },
    "gameAtIndex": {
      "name": "gameAtIndex",
      "stateMutability": "read",
      "inputs": [
        {
          "name": "index",
          "rustType": "U256"
        }
      ],
      "output": "(GameType , Timestamp , EVMAddress)"
    },
    "gameCount": {
      "name": "gameCount",
      "stateMutability": "read",
      "inputs": [],
      "output": "U256"
    },
    "gameMetadataAtIndex": {
      "name": "gameMetadataAtIndex",
      "stateMutability": "read",
      "inputs": [
        {
          "name": "index",
          "rustType": "U256"
        }
      ],
      "output": "(Claim , Hash , U256 , Vec < u8 >)"
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
    "finalizedWithdrawals": {
      "name": "finalizedWithdrawals",
      "stateMutability": "read",
      "inputs": [
        {
          "name": "withdrawal_hash",
          "rustType": "Bytes32"
        }
      ],
      "output": "bool"
    },
    "paused": {
      "name": "paused",
      "stateMutability": "read",
      "inputs": [],
      "output": "bool"
    },
    "proofMaturityDelaySeconds": {
      "name": "proofMaturityDelaySeconds",
      "stateMutability": "read",
      "inputs": [],
      "output": "U256"
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
    },
    "provenWithdrawals": {
      "name": "provenWithdrawals",
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
      "output": "(EVMAddress , u64)"
    },
    "respectedGameType": {
      "name": "respectedGameType",
      "stateMutability": "read",
      "inputs": [],
      "output": "GameType"
    }
  }
} as const;
