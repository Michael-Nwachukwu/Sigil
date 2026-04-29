// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IProvenanceNotary} from "./interfaces/IProvenanceNotary.sol";
import {ISigilRegistry} from "./interfaces/ISigilRegistry.sol";
import {SigilTypes} from "./libraries/SigilTypes.sol";

/// @title ProvenanceNotary
/// @notice Notarizes AI-generated artifacts. The agent (msg.sender) self-signs
///         over an EIP-712 typed-data payload that includes a per-signer
///         nonce and a signed timestamp for replay protection. Authorization
///         is delegated to SigilRegistry via `isAuthorizedSigner`.
contract ProvenanceNotary is EIP712, IProvenanceNotary {
    using ECDSA for bytes32;

    /// @dev keccak256("Notarization(bytes32 passportId,bytes32 outputHash,bytes32 inputContextHash,bytes32 modelFingerprintHash,uint256 nonce,uint256 timestamp)")
    bytes32 private constant _NOTARIZATION_TYPEHASH =
        keccak256(
            "Notarization(bytes32 passportId,bytes32 outputHash,bytes32 inputContextHash,bytes32 modelFingerprintHash,uint256 nonce,uint256 timestamp)"
        );

    uint256 private constant _TIMESTAMP_DRIFT = 5 minutes;

    ISigilRegistry public immutable registry;

    mapping(bytes32 => SigilTypes.ProvenanceRecord) private _records;
    mapping(address => uint256) private _signerNonces;
    mapping(bytes32 => bytes32) private _recordIdByOutput;
    mapping(bytes32 => bytes32[]) private _recordIdsByPassport;

    error NotAuthorizedSigner();
    error InvalidNonce();
    error InvalidSignature();
    error TimestampOutOfRange();
    error OutputAlreadyNotarized();
    error RecordNotFound();
    error ZeroAddress();

    constructor(address registryAddress)
        EIP712("SigilProvenanceNotary", "1")
    {
        if (registryAddress == address(0)) revert ZeroAddress();
        registry = ISigilRegistry(registryAddress);
    }

    // ---------------------------------------------------------------------
    // Notarization
    // ---------------------------------------------------------------------

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
    ) external override returns (bytes32 recordId) {
        if (!registry.isAuthorizedSigner(passportId, msg.sender)) revert NotAuthorizedSigner();
        if (_signerNonces[msg.sender] != nonce) revert InvalidNonce();
        if (
            signedTimestamp + _TIMESTAMP_DRIFT < block.timestamp ||
            signedTimestamp > block.timestamp + _TIMESTAMP_DRIFT
        ) revert TimestampOutOfRange();
        if (_recordIdByOutput[outputHash] != bytes32(0)) revert OutputAlreadyNotarized();

        bytes32 structHash = keccak256(
            abi.encode(
                _NOTARIZATION_TYPEHASH,
                passportId,
                outputHash,
                inputContextHash,
                modelFingerprintHash,
                nonce,
                signedTimestamp
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(agentSignature);
        if (recovered != msg.sender) revert InvalidSignature();

        _signerNonces[msg.sender] = nonce + 1;

        SigilTypes.PassportRecord memory passport = registry.resolve(passportId);

        recordId = keccak256(
            abi.encode(passportId, msg.sender, outputHash, nonce, signedTimestamp)
        );

        _records[recordId] = SigilTypes.ProvenanceRecord({
            recordId: recordId,
            passportId: passportId,
            principal: passport.principal,
            agent: msg.sender,
            modelFingerprintHash: modelFingerprintHash,
            modelId: modelId,
            inputContextHash: inputContextHash,
            inputContextSize: inputContextSize,
            outputHash: outputHash,
            artifactType: artifactType,
            agentSignature: agentSignature,
            nonce: nonce,
            timestamp: signedTimestamp,
            blockNumber: block.number,
            executionFingerprintRef: executionFingerprintRef
        });

        _recordIdByOutput[outputHash] = recordId;
        _recordIdsByPassport[passportId].push(recordId);

        registry.incrementProvenanceCount(passportId);

        emit ArtifactNotarized(
            recordId,
            passportId,
            msg.sender,
            passport.principal,
            outputHash,
            inputContextHash,
            modelFingerprintHash,
            artifactType,
            nonce,
            signedTimestamp
        );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function signerNonces(address signer) external view override returns (uint256) {
        return _signerNonces[signer];
    }

    function resolve(bytes32 recordId)
        external
        view
        override
        returns (SigilTypes.ProvenanceRecord memory)
    {
        SigilTypes.ProvenanceRecord memory rec = _records[recordId];
        if (rec.recordId == bytes32(0)) revert RecordNotFound();
        return rec;
    }

    function resolveByOutput(bytes32 outputHash) external view override returns (bytes32) {
        return _recordIdByOutput[outputHash];
    }

    function recordsByAgent(
        bytes32 passportId,
        uint256 offset,
        uint256 limit
    ) external view override returns (bytes32[] memory recordIds) {
        bytes32[] storage all = _recordIdsByPassport[passportId];
        if (offset >= all.length) return new bytes32[](0);
        uint256 end = offset + limit;
        if (end > all.length) end = all.length;
        uint256 size = end - offset;
        recordIds = new bytes32[](size);
        for (uint256 i = 0; i < size; i++) {
            recordIds[i] = all[offset + i];
        }
    }

    function recordCountByAgent(bytes32 passportId) external view override returns (uint256) {
        return _recordIdsByPassport[passportId].length;
    }

    function verify(bytes32 recordId)
        external
        view
        override
        returns (bool valid, string memory reason)
    {
        SigilTypes.ProvenanceRecord memory rec = _records[recordId];
        if (rec.recordId == bytes32(0)) return (false, "record-not-found");

        bytes32 structHash = keccak256(
            abi.encode(
                _NOTARIZATION_TYPEHASH,
                rec.passportId,
                rec.outputHash,
                rec.inputContextHash,
                rec.modelFingerprintHash,
                rec.nonce,
                rec.timestamp
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, rec.agentSignature);
        if (err != ECDSA.RecoverError.NoError) return (false, "signature-malformed");
        if (recovered != rec.agent) return (false, "signature-mismatch");

        bytes32 expectedRecordId = keccak256(
            abi.encode(rec.passportId, rec.agent, rec.outputHash, rec.nonce, rec.timestamp)
        );
        if (expectedRecordId != recordId) return (false, "recordId-mismatch");

        return (true, "");
    }

    function DOMAIN_SEPARATOR() external view override returns (bytes32) {
        return _domainSeparatorV4();
    }

    function NOTARIZATION_TYPEHASH() external pure override returns (bytes32) {
        return _NOTARIZATION_TYPEHASH;
    }
}
