require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();

const pk = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // 与 PostOffice 保持一致；prevrandao 在 paris 下可用
      evmVersion: "paris",
    },
  },
  // Robinhood Chain 的 Blockscout 浏览器验证（hardhat-verify 的 blockscout 子任务，免 API key）
  blockscout: {
    enabled: true,
    customChains: [
      {
        network: "robinhood",
        chainId: 4663,
        urls: {
          apiURL: "https://robinhoodchain.blockscout.com/api",
          browserURL: "https://robinhoodchain.blockscout.com",
        },
      },
    ],
  },
  // 源码验证：单个字符串 key = Etherscan V2 API（全家族链通用，含 Arbiscan）；
  // Robinhood Blockscout 免 key（上方 blockscout.customChains 指定官方端点）
  etherscan: {
    apiKey: process.env.ARBISCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "",
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    // ===== 测试环境 =====
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      chainId: 11155111,
      accounts: pk,
    },
    // ===== 正式环境 =====
    robinhood: {
      // Robinhood Chain（Arbitrum Orbit L2）：chainId 4663
      url: process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts: pk,
    },
    bsc: {
      url: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
      chainId: 56,
      accounts: pk,
    },
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      accounts: pk,
    },
    optimism: {
      url: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
      chainId: 10,
      accounts: pk,
    },
  },
};
