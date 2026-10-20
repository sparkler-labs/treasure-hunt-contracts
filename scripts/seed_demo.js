/**
 * 演示数据 seed：为本地开发链埋入英文谜面宝藏（视频拍摄/演示用）。
 * 前置：npm run node + npm run deploy:localhost
 * 用法：npx hardhat run scripts/seed_demo.js --network localhost
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
  const [burier] = await ethers.getSigners();
  const deadline = Math.floor(Date.now() / 1000) + 30 * DAY;

  const ethBurials = [
    {
      lat: 31.24, lng: 121.49, depth: 18, eth: "0.75",
      message: "Where the river meets the city lights — beneath the clock tower's gaze",
      clue: "The clock still marks the hours",
    },
    {
      lat: 31.227, lng: 121.492, depth: 88, eth: "0.25",
      message: "A garden of dragons in the old city — the busiest bridge holds the clue",
      clue: "Nine turns, and you are close",
    },
    {
      lat: 31.234, lng: 121.465, depth: 7, eth: "0.5",
      message: "Hidden in plain sight, where the crowds never look",
      clue: "",
    },
  ];
  for (const b of ethBurials) {
    const pw = toPassword(b.lat, b.lng, b.depth);
    await (
      await vault.connect(burier).buryTreasure(
        [[0n, ethers.ZeroAddress, ethers.parseEther(b.eth), 0n]],
        b.message,
        b.clue,
        passwordHash(pw),
        deadline,
        { value: ethers.parseEther(b.eth) }
      )
    ).wait();
    console.log(`[ETH] ${b.eth} ETH @ "${pw}" — ${b.message}`);
  }

  const token = await (await ethers.getContractFactory("MockERC20")).deploy();
  await token.waitForDeployment();
  const pwErc20 = toPassword(31.239, 121.499, 259);
  await (await token.connect(burier).approve(dep.address, ethers.parseEther("1200"))).wait();
  await (
    await vault.connect(burier).buryTreasure(
      [[1n, await token.getAddress(), ethers.parseEther("1200"), 0n]],
      "Between the pearls, high above the river — look where the tower pierces the sky",
      "The highest pearl of them all",
      passwordHash(pwErc20),
      deadline
    )
  ).wait();
  console.log(`[ERC20] 1200 MGLD @ "${pwErc20}" — MockERC20: ${await token.getAddress()}`);

  console.log("\nseed 完成：4 件宝藏已埋入");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
