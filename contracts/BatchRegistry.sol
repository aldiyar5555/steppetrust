// SPDX-License-Identifier: MIT
// Educational project for the course Introduction to Finance.
// Not a real product, service or investment offer. Do not use with real funds.
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title SteppeTrust BatchRegistry - shared log for agri-food batches (prototype)
/// @notice One record per batch: the producer registers it, logistics operators
///         confirm transport events, an accredited laboratory certifies quality and
///         the buyer confirms receipt. Only hashes of documents are stored on-chain;
///         contracts, certificate scans and personal data stay off-chain.
/// @dev No tokens or ether are held or moved by this contract.
contract BatchRegistry is AccessControl, Pausable {
    // ---------------------------------------------------------------- roles
    bytes32 public constant PRODUCER_ROLE = keccak256("PRODUCER_ROLE");
    bytes32 public constant LOGISTICS_ROLE = keccak256("LOGISTICS_ROLE");
    bytes32 public constant CERTIFIER_ROLE = keccak256("CERTIFIER_ROLE");
    bytes32 public constant BUYER_ROLE = keccak256("BUYER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Buyer may accept up to 2% loss in weight (drying, handling).
    uint16 public constant WEIGHT_TOLERANCE_BPS = 200;
    uint16 private constant BPS = 10_000;

    // ---------------------------------------------------------------- types
    enum Status {
        None,       // 0 - batch does not exist
        Registered, // 1 - created by the producer
        InTransit,  // 2 - picked up by a logistics operator
        Arrived,    // 3 - delivered to the buyer's warehouse
        Verified,   // 4 - certified and accepted by the buyer
        Disputed,   // 5 - buyer reported a weight discrepancy
        Revoked     // 6 - certificate revoked by the laboratory (recall)
    }

    enum EventType {
        Pickup,   // 0
        Handover, // 1 - between two logistics operators or warehouses
        Arrival   // 2
    }

    struct Batch {
        address producer;
        address buyer;
        bytes32 productCode;  // e.g. "WHEAT-CLASS3"
        uint64 quantityKg;
        uint64 registeredAt;
        bytes32 docHash;      // hash of the off-chain document package
        bytes32 certHash;     // hash of the laboratory certificate
        uint64 certValidUntil;
        uint32 eventCount;
        Status status;
    }

    // ---------------------------------------------------------------- state
    uint256 public batchCount;
    mapping(uint256 => Batch) private _batches;

    // --------------------------------------------------------------- events
    event BatchRegistered(uint256 indexed batchId, address indexed producer, address indexed buyer,
        bytes32 productCode, uint64 quantityKg, bytes32 docHash);
    event LogisticsEvent(uint256 indexed batchId, EventType eventType, address indexed operator, bytes32 dataHash);
    event BatchCertified(uint256 indexed batchId, address indexed certifier, bytes32 certHash, uint64 validUntil);
    event ReceiptConfirmed(uint256 indexed batchId, address indexed buyer, uint64 receivedKg, Status result);
    event CertificateRevoked(uint256 indexed batchId, address indexed certifier, bytes32 reasonHash);

    // --------------------------------------------------------------- errors
    error ZeroAddress();
    error InvalidInput();
    error BatchNotFound();
    error WrongStatus();
    error NotBatchBuyer();
    error NotCertified();
    error CertificateExpired();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // ============================================================ main flow

    /// @notice Producer registers a new batch and the hash of its documents.
    function registerBatch(bytes32 productCode, uint64 quantityKg, bytes32 docHash, address buyer)
        external
        whenNotPaused
        onlyRole(PRODUCER_ROLE)
        returns (uint256 batchId)
    {
        if (quantityKg == 0 || docHash == bytes32(0) || productCode == bytes32(0)) revert InvalidInput();
        if (!hasRole(BUYER_ROLE, buyer)) revert InvalidInput();

        batchId = ++batchCount;
        Batch storage b = _batches[batchId];
        b.producer = msg.sender;
        b.buyer = buyer;
        b.productCode = productCode;
        b.quantityKg = quantityKg;
        b.registeredAt = uint64(block.timestamp);
        b.docHash = docHash;
        b.status = Status.Registered;

        emit BatchRegistered(batchId, msg.sender, buyer, productCode, quantityKg, docHash);
    }

    /// @notice Logistics operator confirms a transport event for the batch.
    function recordEvent(uint256 batchId, EventType eventType, bytes32 dataHash)
        external
        whenNotPaused
        onlyRole(LOGISTICS_ROLE)
    {
        Batch storage b = _get(batchId);
        if (eventType == EventType.Pickup) {
            if (b.status != Status.Registered) revert WrongStatus();
            b.status = Status.InTransit;
        } else if (eventType == EventType.Handover) {
            if (b.status != Status.InTransit) revert WrongStatus();
        } else {
            if (b.status != Status.InTransit) revert WrongStatus();
            b.status = Status.Arrived;
        }
        b.eventCount += 1;
        emit LogisticsEvent(batchId, eventType, msg.sender, dataHash);
    }

    /// @notice Accredited laboratory attaches the hash of its quality certificate.
    function certifyBatch(uint256 batchId, bytes32 certHash, uint64 validUntil)
        external
        whenNotPaused
        onlyRole(CERTIFIER_ROLE)
    {
        Batch storage b = _get(batchId);
        if (certHash == bytes32(0) || validUntil <= block.timestamp) revert InvalidInput();
        if (b.status == Status.Verified || b.status == Status.Revoked || b.status == Status.Disputed) {
            revert WrongStatus();
        }
        b.certHash = certHash;
        b.certValidUntil = validUntil;
        emit BatchCertified(batchId, msg.sender, certHash, validUntil);
    }

    /// @notice The buyer named in the batch confirms receipt and the weight received.
    ///         The batch becomes Verified only if it arrived, has a valid certificate
    ///         and the weight loss is within the 2% tolerance.
    function confirmReceipt(uint256 batchId, uint64 receivedKg) external whenNotPaused {
        Batch storage b = _get(batchId);
        if (msg.sender != b.buyer || !hasRole(BUYER_ROLE, msg.sender)) revert NotBatchBuyer();
        if (b.status != Status.Arrived) revert WrongStatus();
        if (b.certHash == bytes32(0)) revert NotCertified();
        if (block.timestamp > b.certValidUntil) revert CertificateExpired();

        uint256 minAccepted = (uint256(b.quantityKg) * (BPS - WEIGHT_TOLERANCE_BPS)) / BPS;
        b.status = receivedKg >= minAccepted ? Status.Verified : Status.Disputed;
        emit ReceiptConfirmed(batchId, msg.sender, receivedKg, b.status);
    }

    /// @notice Laboratory revokes its certificate, e.g. after a failed re-test (recall).
    function revokeCertificate(uint256 batchId, bytes32 reasonHash) external onlyRole(CERTIFIER_ROLE) {
        Batch storage b = _get(batchId);
        if (b.certHash == bytes32(0) || b.status == Status.Revoked) revert WrongStatus();
        b.status = Status.Revoked;
        emit CertificateRevoked(batchId, msg.sender, reasonHash);
    }

    // ================================================================ admin

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ================================================================ views

    function getBatch(uint256 batchId) external view returns (Batch memory) {
        if (_batches[batchId].status == Status.None) revert BatchNotFound();
        return _batches[batchId];
    }

    /// @notice Anyone (for example a foreign buyer or an inspector) can check that a
    ///         document they received is exactly the one registered for the batch.
    function verifyDocument(uint256 batchId, bytes32 docHash) external view returns (bool) {
        Batch storage b = _batches[batchId];
        return b.status != Status.None && b.docHash == docHash;
    }

    function isVerified(uint256 batchId) external view returns (bool) {
        return _batches[batchId].status == Status.Verified;
    }

    // ============================================================= internal

    function _get(uint256 batchId) internal view returns (Batch storage b) {
        b = _batches[batchId];
        if (b.status == Status.None) revert BatchNotFound();
    }
}
