/**
 * 命令行埋宝工具（演示/测试用）。
 * 用法：BURY_ARGS="纬度,经度,深度,ETH数量" npx hardhat run scripts/bury.js --network localhost
 * 例：BURY_ARGS="31.234,121.465,77,0.2" npx hardhat run scripts/bury.js --network localhost
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const toPassword = (lat, lng, depth) => `${lat.toFixed(3)}|${lng.toFixed(3)}|${depth}`;
const passwordHash = (pw) => ethers.keccak256(ethers.toUtf8Bytes(pw));

async function main() {
  const [lat, lng, depth, eth] = (process.env.BURY_ARGS || "").split(",");
  if (!lat || !lng || !depth || !eth) {
    throw new Error("缺少参数：BURY_ARGS=\"纬度,经度,深度,ETH数量\"");
  }
  const dep = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", network.name, "TreasureVault.json"))
  );
  const vault = await ethers.getContractAt("TreasureVault", dep.address);
  const [burier] = await ethers.getSigners();
  const pw = toPassword(Number(lat), Number(lng), Number(depth));
  const tx = await vault
    .connect(burier)
    .buryTreasure(
      [[0n, ethers.ZeroAddress, ethers.parseEther(eth), 0n]],
      `谜面：命令行埋的宝藏（${pw} 附近）`,
      "线索：见埋宝日志",
      passwordHash(pw),
      Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      { value: ethers.parseEther(eth) }
    );
  await tx.wait();
  console.log(`已埋入 ${eth} ETH @ 密码 "${pw}"（谜面与线索会公开上链，仅演示用）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
