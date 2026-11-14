Educational project for the course Introduction to Finance. Not a real product, service or investment offer. Do not use with real funds.

# SteppeTrust – batch traceability and certification prototype

Team AL DOS · Introduction to Finance, 2026–2027 · Final Project

**Demo video:** [link to the demo video – add before submission]

SteppeTrust is a hypothetical permissioned blockchain platform for transparent logistics and certification in Kazakhstan's agri-food sector. Every batch (for example a railcar of wheat) gets one shared event log: the producer registers the batch, logistics operators confirm transport events, an accredited laboratory attaches its quality certificate and the buyer confirms receipt. When all of this is done, the batch gets the status **Verified**. Anyone can check that a document they received is exactly the one registered for the batch.

Only hashes go on-chain. Contracts, certificate scans, commercial terms and personal data stay off-chain.

This repository contains only the prototype of the core use case. It runs on the **local Hardhat network** with the test accounts that Hardhat creates. No public testnet and no main network are used, no private keys are needed, and the contract does not hold or move any money or tokens. All test data (product codes, weights, documents) is invented.

## What is inside

| Path | What it is |
|---|---|
| `contracts/BatchRegistry.sol` | The registry contract (roles, batch life cycle, certificates, document check, pause) |
| `test/BatchRegistry.test.js` | 10 unit tests |
| `scripts/deploy.js` | Deploys the contract to a local node and grants test roles |
| `scripts/demo.js` | Runs the main use case step by step with console output (used in the demo video) |

## Batch life cycle

`Registered → InTransit → Arrived → Verified`, with two exit states: `Disputed` (the buyer received more than 2% less weight than registered) and `Revoked` (the laboratory withdrew its certificate, for example after a failed re-test).

## Roles

| Role | Who | Can do |
|---|---|---|
| `PRODUCER_ROLE` | farmer, cooperative, processor | register a batch with the hash of its documents |
| `LOGISTICS_ROLE` | carrier, elevator, warehouse | confirm pickup, handover and arrival |
| `CERTIFIER_ROLE` | accredited laboratory | attach a certificate hash with an expiry date, revoke a certificate |
| `BUYER_ROLE` | processor, exporter, retailer | confirm receipt and the weight received (only for batches addressed to them) |
| `PAUSER_ROLE` | SteppeTrust (multisig in production) | pause and unpause the contract |
| `DEFAULT_ADMIN_ROLE` | SteppeTrust (multisig in production) | onboard organisations by granting roles, revoke roles (for example after a key is lost) |

## How to run

Requirements: Node.js 18 or newer (tested on 22) and npm.

```bash
npm install
npx hardhat compile
npx hardhat test                   # runs the 10 unit tests
npx hardhat run scripts/demo.js    # main use case step by step
```

To deploy to a local node in a separate terminal:

```bash
npx hardhat node                                       # terminal 1
npx hardhat run scripts/deploy.js --network localhost  # terminal 2
```

## Tests

1. Deploys with admin and pauser roles
2. Producer registers a batch and only the hash goes on-chain
3. Access control: only the right role can act
4. Full flow: register → pickup → arrival → certify → receipt = Verified
5. Buyer cannot accept a batch without a laboratory certificate
6. Weight loss above 2% puts the batch into Disputed
7. Laboratory can revoke a certificate (recall) and the batch is no longer verified
8. Anyone can detect a forged document by its hash
9. Only the named buyer can confirm, and a revoked (lost) key stops working
10. An expired certificate is rejected and pause stops new batches

## Security notes

- Role-based access control (OpenZeppelin `AccessControl`); every role check is covered by a test.
- No personal data on-chain: only `bytes32` hashes of documents.
- The contract holds no funds and makes no external calls, so reentrancy cannot drain value.
- A lost or stolen participant key is handled by revoking the role (test 9); admin and pauser roles are held by a multisig in production.
- `.env` is listed in `.gitignore`. The prototype does not need any key; never put a key of a wallet that holds real assets in this project.

## Credits and licence

- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) v5 (MIT licence): `AccessControl`, `Pausable`.
- [Hardhat](https://hardhat.org/) and Hardhat Toolbox for compiling, testing and the local network.
- AI assistance is disclosed in the AI Disclosure Statement of the report.

This code is released under the MIT licence for educational use only.
