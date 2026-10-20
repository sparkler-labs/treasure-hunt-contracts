// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

/**
 * ═══════════════════════════════════════════════════════════════════
 *  TreasureVault — On-Chain Treasure Hunt
 *
 *  Copyright (c) 2026 Sparkler Labs. All rights reserved.
 *
 *  Website:       https://sparklerlabs.com
 *  Treasure Hunt: https://treasure.sparklerlabs.com
 * ═══════════════════════════════════════════════════════════════════
 *
 * @title TreasureVault
 * @notice The on-chain vault for the Treasure Hunt game. Core mechanics:
 *  1. The password is never bound to a claimer address — anyone who knows
 *     the plaintext password can dig. Deposit and verification both use
 *     keccak256(abi.encodePacked(plaintextPassword)).
 *  2. Only the password hash (bytes32) goes on-chain at burial time; the
 *     plaintext password never appears in the burial transaction. It is
 *     revealed only in dig / probe (dig is the "reveal moment", first come
 *     first served).
 *  3. Players interact with this contract directly, no wrapper layer.
 *     The original timeoutClaim semantics are renamed reclaim.
 *  4. dig/reclaim use call{value} transfers (instead of 2300-gas transfer),
 *     with ReentrancyGuard.
 *  5. The TreasureBuried event carries the riddle and amounts, so the
 *     frontend can render treasure cards straight from events.
 *
 * Game convention: plaintext password = "lat|lng|depth" (e.g. "31.230|121.474|7").
 * Coordinate precision and depth range are frontend conventions (see
 * web/src/lib/password.ts); the contract is format-agnostic.
 * One plaintext password can only hold one treasure (uniqueness constraint).
 */
