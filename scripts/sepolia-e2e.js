const fs = require("fs"); const path = require("path");
const { ethers, network } = require("hardhat");
const toPassword = (lat, lng, depth) => `${lat.toFixed(3)}|${lng.toFixed(3)}|${depth}`;
const passwordHash = (pw) => ethers.keccak256(ethers.toUtf8Bytes(pw));
const DAY = 24*60*60;
async function send(signedTxPromise) { /* via wallet */ }
async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", network.name, "TreasureVault.json")));
  const vault = await ethers.getContractAt("TreasureVault", dep.address);
  const [signer] = await ethers.getSigners();
  const provider = signer.provider;
  const deadline = Math.floor(Date.now()/1000) + 30*DAY;
  const fee = await provider.getFeeData();
  // 用更高 tip 手动签名，避免公共节点的 underpriced 拒绝
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  async function sendTx(tx) {
    const gas = await provider.estimateGas({ ...tx, from: wallet.address });
    const { maxFeePerGas, maxPriorityFeePerGas } = await provider.getFeeData();
    const signed = await wallet.signTransaction({
      ...tx, gasLimit: gas * 130n / 100n,
      maxPriorityFeePerGas: (maxPriorityFeePerGas ?? 1000000000n) + 2n*1000000000n,
      maxFeePerGas: (maxFeePerGas ?? 20000000000n) + 3n*1000000000n,
      nonce: await provider.getTransactionCount(wallet.address, "pending"),
      type: 2,
    });
    const sent = await provider.broadcastTransaction(signed);
    return provider.waitForTransaction(sent.hash, 1, 120000);
  }
  // 第 1 件：1 ETH 保留给玩家
  const pw1 = toPassword(31.2304, 121.4737, 7);
  const r1 = await sendTx({ to: dep.address, value: ethers.parseEther("1"), data: vault.interface.encodeFunctionData("buryTreasure", [
    [[0n, ethers.ZeroAddress, ethers.parseEther("1"), 0n]],
    "谜面：城隍庙的九曲桥上，人最多的那座桥", "线索：数到第三盏灯", passwordHash(pw1), deadline]) });
  console.log("A bury 1 ETH:", r1.status === 1 ? "ok" : "FAIL", r1.hash);
  // 第 2 件：0.5 ETH 供闭环挖掘（用另一个地址 0x7099… 作 digger —— 私钥不可得，改用 signer 自己挖）
  const pw2 = toPassword(-31.2305, 121.4738, 42);
  const r2 = await sendTx({ to: dep.address, value: ethers.parseEther("0.5"), data: vault.interface.encodeFunctionData("buryTreasure", [
    [[0n, ethers.ZeroAddress, ethers.parseEther("0.5"), 0n]],
    "谜面：南方的海岛，企鹅的家", "线索：水下 42 米", passwordHash(pw2), deadline]) });
  console.log("A bury 0.5 ETH:", r2.status === 1 ? "ok" : "FAIL", r2.hash);
  // B 探测（读）
  const probe = await vault.connect(signer).probe(pw2);
  console.log("B probe pw2 found:", probe[0], "| wrong pw:", (await vault.connect(signer).probe(toPassword(-31.23, 121.474, 43)))[0]);
  // B 挖掘（signer 自己挖，验证闭环）
  const balBefore = await provider.getBalance(wallet.address);
  const r3 = await sendTx({ to: dep.address, data: vault.interface.encodeFunctionData("dig", [pw2]) });
  const balAfter = await provider.getBalance(wallet.address);
  console.log("B dig:", r3.status === 1 ? "ok" : "FAIL", r3.hash, "| net:", ethers.formatEther(balAfter - balBefore), "ETH");
  const vb = await provider.getBalance(dep.address);
  console.log("vault balance:", ethers.formatEther(vb), "ETH (expect 1.0 for players)");
}
main().catch(e => { console.error(e.message?.slice(0, 300)); process.exit(1); });
