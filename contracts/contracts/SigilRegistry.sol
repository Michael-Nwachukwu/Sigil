// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ISigilRegistry} from "./interfaces/ISigilRegistry.sol";
import {SigilTypes} from "./libraries/SigilTypes.sol";

/// @title SigilRegistry
/// @notice ERC-7857-compatible (in spirit) AgentPassport registry. The
///         "intelligence" payload is the encrypted permission manifest stored
///         in 0G Storage KV; the contract anchors only its hash + a URI.
/// @dev Soulbound: transfers revert. The principal owns the iNFT; the agent
///      is a separate authorized signer address. Only KeeperHub relays may
///      append fingerprints + attestations. Only ProvenanceNotary may
///      increment the provenance counter.
contract SigilRegistry is ERC721, Ownable, ISigilRegistry {
    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    mapping(bytes32 => SigilTypes.PassportRecord) private _records;
    mapping(address => bytes32) private _passportOfAgent;
    mapping(uint256 => bytes32) private _tokenIdToPassportId;
    mapping(uint256 => string) private _tokenURIs;
    mapping(address => bool) private _keeperRelays;

    address public provenanceNotary;
    uint256 private _nextTokenId;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error PassportAlreadyExists();
    error PassportNotFound();
    error AgentAlreadyBound();
    error ZeroAddress();
    error NotPrincipal();
    error NotRelay();
    error NotProvenanceNotary();
    error AgentInactive();
    error Soulbound();
    error ProvenanceNotaryAlreadySet();

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyPrincipal(bytes32 passportId) {
        if (_records[passportId].principal == address(0)) revert PassportNotFound();
        if (_records[passportId].principal != msg.sender) revert NotPrincipal();
        _;
    }

    modifier onlyKeeperRelay() {
        if (!_keeperRelays[msg.sender]) revert NotRelay();
        _;
    }

    modifier onlyProvenanceNotary() {
        if (msg.sender != provenanceNotary) revert NotProvenanceNotary();
        _;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address initialOwner) ERC721("Sigil AgentPassport", "SIGIL") Ownable(initialOwner) {
        _nextTokenId = 1;
    }

    /// @notice Set the ProvenanceNotary address once. Cannot be changed after
    ///         being set, to keep `incrementProvenanceCount` trustworthy.
    function setProvenanceNotary(address notary) external onlyOwner {
        if (notary == address(0)) revert ZeroAddress();
        if (provenanceNotary != address(0)) revert ProvenanceNotaryAlreadySet();
        provenanceNotary = notary;
    }

    // ---------------------------------------------------------------------
    // Registration & lifecycle
    // ---------------------------------------------------------------------

    function register(
        bytes32 passportId,
        address principal,
        address agentAddress,
        bytes32 permissionManifestHash,
        string calldata metadataUri
    ) external override {
        if (passportId == bytes32(0)) revert PassportNotFound();
        if (principal == address(0) || agentAddress == address(0)) revert ZeroAddress();
        if (msg.sender != principal) revert NotPrincipal();
        if (_records[passportId].principal != address(0)) revert PassportAlreadyExists();
        if (_passportOfAgent[agentAddress] != bytes32(0)) revert AgentAlreadyBound();

        uint256 tokenId = _nextTokenId++;

        _records[passportId] = SigilTypes.PassportRecord({
            passportId: passportId,
            tokenId: tokenId,
            principal: principal,
            agentAddress: agentAddress,
            createdAt: block.timestamp,
            createdBlock: block.number,
            permissionManifestHash: permissionManifestHash,
            reputationScore: 0,
            taskCount: 0,
            failureCount: 0,
            provenanceRecordCount: 0,
            executionFingerprintCount: 0,
            active: true
        });

        _passportOfAgent[agentAddress] = passportId;
        _tokenIdToPassportId[tokenId] = passportId;
        _tokenURIs[tokenId] = metadataUri;

        _safeMint(principal, tokenId);

        emit AgentRegistered(
            passportId,
            tokenId,
            principal,
            agentAddress,
            permissionManifestHash,
            metadataUri
        );
    }

    function rotateAgentAddress(bytes32 passportId, address newAgentAddress)
        external
        override
        onlyPrincipal(passportId)
    {
        if (newAgentAddress == address(0)) revert ZeroAddress();
        if (_passportOfAgent[newAgentAddress] != bytes32(0)) revert AgentAlreadyBound();

        SigilTypes.PassportRecord storage rec = _records[passportId];
        address oldAgent = rec.agentAddress;
        delete _passportOfAgent[oldAgent];

        rec.agentAddress = newAgentAddress;
        rec.active = true;
        _passportOfAgent[newAgentAddress] = passportId;

        emit AgentRotated(passportId, oldAgent, newAgentAddress);
    }

    function revokeAgent(bytes32 passportId) external override onlyPrincipal(passportId) {
        SigilTypes.PassportRecord storage rec = _records[passportId];
        address agent = rec.agentAddress;
        rec.active = false;
        delete _passportOfAgent[agent];
        emit AgentRevoked(passportId, agent);
    }

    function updatePermissions(bytes32 passportId, bytes32 newManifestHash)
        external
        override
        onlyPrincipal(passportId)
    {
        bytes32 oldHash = _records[passportId].permissionManifestHash;
        _records[passportId].permissionManifestHash = newManifestHash;
        emit PermissionsUpdated(passportId, oldHash, newManifestHash);
    }

    // ---------------------------------------------------------------------
    // Relay-only mutators
    // ---------------------------------------------------------------------

    function appendFingerprint(
        bytes32 passportId,
        bytes32 fingerprintHash,
        bytes32 executionTxHash
    ) external override onlyKeeperRelay {
        SigilTypes.PassportRecord storage rec = _records[passportId];
        if (rec.principal == address(0)) revert PassportNotFound();
        if (!rec.active) revert AgentInactive();

        uint256 idx = rec.executionFingerprintCount;
        rec.executionFingerprintCount = idx + 1;

        emit FingerprintAppended(passportId, fingerprintHash, executionTxHash, idx);
    }

    function appendAttestation(
        bytes32 passportId,
        SigilTypes.AttestationType attestationType,
        bool passed,
        bytes32 dataHash
    ) external override onlyKeeperRelay {
        SigilTypes.PassportRecord storage rec = _records[passportId];
        if (rec.principal == address(0)) revert PassportNotFound();
        if (!rec.active) revert AgentInactive();

        rec.taskCount += 1;
        if (!passed) {
            rec.failureCount += 1;
        }
        uint256 newScore = SigilTypes.computeReputation(rec.taskCount, rec.failureCount);
        rec.reputationScore = newScore;

        emit AttestationAppended(
            passportId,
            attestationType,
            passed,
            dataHash,
            newScore,
            rec.taskCount,
            rec.failureCount
        );
    }

    function incrementProvenanceCount(bytes32 passportId) external override onlyProvenanceNotary {
        SigilTypes.PassportRecord storage rec = _records[passportId];
        if (rec.principal == address(0)) revert PassportNotFound();
        rec.provenanceRecordCount += 1;
        emit ProvenanceCounted(passportId, rec.provenanceRecordCount);
    }

    // ---------------------------------------------------------------------
    // Relay management
    // ---------------------------------------------------------------------

    function addRelay(address relay) external override onlyOwner {
        if (relay == address(0)) revert ZeroAddress();
        _keeperRelays[relay] = true;
        emit RelayAdded(relay);
    }

    function removeRelay(address relay) external override onlyOwner {
        _keeperRelays[relay] = false;
        emit RelayRemoved(relay);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function resolve(bytes32 passportId)
        external
        view
        override
        returns (SigilTypes.PassportRecord memory)
    {
        SigilTypes.PassportRecord memory rec = _records[passportId];
        if (rec.principal == address(0)) revert PassportNotFound();
        return rec;
    }

    function passportOfAgent(address agent) external view override returns (bytes32) {
        return _passportOfAgent[agent];
    }

    function isAuthorizedSigner(bytes32 passportId, address signer)
        external
        view
        override
        returns (bool)
    {
        SigilTypes.PassportRecord storage rec = _records[passportId];
        return rec.active && rec.agentAddress == signer && signer != address(0);
    }

    function reputationScore(bytes32 passportId)
        external
        view
        override
        returns (uint256 score, uint256 taskCount, uint256 failureCount)
    {
        SigilTypes.PassportRecord storage rec = _records[passportId];
        if (rec.principal == address(0)) revert PassportNotFound();
        return (rec.reputationScore, rec.taskCount, rec.failureCount);
    }

    function isRelay(address relay) external view override returns (bool) {
        return _keeperRelays[relay];
    }

    function exists(bytes32 passportId) external view override returns (bool) {
        return _records[passportId].principal != address(0);
    }

    function passportIdOfTokenId(uint256 tokenId) external view returns (bytes32) {
        return _tokenIdToPassportId[tokenId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _tokenURIs[tokenId];
    }

    // ---------------------------------------------------------------------
    // Soulbound enforcement (OpenZeppelin v5 hook)
    // ---------------------------------------------------------------------

    /// @dev Allow mint (from == address(0)) and burn (to == address(0)) only.
    ///      Block all transfers — passports are soulbound to the principal.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }
}
