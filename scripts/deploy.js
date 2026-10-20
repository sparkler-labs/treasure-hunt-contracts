/**
 * 部署 TreasureVault 并把 {地址, ABI, 部署区块} 按链合并同步到前端 web/src/config/。
 * chains.json 以 chainId 为键合并（多链注册表），每条链只需部署一次。
 * 用法：npx hardhat run scripts/deploy.js --network <localhost|sepolia|robinhood|bsc|arbitrum|optimism>
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log(`网络: ${network.name} (chainId ${chainId})`);
  console.log(`部署人: ${deployer.address}`);

  const vault = await (await ethers.getContractFactory("TreasureVault")).deploy();
  await vault.waitForDeployment();
  const address = await vault.getAddress();
  const deployBlock = vault.deploymentTransaction().blockNumber;
  const abi = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "artifacts", "contracts", "TreasureVault.sol", "TreasureVault.json"))
  ).abi;

  const entry = { network: network.name, address, deployBlock, deployedAt: new Date().toISOString() };

  // 1) 记录到合约项目 deployments/<network>/
  const depDir = path.join(__dirname, "..", "deployments", network.name);
  fs.mkdirSync(depDir, { recursive: true });
  fs.writeFileSync(path.join(depDir, "TreasureVault.json"), JSON.stringify({ chainId, ...entry, abi }, null, 2));

  // 2) 按链合并写入前端 web/src/config/chains.json（保留其他链的条目）
  const webCfg = path.join(__dirname, "..", "..", "web", "src", "config");
  if (fs.existsSync(path.join(webCfg))) {
    const chainsPath = path.join(webCfg, "chains.json");
    const chains = fs.existsSync(chainsPath) ? JSON.parse(fs.readFileSync(chainsPath)) : {};
    chains[String(chainId)] = entry;
    fs.writeFileSync(chainsPath, JSON.stringify(chains, null, 2));
    console.log(`已同步前端配置: web/src/config/chains.json[chainId ${chainId}]`);
  } else {
    console.warn("未找到 web/src/config/，跳过前端同步（先创建 web 项目再部署）");
  }

  console.log(`TreasureVault 已部署: ${address} (区块 ${deployBlock})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
