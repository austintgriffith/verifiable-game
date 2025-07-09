# 🎮 GMAE - Game Master Automated Ethereum

<h4 align="center">
  A Smart Contract game with a Verifiable Backend
</h4>

A Smart Contract game with a Verifiable Backend where players compete in procedurally generated worlds, mine resources, and compete for ETH prizes. Built on Ethereum with provably fair randomness and cryptographic verification of all game actions.

⚙️ Built using **Scaffold-ETH 2**: NextJS, RainbowKit, Hardhat, Wagmi, Viem, and TypeScript.

## 🌟 Features

- 🗺️ **Verifiable Map Generation**: Complete map revealed at game end, deterministically generated from the on-chain random hash - players can verify the entire world was fair
- 🏆 **Stake-based Competition**: Players stake ETH to join games and compete for the prize pool
- 🎮 **Real-time Gameplay**: Move, mine, and compete in a responsive 3x3 grid interface
- 🔐 **Cryptographic Authentication**: Secure player authentication via wallet signatures
- 📱 **Mobile-friendly UI**: Responsive design with QR code sharing for easy access
- 🎊 **Automated Payouts**: Smart contract handles prize distribution with 1% gamemaster fee
- ⏰ **Timeout Protection**: Players can withdraw stakes if gamemaster abandons the game
- 🗺️ **Radar System**: Real-time minimap showing explored territories
- ✅ **Full Transparency**: After each round, the complete map is displayed with verification that all tiles match the deterministic generation

## 🎮 How to Play

### For Players

1. **Join a Game**: Connect your wallet and stake the required ETH to join an open game
2. **Wait for Start**: Games begin when the creator closes them (or after 2.5min timeout)
3. **Sign In**: Authenticate with your wallet to access the game interface
4. **Explore & Mine**:
   - Move around the 3x3 grid by clicking adjacent tiles
   - Mine resources at your current position (limited mines per player)
   - Collect points: Common (1pt), Uncommon (5pts), Rare (10pts), Treasure (special)
5. **Compete**: Race against other players within the time limit to maximize your score
6. **Win Prizes**: Top scorers share 99% of the prize pool equally

### For Game Creators

