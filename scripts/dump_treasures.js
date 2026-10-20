/**
 * 导出本地链全部宝藏（TreasureBuried 事件）为 JSON——供视频 capture 脚本构造 mock 后端数据。
 * 用法（在 contracts/ 目录）：npx hardhat run scripts/dump_treasures.js --network localhost
 * 输出：../artifacts/intro-video/shots/chain-treasures.json
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const dep = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", network.name, "TreasureVault.json"))
  );
  const vault = await ethers.getContractAt("TreasureVault", dep.address);
  const logs = await vault.queryFilter(vault.filters.TreasureBuried(), 0);
  const out = [];
  for (const log of logs) {
    const block = await ethers.provider.getBlock(log.blockNumber);
    out.push({
      treasureId: log.args._treasureId,
      txHash: log.transactionHash,
      block: log.blockNumber,
      sender: log.args._sender,
      ethAmount: log.args._ethAmount.toString(),
      message: log.args._message,
      secretWords: log.args._secretWords,
      deadline: Number(log.args._deadline),
      buriedAt: block ? block.timestamp : null,
      annex: {
        types: [...log.args._annexTypes].map(Number),
        tokens: [...log.args._annexTokens],
        amounts: [...log.args._annexAmounts].map(String),
        tokenIds: [...log.args._annexTokenIds].map(String),
      },
    });
  }
  const dest = path.join(__dirname, "..", "..", "artifacts", "intro-video", "shots", "chain-treasures.json");
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`导出 ${out.length} 件宝藏 → ${dest}`);
  for (const t of out) console.log(`${t.treasureId.slice(0, 10)}… block ${t.block} — ${t.message.slice(0, 50)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
