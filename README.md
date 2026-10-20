# Treasure Hunt Contracts

On-chain smart contracts for [Treasure Hunt](https://treasure.sparklerlabs.com) — a real-world treasure hunt game where anyone can bury crypto treasures at real-world coordinates, and anyone who works out the location can dig them up.

Built by [Sparkler Labs](https://sparklerlabs.com). Licensed under MIT.

## How it works

`TreasureVault` is a single contract holding all treasures. Core mechanics:

- **Password = location.** The plaintext password follows the convention `lat|lng|depth` (e.g. `31.230|121.474|7`), but the contract is format-agnostic. Only `keccak256(abi.encodePacked(plaintext))` goes on-chain at burial time — the plaintext never appears in any transaction.
- **First come, first served.** Anyone who knows the plaintext password can `dig`. The dig transaction reveals the plaintext; whoever submits it first claims the treasure. `probe` checks a guess without revealing it.
- **Multi-asset annex.** A treasure carries an ETH amount plus optional ERC20 / ERC721 / ERC1155 attachments, and a riddle message rendered by the frontend straight from the `TreasureBuried` event.
- **Reclaim.** If no one digs before the deadline, the burier can `reclaim` the treasure.

`TreasureVault` is forked from PostOffice's `Vault.sol` with the timeout-claim semantics renamed to `reclaim`, `call{value}` transfers and a `ReentrancyGuard`.

## Getting started

```bash
npm install
npx hardhat compile
npx hardhat test
```

## Deployed addresses

| Network   | Chain ID | TreasureVault                              |
| --------- | -------- | ------------------------------------------ |
| Sepolia   | 11155111 | `0xD2fB98Cf44472b8BD252E337884470A26C6F625d` |
| Robinhood Chain | 4663 | `0x7B3a06F94F0080B453CE32038824e6561628F386` |
| BSC       | 56       | `0x8E50935F047991667D3d272C437B8BC39f8900B6` |
| Arbitrum One | 42161 | `0xFEfda7665D72b2A987E9E49fD00906E9E077f7FD` |

Per-network details (deploy block, ABI) live in [`deployments/`](deployments/).

## Scripts

| Script | Purpose |
| ------ | ------- |
| `scripts/deploy.js` | Deploy `TreasureVault` and record `{address, ABI, deploy block}` under `deployments/` |
| `scripts/bury.js` | CLI tool to bury a treasure (`BURY_ARGS="lat,lng,depth,ethAmount"`) |
| `scripts/e2e.js` | Full game loop end-to-end on a local node (incl. ERC20/ERC721 annexes) |
| `scripts/sepolia-e2e.js` | End-to-end flow on Sepolia |
| `scripts/seed_demo.js` | Seed a local dev chain with demo treasures |
| `scripts/dump_treasures.js` | Export all `TreasureBuried` events from the local chain as JSON |
| `scripts/verify-sourcify.js` | Verify a deployment via the Sourcify v2 API (no API key needed) |

## Deployment & verification

Copy `.env.example` to `.env` and fill in a deployer `PRIVATE_KEY` (and RPC URLs / explorer API keys as needed — public defaults are used when left blank).

```bash
npm run deploy:sepolia    # or deploy:robinhood / deploy:bsc / deploy:arbitrum / deploy:optimism
```

Source verification uses `hardhat-verify` with the Etherscan V2 API (one key works across the Etherscan family), Blockscout for Robinhood Chain (no key needed), and the Sourcify script above. A pre-built `verification/standard-json-input.json` is included for manual verification.

## License

[MIT](LICENSE)