contract TreasureVault is ERC721Holder, ERC1155Holder, ReentrancyGuard {
    uint8 public constant ETH_TYPE = 0;
    uint8 public constant ERC20_TYPE = 1;
    uint8 public constant ERC721_TYPE = 2;
    uint8 public constant ERC1155_TYPE = 3;

    struct Annex {
        uint8 _type;
        address _address; // ETH_TYPE 时为 address(0)
        uint256 _amount;  // ERC20/ETH 数量，ERC1155 数量；ERC721 时为 0
        uint256 _id;      // ERC721/ERC1155 的 tokenId，其余为 0
    }

    struct Treasure {
        address _sender;
        uint256 _annexCount;   // 附件条数（用于遍历 annex）
        uint256 _ethAmount;    // ETH 附件总金额（事件与卡片展示用）
        uint256 _deadline;     // 到期时间戳：过后无法再挖，仅埋宝人可 reclaim
        string _message;       // 谜面（公开上链）
        string _secretWords;   // 补充线索（公开上链）
        bytes32 _passwordHash; // keccak256(abi.encodePacked(明文密码))
    }

    /// @dev treasureId => Treasure
    mapping(bytes32 => Treasure) private treasures;
    /// @dev keccak256(明文密码) => treasureId
    mapping(bytes32 => bytes32) private passwords;
    /// @dev abi.encodePacked(treasureId, index) => Annex
    mapping(bytes => Annex) private annex;

    event TreasureBuried(
        bytes32 indexed _treasureId,
        address indexed _sender,
        uint256 _ethAmount,
        string _message,
        string _secretWords,
        uint256 _deadline,
        bytes[] _annexKeys,
        uint8[] _annexTypes,
        address[] _annexTokens,
        uint256[] _annexAmounts,
        uint256[] _annexTokenIds
    );
    event TreasureDug(bytes32 indexed _treasureId, address indexed _digger);
    event TreasureReclaimed(bytes32 indexed _treasureId);

    /**
     * @notice 埋宝：存入资产并留下谜面。ETH 埋宝时 msg.value 需 ≥ 所有 ETH 附件之和。
     * @param _annex    附件列表（MVP 前端只传一条 ETH 附件）
     * @param _message  谜面（公开上链，勿包含坐标/深度答案）
     * @param _secretWords 补充线索（公开上链，可为空）
     * @param _passwordHash keccak256(abi.encodePacked(明文密码))，由前端离线计算
     * @param _deadline 到期时间戳，需大于当前时间
     * @return _treasureId 宝藏 id（由埋宝人、密码哈希与出块随机数共同决定）
     */
    function buryTreasure(
        Annex[] memory _annex,
        string memory _message,
        string memory _secretWords,
        bytes32 _passwordHash,
        uint256 _deadline
    ) external payable nonReentrant returns (bytes32 _treasureId) {
        require(_passwordHash != bytes32(0), "Vault: Empty password");
        require(_deadline > block.timestamp, "Vault: Invalid deadline");
        require(passwords[_passwordHash] == bytes32(0), "Vault: Already exists");

        _treasureId = keccak256(
            abi.encodePacked(msg.sender, block.prevrandao, block.timestamp, _passwordHash)
        );

        uint256 __annexCount = _annex.length;
        uint256 __ethAmount = 0;
        bytes[] memory _annexKeys = new bytes[](__annexCount);
        uint8[] memory _annexTypes = new uint8[](__annexCount);
        address[] memory _annexTokens = new address[](__annexCount);
        uint256[] memory _annexAmounts = new uint256[](__annexCount);
        uint256[] memory _annexTokenIds = new uint256[](__annexCount);
        for (uint256 i = 0; i < __annexCount; i++) {
            require(_annex[i]._amount > 0 || _annex[i]._type == ERC721_TYPE, "Vault: Invalid annex amount");
            __ethAmount += _transferAnnexIn(_annex[i]);
            bytes memory _annexId = abi.encodePacked(_treasureId, i);
            annex[_annexId] = _annex[i];
            _annexKeys[i] = _annexId;
            _annexTypes[i] = _annex[i]._type;
            _annexTokens[i] = _annex[i]._address;
            _annexAmounts[i] = _annex[i]._amount;
            _annexTokenIds[i] = _annex[i]._id;
        }
        require(msg.value >= __ethAmount, "Vault: Insufficient ETH");

        treasures[_treasureId] = Treasure({
            _sender: msg.sender,
            _annexCount: __annexCount,
            _ethAmount: __ethAmount,
            _deadline: _deadline,
            _message: _message,
            _secretWords: _secretWords,
            _passwordHash: _passwordHash
        });
        passwords[_passwordHash] = _treasureId;

        emit TreasureBuried(
            _treasureId,
            msg.sender,
            __ethAmount,
            _message,
            _secretWords,
            _deadline,
            _annexKeys,
            _annexTypes,
            _annexTokens,
            _annexAmounts,
            _annexTokenIds
        );
    }

    /**
     * @notice 探测：凭明文密码检测该处是否埋有宝藏（view 调用，不消耗 Gas）。
     * @return _found 是否命中
     * @return _sender 埋宝人
     * @return _message 谜面
     * @return _secretWords 补充线索
     * @return _deadline 到期时间戳（可能已过期，由前端判断）
     * @return _ethAmount ETH 金额
     */
    function probe(string memory _password)
        external
        view
        returns (
            bool _found,
            address _sender,
            string memory _message,
            string memory _secretWords,
            uint256 _deadline,
            uint256 _ethAmount
        )
    {
        bytes32 _treasureId = passwords[keccak256(abi.encodePacked(_password))];
        if (_treasureId == bytes32(0)) {
            return (false, address(0), "", "", 0, 0);
        }
        Treasure memory _treasure = treasures[_treasureId];
        return (
            true,
            _treasure._sender,
            _treasure._message,
            _treasure._secretWords,
            _treasure._deadline,
            _treasure._ethAmount
        );
    }

    /**
     * @notice Read the full treasure with all annexes by plaintext password (miss returns an empty struct instead of reverting).
     */
    function treasureAllParams(string memory _password)
        external
        view
        returns (Treasure memory _treasure, Annex[] memory _annexes)
    {
        bytes32 _treasureId = passwords[keccak256(abi.encodePacked(_password))];
        _treasure = treasures[_treasureId];
        uint256 __annexCount = _treasure._annexCount;
        _annexes = new Annex[](__annexCount);
        for (uint256 i = 0; i < __annexCount; i++) {
            _annexes[i] = annex[abi.encodePacked(_treasureId, i)];
        }
    }

    /**
     * @notice Permissionless public info for a treasure id. Returns all-zero values when not buried.
     */
    function treasurePublicParams(bytes32 _treasureId)
        external
        view
        returns (
            address _sender,
            string memory _message,
            string memory _secretWords,
            uint256 _deadline,
            uint256 _ethAmount
        )
    {
        Treasure memory _treasure = treasures[_treasureId];
        return (_treasure._sender, _treasure._message, _treasure._secretWords, _treasure._deadline, _treasure._ethAmount);
    }

    /**
     * @notice 挖掘：凭明文密码取走宝藏全部资产，先到先得。
     * 明文密码会出现在本笔交易中，即"揭晓时刻"；此后该密码对应的宝藏已被挖走。
     */
    function dig(string memory _password) external nonReentrant {
        bytes32 _passwordHash = keccak256(abi.encodePacked(_password));
        bytes32 _treasureId = passwords[_passwordHash];
        require(_treasureId != bytes32(0), "Vault: Nothing here");
        Treasure memory _treasure = treasures[_treasureId];
        require(_treasure._deadline > block.timestamp, "Vault: Expired");

        // CEI：先清状态，再转出资产（nonReentrant 防重入）
        delete passwords[_passwordHash];
        delete treasures[_treasureId];
        _payout(_treasureId, _treasure._annexCount);

        emit TreasureDug(_treasureId, msg.sender);
    }

    /**
     * @notice 回收：到期后埋宝人取回未被挖走的宝藏。
     */
    function reclaim(bytes32 _treasureId) external nonReentrant {
        Treasure memory _treasure = treasures[_treasureId];
        require(_treasure._sender == msg.sender, "Vault: Not the burier");
        require(_treasure._deadline <= block.timestamp, "Vault: Not expired");

        delete treasures[_treasureId];
        delete passwords[_treasure._passwordHash];
        _payout(_treasureId, _treasure._annexCount);

        emit TreasureReclaimed(_treasureId);
    }

    /**
     * @dev 校验并把单个附件从 msg.sender 转入合约；ETH 类型返回其金额（其余类型返回 0）。
     */
    function _transferAnnexIn(Annex memory _a) private returns (uint256 _ethAmount) {
        if (_a._type == ETH_TYPE) {
            require(_a._address == address(0) && _a._id == 0, "Vault: Invalid ETH annex");
            return _a._amount;
        }
        if (_a._type == ERC20_TYPE) {
            IERC20(_a._address).transferFrom(msg.sender, address(this), _a._amount);
        } else if (_a._type == ERC721_TYPE) {
            IERC721(_a._address).transferFrom(msg.sender, address(this), _a._id);
        } else if (_a._type == ERC1155_TYPE) {
            IERC1155(_a._address).safeTransferFrom(msg.sender, address(this), _a._id, _a._amount, "");
        } else {
            revert("Vault: Invalid annex type");
        }
        return 0;
    }

    /**
     * @dev 将宝藏全部附件转给 msg.sender。调用方需已完成状态清理。
     */
    function _payout(bytes32 _treasureId, uint256 _annexCount) private {
        for (uint256 i = 0; i < _annexCount; i++) {
            bytes memory _annexId = abi.encodePacked(_treasureId, i);
            Annex memory _a = annex[_annexId];
            if (_a._type == ETH_TYPE) {
                (bool _ok, ) = payable(msg.sender).call{value: _a._amount}("");
                require(_ok, "Vault: ETH transfer failed");
            } else if (_a._type == ERC20_TYPE) {
                IERC20(_a._address).transfer(msg.sender, _a._amount);
            } else if (_a._type == ERC721_TYPE) {
                IERC721(_a._address).transferFrom(address(this), msg.sender, _a._id);
            } else if (_a._type == ERC1155_TYPE) {
                IERC1155(_a._address).safeTransferFrom(address(this), msg.sender, _a._id, _a._amount, "");
            }
            delete annex[_annexId];
        }
    }

    /// @dev 拒绝直接转账，防止误操作导致资产无主；存入请走 buryTreasure。
    receive() external payable {
        revert("Vault: Use buryTreasure");
    }
}
