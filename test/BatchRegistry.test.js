// Educational project for the course Introduction to Finance.
// Not a real product, service or investment offer. Do not use with real funds.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const id = (s) => ethers.encodeBytes32String(s);
const hash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const DAY = 24 * 60 * 60;
const Status = { None: 0, Registered: 1, InTransit: 2, Arrived: 3, Verified: 4, Disputed: 5, Revoked: 6 };
const Ev = { Pickup: 0, Handover: 1, Arrival: 2 };

// All test data is invented: product codes, weights and document texts are fake.
const PRODUCT = id("WHEAT-CLASS3");
const DOCS = hash("test-batch-001: invoice + phytosanitary scan (fake test data)");
const CERT = hash("test-lab-certificate-001 (fake test data)");

describe("SteppeTrust BatchRegistry", function () {
  async function deployFixture() {
    const [admin, producer, logistics, lab, buyer, stranger] = await ethers.getSigners();
    const registry = await ethers.deployContract("BatchRegistry", [admin.address]);
    await registry.grantRole(await registry.PRODUCER_ROLE(), producer.address);
    await registry.grantRole(await registry.LOGISTICS_ROLE(), logistics.address);
    await registry.grantRole(await registry.CERTIFIER_ROLE(), lab.address);
    await registry.grantRole(await registry.BUYER_ROLE(), buyer.address);
    return { registry, admin, producer, logistics, lab, buyer, stranger };
  }

  // a registered batch of 60,000 kg that has already arrived
  async function arrivedFixture() {
    const f = await deployFixture();
    await f.registry.connect(f.producer).registerBatch(PRODUCT, 60_000, DOCS, f.buyer.address);
    await f.registry.connect(f.logistics).recordEvent(1, Ev.Pickup, hash("pickup"));
    await f.registry.connect(f.logistics).recordEvent(1, Ev.Arrival, hash("arrival"));
    return { ...f, batchId: 1n };
  }

  it("1. deploys with admin and pauser roles", async function () {
    const { registry, admin } = await loadFixture(deployFixture);
    expect(await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    expect(await registry.hasRole(await registry.PAUSER_ROLE(), admin.address)).to.equal(true);
    expect(await registry.batchCount()).to.equal(0n);
  });

  it("2. producer registers a batch and only the hash goes on-chain", async function () {
    const { registry, producer, buyer } = await loadFixture(deployFixture);
    await expect(registry.connect(producer).registerBatch(PRODUCT, 60_000, DOCS, buyer.address))
      .to.emit(registry, "BatchRegistered")
      .withArgs(1n, producer.address, buyer.address, PRODUCT, 60_000, DOCS);
    const b = await registry.getBatch(1);
    expect(b.status).to.equal(Status.Registered);
    expect(b.docHash).to.equal(DOCS);
    expect(b.quantityKg).to.equal(60_000n);
  });

  it("3. access control: only the right role can act", async function () {
    const { registry, producer, stranger, buyer, logistics } = await loadFixture(deployFixture);
    await expect(registry.connect(stranger).registerBatch(PRODUCT, 1_000, DOCS, buyer.address))
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    await registry.connect(producer).registerBatch(PRODUCT, 1_000, DOCS, buyer.address);
    await expect(registry.connect(producer).recordEvent(1, Ev.Pickup, hash("x")))
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    await expect(registry.connect(logistics).certifyBatch(1, CERT, (await time.latest()) + 30 * DAY))
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
  });

  it("4. full flow: register -> pickup -> arrival -> certify -> receipt = Verified", async function () {
    const { registry, lab, buyer, batchId } = await loadFixture(arrivedFixture);
    await registry.connect(lab).certifyBatch(batchId, CERT, (await time.latest()) + 90 * DAY);
    await expect(registry.connect(buyer).confirmReceipt(batchId, 59_500)) // 0.8% loss, within 2%
      .to.emit(registry, "ReceiptConfirmed")
      .withArgs(batchId, buyer.address, 59_500, Status.Verified);
    expect(await registry.isVerified(batchId)).to.equal(true);
    expect((await registry.getBatch(batchId)).eventCount).to.equal(2);
  });

  it("5. buyer cannot accept a batch without a laboratory certificate", async function () {
    const { registry, buyer, batchId } = await loadFixture(arrivedFixture);
    await expect(registry.connect(buyer).confirmReceipt(batchId, 60_000))
      .to.be.revertedWithCustomError(registry, "NotCertified");
  });

  it("6. weight loss above 2% puts the batch into Disputed", async function () {
    const { registry, lab, buyer, batchId } = await loadFixture(arrivedFixture);
    await registry.connect(lab).certifyBatch(batchId, CERT, (await time.latest()) + 90 * DAY);
    await registry.connect(buyer).confirmReceipt(batchId, 57_000); // 5% missing
    expect((await registry.getBatch(batchId)).status).to.equal(Status.Disputed);
    expect(await registry.isVerified(batchId)).to.equal(false);
  });

  it("7. laboratory can revoke a certificate (recall) and the batch is no longer verified", async function () {
    const { registry, lab, buyer, batchId } = await loadFixture(arrivedFixture);
    await registry.connect(lab).certifyBatch(batchId, CERT, (await time.latest()) + 90 * DAY);
    await registry.connect(buyer).confirmReceipt(batchId, 60_000);
    await expect(registry.connect(lab).revokeCertificate(batchId, hash("failed re-test")))
      .to.emit(registry, "CertificateRevoked");
    expect((await registry.getBatch(batchId)).status).to.equal(Status.Revoked);
    expect(await registry.isVerified(batchId)).to.equal(false);
  });

  it("8. anyone can detect a forged document by its hash", async function () {
    const { registry, batchId } = await loadFixture(arrivedFixture);
    expect(await registry.verifyDocument(batchId, DOCS)).to.equal(true);
    expect(await registry.verifyDocument(batchId, hash("forged document"))).to.equal(false);
  });

  it("9. only the named buyer can confirm, and a revoked (lost) key stops working", async function () {
    const { registry, admin, lab, logistics, producer, buyer, stranger, batchId } = await loadFixture(arrivedFixture);
    await registry.connect(lab).certifyBatch(batchId, CERT, (await time.latest()) + 90 * DAY);
    await expect(registry.connect(stranger).confirmReceipt(batchId, 60_000))
      .to.be.revertedWithCustomError(registry, "NotBatchBuyer");

    // the logistics operator reports a lost key: admin revokes the role
    await registry.connect(admin).revokeRole(await registry.LOGISTICS_ROLE(), logistics.address);
    await registry.connect(producer).registerBatch(PRODUCT, 1_000, DOCS, buyer.address);
    await expect(registry.connect(logistics).recordEvent(2, Ev.Pickup, hash("x")))
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
  });

  it("10. an expired certificate is rejected and pause stops new batches", async function () {
    const { registry, admin, lab, buyer, producer, batchId } = await loadFixture(arrivedFixture);
    await registry.connect(lab).certifyBatch(batchId, CERT, (await time.latest()) + 10 * DAY);
    await time.increase(11 * DAY);
    await expect(registry.connect(buyer).confirmReceipt(batchId, 60_000))
      .to.be.revertedWithCustomError(registry, "CertificateExpired");

    await registry.connect(admin).pause();
    await expect(registry.connect(producer).registerBatch(PRODUCT, 1_000, DOCS, buyer.address))
      .to.be.revertedWithCustomError(registry, "EnforcedPause");
  });
});
