// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @dev 仅测试用：铸 3 枚 NFT 给部署者，验证 TreasureVault 的 ERC721 附件通道
contract MockERC721 is ERC721 {
    uint256 private _nextId = 1;

    constructor() ERC721("Mock Artifact", "MART") {
        for (uint256 i = 0; i < 3; i++) {
            _mint(msg.sender, _nextId);
            _nextId++;
        }
    }

    function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256) {
        uint256 seen = 0;
        for (uint256 id = 1; id < _nextId; id++) {
            if (ownerOf(id) == owner) {
                if (seen == index) return id;
                seen++;
            }
        }
        revert("NotFound");
    }
}