1. **Create Game**: Set gamemaster address and stake amount
2. **Commit Randomness**: Gamemaster commits a hash for provable fairness
3. **Open Game**: Players can join after hash commitment
4. **Start Game**: Close the game to begin the competition
5. **Payout Winners**: Gamemaster distributes prizes to top scorers

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/en/download/) (>= v20.18.3)
- [Yarn](https://classic.yarnpkg.com/en/docs/install/) (v1 or v2+)
- [Git](https://git-scm.com/downloads)

### Installation

1. **Clone the repository**:

```bash
git clone <your-repo-url>
cd gmae-dapp
```

2. **Install dependencies**:

```bash
yarn install
```

3. **Start local blockchain**:

```bash
yarn chain
```

4. **Deploy contracts**:

```bash
yarn deploy
```

5. **Start frontend**:

```bash
yarn start
```

6. **Visit the app**: `http://localhost:3000`

### Testing

Run the smart contract tests:

```bash
yarn hardhat:test
```

## 🏗️ Architecture

### Smart Contract (`YourContract.sol`)

The core game logic is handled by a Solidity contract that manages:

- **Game Creation**: Anyone can create games with custom stake amounts
- **Player Management**: Join games by staking ETH, track player states
- **Commit-Reveal Randomness**: Provably fair map generation using blockhash + reveal
- **Payout System**: Automated prize distribution to winners
- **Timeout Protection**: Players can withdraw if gamemaster abandons

Key functions:

- `createGame(gamemaster, stakeAmount)` - Create new game
- `joinGame(gameId)` - Join game with ETH stake
- `commitHash(gameId, hash)` - Gamemaster commits random hash
- `revealHash(gameId, reveal)` - Reveal for map generation
- `closeGame(gameId)` - Start the game
- `payout(gameId, winners)` - Distribute prizes

### Frontend (`packages/nextjs/`)

React-based game interface featuring:

- **Game Discovery**: Browse and join available games
- **Real-time Interface**: WebSocket-like polling for game state
- **Interactive Map**: 3x3 grid with movement and mining
- **Radar System**: Minimap showing explored areas
- **Wallet Integration**: RainbowKit for wallet connections
- **QR Code Sharing**: Easy game sharing via QR codes
- **Map Verification Display**: Post-game complete map visualization with tile-by-tile verification against explored areas

Key pages:

- `/` - Game browser and creation
- `/game/[gameId]` - Individual game interface
- `/debug` - Contract interaction tools

### Backend API

External gamemaster server (not included in this repo) handles:

- **Game State Management**: Track player positions, scores, moves
- **Real-time Updates**: Game timer, player actions, map state
- **Authentication**: JWT tokens from wallet signatures
- **Map Logic**: Procedural generation using contract randomness

API endpoints:

- `GET /status?gameId=X` - Game status and timer
- `GET /players?gameId=X` - Player leaderboard
- `GET /map?gameId=X` - Player's map view
- `POST /move` - Player movement
- `POST /mine` - Resource mining
- `POST /register` - Player authentication

## 🎯 Game Mechanics

### Map Generation & Verification

1. **Commit Phase**: Gamemaster commits `keccak256(secret)` to contract
2. **Reveal Phase**: After game closes, gamemaster reveals `secret`
3. **Randomness**: `randomHash = keccak256(blockhash + secret)` ensures fairness
4. **Map Size**: `mapSize = 1 + (4 × playerCount)` for scalable difficulty
5. **Procedural Generation**: Deterministic map creation using `randomHash`
6. **Post-Game Verification**: Complete map displayed to all players with tile-by-tile verification
7. **Transparency**: Players can verify their explored tiles match the deterministically generated map, proving no cheating occurred

### Resource Types

- **Common (1)**: 1 point, blue tiles
- **Uncommon (2)**: 5 points, green tiles
- **Rare (3)**: 10 points, orange tiles
- **Treasure (X)**: Special scoring, gold tiles
- **Depleted (0)**: No points, gray tiles

### Player Limits

- **Moves**: Start with limited movement actions
- **Mines**: Limited mining actions per player
- **Time**: Games have countdown timers for urgency

### Prize Distribution

- **Prize Pool**: Sum of all player stakes
- **Gamemaster Fee**: 1% to gamemaster for running the game
- **Winner Split**: 99% split equally among top scorers
- **Timeout Protection**: Players can withdraw stakes if no payout

## 🔧 Development

### Contract Development

Edit smart contracts in `packages/hardhat/contracts/`:

- `YourContract.sol` - Main game contract
- Deploy scripts in `packages/hardhat/deploy/`

### Frontend Development

Key files in `packages/nextjs/`:

- `app/page.tsx` - Game browser homepage
- `app/game/[gameId]/page.tsx` - Main game interface
- `components/scaffold-eth/` - Reusable Web3 components
- `hooks/scaffold-eth/` - Contract interaction hooks

### Configuration

- `packages/nextjs/scaffold.config.ts` - App configuration
- `packages/hardhat/hardhat.config.ts` - Blockchain configuration

## 🌐 Deployment

### Smart Contract

Deploy to live networks:

```bash
yarn deploy --network sepolia
```

### Frontend

Deploy to Vercel:

```bash
yarn vercel
```

Or IPFS:

```bash
yarn ipfs
```

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Scaffold-ETH 2](https://scaffoldeth.io)
- Uses [deterministic-map](https://www.npmjs.com/package/deterministic-map) for procedural generation
- Powered by Ethereum and Web3 technologies

---

<p align="center">
  <i>⚡ Powered by Ethereum • Built with Scaffold-ETH 2 • Made with ❤️</i>
</p>
