// Educational project for the course Introduction to Finance.
// Not a real product, service or investment offer. Do not use with real funds.
// Walks through the main use case step by step (used in the demo video).
// All data is invented test data.
const { ethers } = require("hardhat");

const id = (s) => ethers.encodeBytes32String(s);
const hash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const STATUS = ["None", "Registered", "InTransit", "Arrived", "Verified", "Disputed", "Revoked"];

async function main() {
  const [admin, producer, logistics, lab, buyer] = await ethers.getSigners();
  const show = async (r) => console.log("   status:", STATUS[Number((await r.getBatch(1)).status)]);

  console.log("\nStep 0. Deploy BatchRegistry on the local Hardhat network and grant roles");
  const r = await ethers.deployContract("BatchRegistry", [admin.address]);
  await r.grantRole(await r.PRODUCER_ROLE(), producer.address);
  await r.grantRole(await r.LOGISTICS_ROLE(), logistics.address);
  await r.grantRole(await r.CERTIFIER_ROLE(), lab.address);
  await r.grantRole(await r.BUYER_ROLE(), buyer.address);
  console.log("   registry:", await r.getAddress());

  const docs = hash("test batch documents (fake)");
  console.log("\nStep 1. Producer (test cooperative) registers 60,000 kg of wheat; only the document hash goes on-chain");
  await r.connect(producer).registerBatch(id("WHEAT-CLASS3"), 60_000, docs, buyer.address);
  await show(r);

  console.log("\nStep 2. Logistics operator confirms pickup at the elevator");
  await r.connect(logistics).recordEvent(1, 0, hash("pickup: elevator A, seal no. TEST-1"));
  await show(r);

  console.log("\nStep 3. Logistics operator confirms arrival at the buyer's warehouse");
  await r.connect(logistics).recordEvent(1, 2, hash("arrival: warehouse B"));
  await show(r);

  console.log("\nStep 4. Accredited laboratory attaches its certificate hash (valid 90 days)");
  const block = await ethers.provider.getBlock("latest");
  await r.connect(lab).certifyBatch(1, hash("lab certificate (fake)"), block.timestamp + 90 * 86400);

  console.log("\nStep 5. Buyer confirms receipt of 59,600 kg (0.7% loss, within the 2% tolerance)");
  await r.connect(buyer).confirmReceipt(1, 59_600);
  await show(r);

  console.log("\nStep 6. Anyone can check documents against the chain");
  console.log("   original documents match:", await r.verifyDocument(1, docs));
  console.log("   forged document matches: ", await r.verifyDocument(1, hash("forged")));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
