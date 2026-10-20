// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev 仅测试用：验证 TreasureVault 的 ERC20 附件通道
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Gold", "MGLD") {
        _mint(msg.sender, 1_000_000 ether);
    }
}
