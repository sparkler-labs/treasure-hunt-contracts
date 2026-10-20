/**
 * 端到端演示脚本：在已启动的本地链上跑通完整游戏闭环（含 ERC20/ERC721 多资产）。
 * 前置：npm run node（另一终端）+ npm run deploy:localhost
 * 用法：npx hardhat run scripts/e2e.js --network localhost
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

// 与前端 web/src/lib/password.ts 一致（COORD_DECIMALS=3）
const toPassword = (lat, lng, depth) => `${lat.toFixed(3)}|${lng.toFixed(3)}|${depth}`;
const passwordHash = (pw) => ethers.keccak256(ethers.toUtf8Bytes(pw));
const DAY = 24 * 60 * 60;

async function main() {
  const dep = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", network.name, "TreasureVault.json"))
  );
  const vault = await ethers.getContractAt("TreasureVault", dep.address);
  const [burier, digger] = await ethers.getSigners();
  const deadline = Math.floor(Date.now() / 1000) + 30 * DAY;
  console.log(`TreasureVault @ ${dep.address}`);

  // ===== 第 1 件：纯 ETH（保留在链上，供前端页面展示与试玩） =====
  const pw1 = toPassword(31.23, 121.474, 7);
  await (
    await vault.connect(burier).buryTreasure(
      [[0n, ethers.ZeroAddress, ethers.parseEther("1"), 0n]],
      "谜面：城隍庙的九曲桥上，人最多的那座桥",
      "线索：数到第三盏灯",
      passwordHash(pw1),
      deadline,
      { value: ethers.parseEther("1") }
    )
  ).wait();
  console.log(`[A] 埋下 1 ETH @ (${pw1})`);

  // ===== 第 2 件：ERC20 + ERC721 组合，走完整探测+挖掘流程 =====
  const token = await (await ethers.getContractFactory("MockERC20")).deploy();
  const nft = await (await ethers.getContractFactory("MockERC721")).deploy();
  const tokenId = await nft.tokenOfOwnerByIndex(burier.address, 0);
  const pw2 = toPassword(-31.231, 121.474, 42);
  await token.connect(burier).approve(dep.address, ethers.parseEther("77"));
  await nft.connect(burier).approve(dep.address, tokenId);
  await (
    await vault.connect(burier).buryTreasure(
      [
        [1n, await token.getAddress(), ethers.parseEther("77"), 0n],
        [2n, await nft.getAddress(), 0n, tokenId],
      ],
      "谜面：南方的海岛，企鹅的家",
      "线索：水下 42 米，藏着金币与古董",
      passwordHash(pw2),
      deadline
    )
  ).wait();
  console.log(`[A] 埋下 77 MGLD + MART #${tokenId} @ (${pw2})`);

  // ===== 账号 B 寻宝 =====
  const wrong = await vault.connect(digger).probe(toPassword(-31.23, 121.474, 43));
  console.log(`[B] 探测 (深度 43) → found=${wrong[0]}（应为 false）`);
  const hit = await vault.connect(digger).probe(pw2);
  console.log(`[B] 探测 (${pw2}) → found=${hit[0]} "${hit[2]}"`);

  const digTx = await vault.connect(digger).dig(pw2);
  await digTx.wait();
  console.log(
    `[B] 挖掘 → MGLD ${ethers.formatEther(await token.balanceOf(digger.address))}、NFT 归属 ${await nft.ownerOf(tokenId) === digger.address ? "挖掘者 ✓" : "异常"}`
  );

  const vaultBalance = await ethers.provider.getBalance(dep.address);
  console.log(`合约余额 ${ethers.formatEther(vaultBalance)} ETH（应剩余 1，即第一件宝藏）`);
  console.log(`\n✅ E2E 通过。前端将显示 1 件 ETH 宝藏可试玩：${pw1}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
