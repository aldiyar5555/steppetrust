// Educational project for the course Introduction to Finance.
// Not a real product, service or investment offer. Do not use with real funds.
require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  // Only the local development network is used. No public network is configured,
  // so no private keys are needed anywhere in this repository.
  defaultNetwork: "hardhat",
  networks: {
    localhost: { url: "http://127.0.0.1:8545" },
  },
};
