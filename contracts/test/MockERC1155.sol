// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/// @dev 仅测试用：给部署者铸造若干 ERC1155，验证 TreasureVault 的 ERC1155 附件通道
contract MockERC1155 is ERC1155 {
    constructor() ERC1155("") {
        _mint(msg.sender, 1, 100, "");
        _mint(msg.sender, 2, 100, "");
    }
}
