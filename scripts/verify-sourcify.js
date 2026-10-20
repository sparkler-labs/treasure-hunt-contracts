/**
 * 用 Sourcify v2 API 验证已部署合约（免 API key）。
 *
 * 为什么不用 `hardhat verify` 的 Sourcify 子任务：hardhat-verify 2.x 仍在打
 * Sourcify 已下线的 v1 路由（/check-all-by-addresses 等），而支持 v2 的 3.x
 * 需要 Hardhat 3；本项目是 Hardhat 2。Etherscan V2 端点（api.etherscan.io）
 * 在部分网络下不可达，Sourcify 是不依赖 API key 的替代验证路径。
 *
 * 用法：
 *   npm run verify:sourcify -- <chainId> <address> [creationTxHash]
 * 例：
 *   npm run verify:sourcify -- 56 0x8E50935F047991667D3d272C437B8BC39f8900B6 0xb74c...
 */
const fs = require("fs");
const path = require("path");

const API = process.env.SOURCIFY_API_URL || "https://sourcify.dev/server";
const CONTRACT_IDENTIFIER = process.env.CONTRACT_IDENTIFIER || "contracts/TreasureVault.sol:TreasureVault";
const SOURCE_NAME_MARKER = "contracts/TreasureVault.sol";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const root = path.join(__dirname, "..");

/** 递归排序键后序列化，用于比较两份编译输入是否同一份（数组顺序保持不变） */
function stableStringify(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(stableStringify));
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 编译输入：优先用 verification/ 下为人工验证准备的同一份，保证与链上字节码同源 */
function loadStdJsonInput() {
  const p = path.join(root, "verification", "standard-json-input.json");
  if (!fs.existsSync(p)) {
    throw new Error(`缺少 ${p}（应由 hardhat 编译产物导出）`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** solc 版本：从 build-info 里找输入与之完全一致的那次编译；找不到再退回 artifact 元数据 */
function loadCompilerVersion(stdJsonInput) {
  const dir = path.join(root, "artifacts", "build-info");
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      const info = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      if (info.input && stableStringify(info.input) === stableStringify(stdJsonInput)) {
        return { version: info.solcLongVersion, from: `build-info/${file}` };
      }
    }
  }
  const artifactPath = path.join(root, "artifacts", "contracts", "TreasureVault.sol", "TreasureVault.json");
  const metadata = JSON.parse(JSON.parse(fs.readFileSync(artifactPath, "utf8")).metadata);
  return { version: metadata.compiler.version, from: "artifact metadata" };
}

async function submit(chainId, address, body) {
  const url = `${API}/v2/verify/${chainId}/${address}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status !== 202) {
    throw new Error(`提交失败 HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json.verificationId;
}

async function poll(verificationId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${API}/v2/verify/${verificationId}`);
    const json = await res.json();
    if (json.isJobCompleted) return json;
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("等待验证结果超时");
}

async function main() {
  const [chainId, address, creationTxHash] = process.argv.slice(2);
  if (!chainId || !address) {
    console.error("用法: npm run verify:sourcify -- <chainId> <address> [creationTxHash]");
    process.exit(1);
  }

  const stdJsonInput = loadStdJsonInput();
  const { version, from } = loadCompilerVersion(stdJsonInput);
  console.log(`Sourcify 验证 ${CONTRACT_IDENTIFIER}`);
  console.log(`chainId=${chainId} address=${address}`);
  console.log(`solc=${version}（取自 ${from}）`);

  const body = { stdJsonInput, compilerVersion: version, contractIdentifier: CONTRACT_IDENTIFIER };
  if (creationTxHash) body.creationTransactionHash = creationTxHash;

  const verificationId = await submit(chainId, address, body);
  console.log(`已提交，verificationId=${verificationId}，等待结果`);
  const result = await poll(verificationId);
  console.log("");

  if (result.error) {
    console.error(`验证失败: ${JSON.stringify(result.error)}`);
    process.exit(1);
  }
  const match = result.contract?.match;
  console.log(`match: ${match}`);
  if (match === "exact_match") {
    console.log(`✅ 验证通过: https://repo.sourcify.dev/contracts/full_match/${chainId}/${address}/`);
  } else if (match === "match") {
    console.log(`✅ 验证通过（部分匹配）: https://repo.sourcify.dev/contracts/partial_match/${chainId}/${address}/`);
  } else {
    console.error("❌ 未匹配，检查编译输入/合约标识是否与链上字节码一致");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
