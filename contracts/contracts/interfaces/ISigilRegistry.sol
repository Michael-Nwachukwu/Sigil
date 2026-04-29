// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SigilTypes} from "../libraries/SigilTypes.sol";

/// @title ISigilRegistry
/// @notice Public surface of the AgentPassport registry. The registry mints
///         soulbound ERC-7857-compatible iNFTs and maintains the dual-wallet
///         linkage between principal (owner) and agent (autonomous signer).
interface ISigilRegistry {
    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event AgentRegistered(
        bytes32 indexed passportId,
        uint256 indexed tokenId,
        address indexed principal,
        address agentAddress,
        bytes32 permissionManifestHash,
        string metadataUri
    );

    event AgentRotated(
        bytes32 indexed passportId,
        address indexed oldAgent,
        address indexed newAgent
    );

    event AgentRevoked(bytes32 indexed passportId, address indexed agent);

    event PermissionsUpdated(
        bytes32 indexed passportId,
        bytes32 oldManifestHash,
        bytes32 newManifestHash
    );

    event FingerprintAppended(
        bytes32 indexed passportId,
        bytes32 indexed fingerprintHash,
        bytes32 executionTxHash,
        uint256 index
    );

    event AttestationAppended(
        bytes32 indexed passportId,
        SigilTypes.AttestationType attestationType,
        bool passed,
        bytes32 dataHash,
        uint256 newReputationScore,
        uint256 taskCount,
        uint256 failureCount
    );

    event ProvenanceCounted(bytes32 indexed passportId, uint256 newCount);

    event RelayAdded(address indexed relay);
    event RelayRemoved(address indexed relay);

    // ---------------------------------------------------------------------
    // Mutating functions
    // ---------------------------------------------------------------------

    /// @notice Mint a new AgentPassport iNFT.
    /// @param passportId Client-derived ID = keccak256(principal, agentAddress,
    ///                   blockNumber, nonce). Must be unused.
    /// @param principal The human-controlled owner. Must equal msg.sender or
    ///                  be authorized by msg.sender (single-tx flow: equal).
    /// @param agentAddress The fresh autonomous signer keypair address.
    /// @param permissionManifestHash keccak256 of the encrypted KV payload.
    /// @param metadataUri 0G Storage URI → JSON metadata.
    function register(
        bytes32 passportId,
        address principal,
        address agentAddress,
        bytes32 permissionManifestHash,
        string calldata metadataUri
    ) external;

    /// @notice Rotate the agent address. Only callable by the principal.
    function rotateAgentAddress(bytes32 passportId, address newAgentAddress) external;

    /// @notice Revoke the agent. Sets `active=false`, clears reverse lookup,
    ///         and prevents downstream notarizations. Only callable by the
    ///         principal.
    function revokeAgent(bytes32 passportId) external;

    /// @notice Update the permission manifest hash. Only callable by the principal.
    function updatePermissions(bytes32 passportId, bytes32 newManifestHash) external;

    /// @notice Append an execution-fingerprint anchor. Only callable by an
    ///         authorized KeeperHub relay.
    function appendFingerprint(
        bytes32 passportId,
        bytes32 fingerprintHash,
        bytes32 executionTxHash
    ) external;

    /// @notice Append a capability attestation and update reputation. Only
    ///         callable by an authorized KeeperHub relay.
    function appendAttestation(
        bytes32 passportId,
        SigilTypes.AttestationType attestationType,
        bool passed,
        bytes32 dataHash
    ) external;

    /// @notice Increment the on-chain ProvenanceRecord counter. Only callable
    ///         by the ProvenanceNotary contract.
    function incrementProvenanceCount(bytes32 passportId) external;

    /// @notice Authorize a KeeperHub relay address. Owner-only.
    function addRelay(address relay) external;

    /// @notice Revoke a KeeperHub relay address. Owner-only.
    function removeRelay(address relay) external;

    // ---------------------------------------------------------------------
    // View functions
    // ---------------------------------------------------------------------

    function resolve(bytes32 passportId) external view returns (SigilTypes.PassportRecord memory);

    function passportOfAgent(address agent) external view returns (bytes32);

    function isAuthorizedSigner(bytes32 passportId, address signer) external view returns (bool);

    function reputationScore(bytes32 passportId)
        external
        view
        returns (uint256 score, uint256 taskCount, uint256 failureCount);

    function isRelay(address relay) external view returns (bool);

    function exists(bytes32 passportId) external view returns (bool);
}
