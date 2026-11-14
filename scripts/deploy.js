// Educational project for the course Introduction to Finance.
// Not a real product, service or investment offer. Do not use with real funds.
const { ethers } = require("hardhat");

async function main() {
  const [admin, producer, logistics, lab, buyer] = await ethers.getSigners();
  const registry = await ethers.deployContract("BatchRegistry", [admin.address]);
  await registry.waitForDeployment();
  for (const [role, who] of [["PRODUCER_ROLE", producer], ["LOGISTICS_ROLE", logistics], ["CERTIFIER_ROLE", lab], ["BUYER_ROLE", buyer]]) {
    await (await registry.grantRole(await registry[role](), who.address)).wait();
  }
  console.log("BatchRegistry deployed to:", await registry.getAddress());
  console.log("Roles granted to Hardhat test accounts #1-#4 (producer, logistics, lab, buyer)");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
