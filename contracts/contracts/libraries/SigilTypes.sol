// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SigilTypes
/// @notice Shared structs and enums for SigilRegistry + ProvenanceNotary.
/// @dev Reputation formula (CLAUDE.md decision):
///        score = 1000 * (taskCount - 2*failureCount) / max(taskCount, 1)
///        clamped to [0, 1000]. Stored on PassportRecord, updated on every
///        attestation.
library SigilTypes {
    /// @notice An AgentPassport record. PassportID is derived client-side as
    ///         keccak256(principal, agentAddress, blockNumber, nonce) and
    ///         passed into register() so the same value can namespace the
    ///         encrypted manifest in 0G Storage KV BEFORE the on-chain call.
    struct PassportRecord {
        bytes32 passportId;
        uint256 tokenId;
        address principal;
        address agentAddress;
        uint256 createdAt;
        uint256 createdBlock;
        bytes32 permissionManifestHash;
        uint256 reputationScore;
        uint256 taskCount;
        uint256 failureCount;
        uint256 provenanceRecordCount;
        uint256 executionFingerprintCount;
        bool active;
    }

    /// @notice Off-chain (0G Storage Log) data summary anchored on-chain by
    ///         appendFingerprint. The full LogEntry lives on 0G Storage; the
    ///         contract only stores a hash + counter for cheap reads.
    struct ExecutionFingerprint {
        bytes32 passportId;
        bytes32 fingerprintHash;
        bytes32 executionTxHash;
        uint256 timestamp;
        uint256 blockNumber;
    }

    /// @notice A capability attestation. Updates reputationScore via the
    ///         deterministic formula above.
    struct CapabilityAttestation {
        bytes32 passportId;
        AttestationType attestationType;
        bool passed;
        bytes32 dataHash;
        uint256 timestamp;
    }

    enum AttestationType {
        DEFI_REBALANCE,
        CODE_AUDIT,
        RISK_ASSESSMENT,
        DATA_ENRICHMENT,
        GOVERNANCE_VOTE,
        GENERIC_TASK
    }

    /// @notice An on-chain notarization for an AI-generated artifact.
    /// @dev `agentSignature` is renamed from `principalSignature` (CLAUDE.md
    ///      C1 resolution). The agent self-signs autonomously; the principal
    ///      authorized the agent address once at registration.
    struct ProvenanceRecord {
        bytes32 recordId;
        bytes32 passportId;
        address principal;
        address agent;
        bytes32 modelFingerprintHash;
        string modelId;
        bytes32 inputContextHash;
        uint256 inputContextSize;
        bytes32 outputHash;
        ArtifactType artifactType;
        bytes agentSignature;
        uint256 nonce;
        uint256 timestamp;
        uint256 blockNumber;
        bytes32 executionFingerprintRef;
    }

    enum ArtifactType {
        CODE_AUDIT,
        CONTRACT_CLAUSE,
        RISK_ASSESSMENT,
        FINANCIAL_MODEL,
        DUE_DILIGENCE,
        GOVERNANCE_ANALYSIS,
        GENERIC_REPORT
    }

    /// @notice Compute the reputation score per the decision in PROJECT_STATE.md.
    /// @return Clamped score in [0, 1000].
    function computeReputation(uint256 taskCount, uint256 failureCount)
        internal
        pure
        returns (uint256)
    {
        if (taskCount == 0) {
            return 0;
        }
        // 2*failureCount could exceed taskCount → score floors at 0.
        if (2 * failureCount >= taskCount) {
            return 0;
        }
        uint256 numerator = (taskCount - 2 * failureCount) * 1000;
        uint256 score = numerator / taskCount;
        if (score > 1000) {
            return 1000;
        }
        return score;
    }
}
