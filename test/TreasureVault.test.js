const { expect } = require("chai");
require("@nomicfoundation/hardhat-chai-matchers");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ===== 前端 web/src/lib/password.ts 的镜像实现 =====
// 用于验证 JS 侧密码格式化/哈希与合约 keccak256(abi.encodePacked(string)) 一致
const COORD_DECIMALS = 3;
const ZERO_FMT = (0).toFixed(COORD_DECIMALS);
function formatCoord(v) {
  const s = v.toFixed(COORD_DECIMALS);
  return s === "-" + ZERO_FMT ? ZERO_FMT : s;
}
function toPassword(lat, lng, depth) {
  return `${formatCoord(lat)}|${formatCoord(lng)}|${depth}`;
}
const passwordHash = (pw) => ethers.keccak256(ethers.toUtf8Bytes(pw));

const DAY = 24 * 60 * 60;
const GAS_MARGIN = ethers.parseEther("0.01");
const ethAnnex = (amountWei) => [[0n, ethers.ZeroAddress, amountWei, 0n]];
const erc20Annex = (token, amount) => [[1n, token, amount, 0n]];

describe("TreasureVault", function () {
  async function deployFixture() {
    const [burier, digger, other] = await ethers.getSigners();
    const vault = await (await ethers.getContractFactory("TreasureVault")).deploy();
    const mock = await (await ethers.getContractFactory("MockERC20")).deploy();
    return { vault, mock, burier, digger, other };
  }

  // 埋一件位于 (31.2304, 121.4737) 深度 7 的 1 ETH 宝藏
  async function buryFixture() {
    const f = await deployFixture();
    f.password = toPassword(31.2304, 121.4737, 7); // "31.230|121.474|7"
    f.hash = passwordHash(f.password);
    f.deadline = (await time.latest()) + 30 * DAY;
    f.amount = ethers.parseEther("1");
    const tx = await f.vault
      .connect(f.burier)
      .buryTreasure(ethAnnex(f.amount), "谜面：东方明珠脚下", "线索：朝江的方向", f.hash, f.deadline, {
        value: f.amount,
      });
    const receipt = await tx.wait();
    f.receipt = receipt;
    f.id = receipt.logs[0].args[0];
    return f;
  }

  describe("埋宝 buryTreasure", function () {
    it("埋入 ETH 并发出 TreasureBuried 事件", async function () {
      const { vault, receipt, burier, amount, deadline } = await buryFixture();
      const ev = vault.interface.parseLog(receipt.logs[0]);
      expect(ev.name).to.equal("TreasureBuried");
      expect(ev.args._sender).to.equal(burier.address);
      expect(ev.args._ethAmount).to.equal(amount);
      expect(ev.args._message).to.equal("谜面：东方明珠脚下");
      expect(ev.args._secretWords).to.equal("线索：朝江的方向");
      expect(ev.args._deadline).to.equal(deadline);
      expect(ev.args._annexKeys.length).to.equal(1);
    });

    it("treasurePublicParams 可读公开信息", async function () {
      const { vault, id, burier, amount, deadline } = await buryFixture();
      const [sender, message, secretWords, d, ethAmount] = await vault.treasurePublicParams(id);
      expect(sender).to.equal(burier.address);
      expect(message).to.equal("谜面：东方明珠脚下");
      expect(secretWords).to.equal("线索：朝江的方向");
      expect(d).to.equal(deadline);
      expect(ethAmount).to.equal(amount);
    });

    it("同一明文密码只能埋一件（不同人也一样）", async function () {
      const { vault, digger, hash, deadline, amount } = await buryFixture();
      await expect(
        vault.connect(digger).buryTreasure(ethAnnex(amount), "x", "", hash, deadline, { value: amount })
      ).to.be.revertedWith("Vault: Already exists");
    });

    it("ETH 不足时拒绝埋宝", async function () {
      const { vault, burier } = await deployFixture();
      const deadline = (await time.latest()) + DAY;
      await expect(
        vault
          .connect(burier)
          .buryTreasure(ethAnnex(ethers.parseEther("1")), "m", "", passwordHash("1.000|2.000|1"), deadline, {
            value: ethers.parseEther("0.9"),
          })
      ).to.be.revertedWith("Vault: Insufficient ETH");
    });

    it("拒绝空密码哈希与过期 deadline", async function () {
      const { vault, burier } = await deployFixture();
      const deadline = (await time.latest()) + DAY;
      const past = (await time.latest()) - 1;
      await expect(
        vault.connect(burier).buryTreasure(ethAnnex(1n), "m", "", ethers.ZeroHash, deadline, { value: 1n })
      ).to.be.revertedWith("Vault: Empty password");
      await expect(
        vault.connect(burier).buryTreasure(ethAnnex(1n), "m", "", passwordHash("1.000|2.000|1"), past, { value: 1n })
      ).to.be.revertedWith("Vault: Invalid deadline");
    });

    it("拒绝直接转账（receive revert）", async function () {
      const { vault, burier } = await deployFixture();
      await expect(burier.sendTransaction({ to: await vault.getAddress(), value: 1n })).to.be.revertedWith(
        "Vault: Use buryTreasure"
      );
    });
  });

  describe("探测 probe", function () {
    it("错误密码：found=false（任何人查询）", async function () {
      const { vault, digger } = await buryFixture();
      const r = await vault.connect(digger).probe(toPassword(31.2304, 121.4737, 8)); // 深度不对
      expect(r._found).to.equal(false);
      expect(r._sender).to.equal(ethers.ZeroAddress);
    });

    it("正确密码：found=true，且与查询人地址无关（验证已去除领取人绑定）", async function () {
      const { vault, digger, other, amount, deadline } = await buryFixture();
      for (const who of [digger, other]) {
        const r = await vault.connect(who).probe(toPassword(31.2304, 121.4737, 7));
        expect(r._found).to.equal(true);
        expect(r._message).to.equal("谜面：东方明珠脚下");
        expect(r._deadline).to.equal(deadline);
        expect(r._ethAmount).to.equal(amount);
      }
    });
  });

  describe("挖掘 dig", function () {
    it("错误密码：revert Nothing here", async function () {
      const { vault, digger } = await buryFixture();
      await expect(vault.connect(digger).dig(toPassword(31.2304, 121.4737, 8))).to.be.revertedWith(
        "Vault: Nothing here"
      );
    });

    it("任意第三方凭正确密码挖走 ETH（先到先得）", async function () {
      const { vault, digger, amount } = await buryFixture();
      const before = await ethers.provider.getBalance(digger.address);
      const tx = await vault.connect(digger).dig(toPassword(31.2304, 121.4737, 7));
      await expect(tx).to.emit(vault, "TreasureDug");
      const after = await ethers.provider.getBalance(digger.address);
      expect(after > before + amount - GAS_MARGIN).to.equal(true);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
    });

    it("挖走后宝藏清空：再挖 revert，密码位释放可重新埋", async function () {
      const { vault, digger, burier, amount, deadline } = await buryFixture();
      await vault.connect(digger).dig(toPassword(31.2304, 121.4737, 7));
      await expect(vault.connect(digger).dig(toPassword(31.2304, 121.4737, 7))).to.be.revertedWith(
        "Vault: Nothing here"
      );
      await expect(
        vault
          .connect(burier)
          .buryTreasure(ethAnnex(amount), "again", "", passwordHash(toPassword(31.2304, 121.4737, 7)), deadline, {
            value: amount,
          })
      ).to.not.be.reverted;
    });

    it("密码格式敏感：31.2300 ≠ 31.230（不同格式即不同密码）", async function () {
      const { vault, digger } = await buryFixture(); // 埋的是 "31.230|121.474|7"
      await expect(vault.connect(digger).dig("31.2300|121.4740|7")).to.be.revertedWith("Vault: Nothing here");
    });

    it("JS 密码格式化 ↔ 合约哈希 一致性（含负零边界）", async function () {
      expect(toPassword(31.2304, 121.4737, 7)).to.equal("31.230|121.474|7");
      expect(toPassword(-0.00001, -121.47371, 99)).to.equal("0.000|-121.474|99"); // 负零归一化
      expect(toPassword(-31.2304, 121.4737, 1)).to.equal("-31.230|121.474|1");
      const { vault, digger } = await buryFixture();
      await expect(vault.connect(digger).dig(toPassword(31.2304, 121.4737, 7))).to.not.be.reverted;
    });

    it("到期后无法再挖", async function () {
      const { vault, digger, deadline } = await buryFixture();
      await time.setNextBlockTimestamp(deadline + 1);
      await expect(vault.connect(digger).dig(toPassword(31.2304, 121.4737, 7))).to.be.revertedWith("Vault: Expired");
    });
  });

  describe("回收 reclaim", function () {
    it("非埋宝人回收 revert；到期前埋宝人也不能回收", async function () {
      const { vault, digger, burier, id } = await buryFixture();
      await expect(vault.connect(digger).reclaim(id)).to.be.revertedWith("Vault: Not the burier");
      await expect(vault.connect(burier).reclaim(id)).to.be.revertedWith("Vault: Not expired");
    });

    it("到期后埋宝人取回 ETH，密码位释放", async function () {
      const { vault, burier, digger, id, amount, deadline, hash, password } = await buryFixture();
      await time.setNextBlockTimestamp(deadline + 1);
      const before = await ethers.provider.getBalance(burier.address);
      await expect(vault.connect(burier).reclaim(id)).to.emit(vault, "TreasureReclaimed");
      const after = await ethers.provider.getBalance(burier.address);
      expect(after > before + amount - GAS_MARGIN).to.equal(true);
      await expect(vault.connect(digger).dig(password)).to.be.revertedWith("Vault: Nothing here");
      const deadline2 = (await time.latest()) + 30 * DAY;
      await expect(
        vault.connect(burier).buryTreasure(ethAnnex(amount), "re-bury", "", hash, deadline2, { value: amount })
      ).to.not.be.reverted;
    });
  });

  describe("多附件与 ERC20", function () {
    it("多条 ETH 附件：dig 转出合计金额", async function () {
      const { vault, burier, digger } = await deployFixture();
      const a = ethers.parseEther("0.4");
      const b = ethers.parseEther("0.6");
      const deadline = (await time.latest()) + DAY;
      await vault
        .connect(burier)
        .buryTreasure(
          [
            [0n, ethers.ZeroAddress, a, 0n],
            [0n, ethers.ZeroAddress, b, 0n],
          ],
          "m",
          "",
          passwordHash(toPassword(1.001, 2.002, 3)),
          deadline,
          { value: a + b }
        );
      const before = await ethers.provider.getBalance(digger.address);
      await vault.connect(digger).dig(toPassword(1.001, 2.002, 3));
      const after = await ethers.provider.getBalance(digger.address);
      expect(after > before + a + b - GAS_MARGIN).to.equal(true);
    });

    it("ERC20 附件：approve 后埋入，挖出时转给挖掘者", async function () {
      const { vault, mock, burier, digger } = await deployFixture();
      const amt = ethers.parseEther("77");
      await mock.connect(burier).approve(await vault.getAddress(), amt);
      const deadline = (await time.latest()) + DAY;
      await vault
        .connect(burier)
        .buryTreasure(erc20Annex(await mock.getAddress(), amt), "token treasure", "", passwordHash(toPassword(-5.5, 6.6, 8)), deadline);
      expect(await mock.balanceOf(await vault.getAddress())).to.equal(amt);
      await vault.connect(digger).dig(toPassword(-5.5, 6.6, 8));
      expect(await mock.balanceOf(digger.address)).to.equal(amt);
    });

    it("事件携带附件明细（types/tokens/amounts/tokenIds）", async function () {
      const { vault, mock, burier } = await deployFixture();
      const eth = ethers.parseEther("0.1");
      const tokens = ethers.parseEther("5");
      await mock.connect(burier).approve(await vault.getAddress(), tokens);
      const deadline = (await time.latest()) + DAY;
      const annex = [
        [0n, ethers.ZeroAddress, eth, 0n],
        [1n, await mock.getAddress(), tokens, 0n],
      ];
      const tx = await vault.connect(burier).buryTreasure(annex, "mix", "", passwordHash(toPassword(9.9, 8.8, 7)), deadline, { value: eth });
      const receipt = await tx.wait();
      const ev = receipt.logs.map((l) => vault.interface.parseLog(l)).find((p) => p && p.name === "TreasureBuried");
      expect(ev.args._annexTypes).to.deep.equal([0n, 1n]);
      expect(ev.args._annexTokens).to.deep.equal([ethers.ZeroAddress, await mock.getAddress()]);
      expect(ev.args._annexAmounts).to.deep.equal([eth, tokens]);
      expect(ev.args._annexTokenIds).to.deep.equal([0n, 0n]);
    });
  });

  describe("ERC721 / ERC1155 NFT", function () {
    it("ERC721：NFT 埋入 → 事件明细 tokenId → 挖出后归属挖掘者", async function () {
      const { vault, mock, burier, digger } = await deployFixture();
      const nft = await (await ethers.getContractFactory("MockERC721")).connect(burier).deploy();
      await nft.waitForDeployment();
      const tokenId = await nft.tokenOfOwnerByIndex(burier.address, 0);
      await nft.connect(burier).approve(await vault.getAddress(), tokenId);
      const deadline = (await time.latest()) + DAY;
      const tx = await vault
        .connect(burier)
        .buryTreasure([[2n, await nft.getAddress(), 0n, tokenId]], "NFT treasure", "", passwordHash(toPassword(7.7, 6.6, 5)), deadline);
      const receipt = await tx.wait();
      const ev = receipt.logs.map((l) => vault.interface.parseLog(l)).find((p) => p && p.name === "TreasureBuried");
      expect(ev.args._annexTypes).to.deep.equal([2n]);
      expect(ev.args._annexTokenIds).to.deep.equal([tokenId]);
      expect(await nft.ownerOf(tokenId)).to.equal(await vault.getAddress());
      await vault.connect(digger).dig(toPassword(7.7, 6.6, 5));
      expect(await nft.ownerOf(tokenId)).to.equal(digger.address);
    });

    it("ERC1155：数量型 NFT 埋入与挖出", async function () {
      const { vault, burier, digger } = await deployFixture();
      const nft = await (await ethers.getContractFactory("MockERC1155")).connect(burier).deploy();
      await nft.waitForDeployment();
      const id = 1n;
      const amt = 10n;
      await nft.connect(burier).setApprovalForAll(await vault.getAddress(), true);
      const deadline = (await time.latest()) + DAY;
      await vault
        .connect(burier)
        .buryTreasure([[3n, await nft.getAddress(), amt, id]], "semi-fungible", "", passwordHash(toPassword(4.4, 3.3, 2)), deadline);
      expect(await nft.balanceOf(await vault.getAddress(), id)).to.equal(amt);
      await vault.connect(digger).dig(toPassword(4.4, 3.3, 2));
      expect(await nft.balanceOf(digger.address, id)).to.equal(amt);
    });

    it("组合宝藏：ETH + ERC20 + ERC721 一次挖走", async function () {
      const { vault, mock, burier, digger } = await deployFixture();
      const nft = await (await ethers.getContractFactory("MockERC721")).connect(burier).deploy();
      await nft.waitForDeployment();
      const tokenId = await nft.tokenOfOwnerByIndex(burier.address, 0);
      const eth = ethers.parseEther("0.3");
      const tokens = ethers.parseEther("12");
      await mock.connect(burier).approve(await vault.getAddress(), tokens);
      await nft.connect(burier).approve(await vault.getAddress(), tokenId);
      const deadline = (await time.latest()) + DAY;
      await vault.connect(burier).buryTreasure(
        [
          [0n, ethers.ZeroAddress, eth, 0n],
          [1n, await mock.getAddress(), tokens, 0n],
          [2n, await nft.getAddress(), 0n, tokenId],
        ],
        "grand treasure",
        "",
        passwordHash(toPassword(2.2, 1.1, 9)),
        deadline,
        { value: eth }
      );
      const ethBefore = await ethers.provider.getBalance(digger.address);
      await vault.connect(digger).dig(toPassword(2.2, 1.1, 9));
      expect((await ethers.provider.getBalance(digger.address)) > ethBefore + eth - GAS_MARGIN).to.equal(true);
      expect(await mock.balanceOf(digger.address)).to.equal(tokens);
      expect(await nft.ownerOf(tokenId)).to.equal(digger.address);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
    });
  });
});
