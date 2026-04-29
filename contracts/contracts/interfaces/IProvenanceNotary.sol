// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SigilTypes} from "../libraries/SigilTypes.sol";

/// @title IProvenanceNotary
/// @notice Public surface of the ProvenanceNotary contract. Records on-chain
///         notarizations of AI-generated artifacts. The agent (msg.sender)
///         self-signs over an EIP-712 typed-data payload that includes a
///         per-signer nonce for replay protection.
interface IProvenanceNotary {
    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event ArtifactNotarized(
        bytes32 indexed recordId,
        bytes32 indexed passportId,
        address indexed agent,
        address principal,
        bytes32 outputHash,
        bytes32 inputContextHash,
        bytes32 modelFingerprintHash,
        SigilTypes.ArtifactType artifactType,
        uint256 nonce,
        uint256 timestamp
    );

    // ---------------------------------------------------------------------
    // Mutating functions
    // ---------------------------------------------------------------------

    /// @notice Notarize an AI-generated artifact.
    /// @dev Pre-conditions:
    ///      - SigilRegistry.isAuthorizedSigner(passportId, msg.sender) == true
    ///      - nonce == signerNonces(msg.sender)
    ///      - agentSignature recovers to msg.sender over EIP-712 typed data
    ///      - signedTimestamp within ±5 minutes of block.timestamp
    /// @return recordId Deterministic record ID derived from inputs.
    function notarize(
        bytes32 passportId,
        bytes32 modelFingerprintHash,
        string calldata modelId,
        bytes32 inputContextHash,
        uint256 inputContextSize,
        bytes32 outputHash,
        SigilTypes.ArtifactType artifactType,
        uint256 nonce,
        uint256 signedTimestamp,
        bytes calldata agentSignature,
        bytes32 executionFingerprintRef
    ) external returns (bytes32 recordId);

    // ---------------------------------------------------------------------
    // View functions
    // ---------------------------------------------------------------------

    function signerNonces(address signer) external view returns (uint256);

    function resolve(bytes32 recordId) external view returns (SigilTypes.ProvenanceRecord memory);

    function resolveByOutput(bytes32 outputHash) external view returns (bytes32 recordId);

    function recordsByAgent(
        bytes32 passportId,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory recordIds);

    function recordCountByAgent(bytes32 passportId) external view returns (uint256);

    function verify(bytes32 recordId) external view returns (bool valid, string memory reason);

    /// @notice EIP-712 domain separator (exposed for off-chain signers).
    function DOMAIN_SEPARATOR() external view returns (bytes32);

    /// @notice EIP-712 typehash for Notarization payloads.
    function NOTARIZATION_TYPEHASH() external pure returns (bytes32);
}
