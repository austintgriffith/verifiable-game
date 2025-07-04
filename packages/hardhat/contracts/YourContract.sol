//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

// Useful for debugging. Remove when deploying to a live network.
import "hardhat/console.sol";

/**
 * A smart contract that implements a commit-reveal system for generating randomness
 * Supports multiple games with different gamemasters and stake amounts
 * Players can join games by staking the required amount when the game is open
 * @author BuidlGuidl
 */
contract YourContract {
    // Game struct to hold all game-specific data
    struct Game {
        address gamemaster;
        uint256 stakeAmount;
        bool open;
        address[] players;
        mapping(address => bool) hasJoined;
        
        // Immutability flags
        bool hasOpened;
        bool hasClosed;
        
        // Commit-Reveal System State Variables
        bytes32 committedHash;
        uint256 commitBlockNumber;
        bytes32 revealValue;
        bytes32 randomHash;
        bool hasCommitted;
        bool hasRevealed;
        
        // Payout System State Variables
        address[] winners;
        uint256 payoutAmount;
        bool hasPaidOut;
    }
    
    // Global state variables
    uint256 public nextGameId = 1;
    mapping(uint256 => Game) public games;
    
    // Events
    event GameCreated(uint256 indexed gameId, address indexed gamemaster, uint256 stakeAmount);
    event HashCommitted(uint256 indexed gameId, bytes32 indexed committedHash, uint256 nextBlockNumber);
    event HashRevealed(uint256 indexed gameId, bytes32 indexed reveal, bytes32 indexed randomHash);
    event GameOpened(uint256 indexed gameId);
    event GameClosed(uint256 indexed gameId);
    event PlayerJoined(uint256 indexed gameId, address indexed player);
    event PayoutCompleted(uint256 indexed gameId, address[] winners, uint256 amountPerWinner);

    // Constructor
    constructor() {
        // No initialization needed
    }

    // Modifier: used to ensure only the gamemaster can call functions for a specific game
    modifier isGamemaster(uint256 gameId) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        require(msg.sender == games[gameId].gamemaster, "Not authorized - only gamemaster can call this function");
        _;
    }

    /**
     * Function to create a new game with specified gamemaster and stake amount
     * @param _gamemaster Address of the gamemaster for this game
     * @param _stakeAmount Amount of ETH required to join this game
     * @return gameId The ID of the newly created game
     */
    function createGame(address _gamemaster, uint256 _stakeAmount) public returns (uint256) {
        require(_gamemaster != address(0), "Gamemaster cannot be zero address");
        require(_stakeAmount > 0, "Stake amount must be greater than 0");
        
        uint256 gameId = nextGameId++;
        
        // Initialize the game
        games[gameId].gamemaster = _gamemaster;
        games[gameId].stakeAmount = _stakeAmount;
        games[gameId].open = false;
        // Other fields are automatically initialized to default values
        
        console.log("Game created with ID: %s", gameId);
        console.log("Gamemaster: %s, Stake: %s", _gamemaster, _stakeAmount);
        emit GameCreated(gameId, _gamemaster, _stakeAmount);
        
        return gameId;
    }

    /**
     * Function that opens the game for players to join
     * Only the gamemaster can call this function
     * Can only be called once per game (immutable)
     */
    function openGame(uint256 gameId) public isGamemaster(gameId) {
        require(!games[gameId].hasOpened, "Game has already been opened and cannot be opened again");
        require(!games[gameId].open, "Game is already open");
        
        games[gameId].open = true;
        games[gameId].hasOpened = true;
        
        console.log("Game %s opened for players to join", gameId);
        emit GameOpened(gameId);
    }

    /**
     * Function that closes the game, preventing new players from joining
     * Only the gamemaster can call this function
     * Can only be called once per game and is irreversible (immutable)
     */
    function closeGame(uint256 gameId) public isGamemaster(gameId) {
        require(games[gameId].hasOpened, "Game must be opened before it can be closed");
        require(!games[gameId].hasClosed, "Game has already been closed and cannot be closed again");
        require(games[gameId].open, "Game is already closed");
        
        games[gameId].open = false;
        games[gameId].hasClosed = true;
        
        console.log("Game %s closed. Total players: %s", gameId, games[gameId].players.length);
        emit GameClosed(gameId);
    }

    /**
     * Function that allows players to join the game by staking the required amount
     * Players can only join once and only when the game is open
     */
    function joinGame(uint256 gameId) public payable {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        require(games[gameId].open, "Game is not open for joining");
        require(msg.value == games[gameId].stakeAmount, "Must stake the exact required amount to join");
        require(!games[gameId].hasJoined[msg.sender], "Player has already joined the game");
        
        // Add player to the game
        games[gameId].players.push(msg.sender);
        games[gameId].hasJoined[msg.sender] = true;
        
        console.log("Player %s joined game %s", msg.sender, gameId);
        emit PlayerJoined(gameId, msg.sender);
    }

    /**
     * Function to get the list of players who have joined the game
     */
    function getPlayers(uint256 gameId) public view returns (address[] memory) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        return games[gameId].players;
    }

    /**
     * Function to get the number of players who have joined
     */
    function getPlayerCount(uint256 gameId) public view returns (uint256) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        return games[gameId].players.length;
    }

    /**
     * Function that allows the gamemaster to commit a hash
     * Records the hash and the next block number for later reveal
     * Can only be called once per game (immutable)
     *
     * @param gameId The ID of the game
     * @param _hash (bytes32) - the hash to commit
     */
    function commitHash(uint256 gameId, bytes32 _hash) public isGamemaster(gameId) {
        require(!games[gameId].hasCommitted, "Hash has already been committed and cannot be committed again");
        
        games[gameId].committedHash = _hash;
        games[gameId].commitBlockNumber = block.number + 1; // Next block number
        games[gameId].hasCommitted = true;
        games[gameId].hasRevealed = false;

        console.log("Hash committed for game %s. Next block number: %s", gameId, games[gameId].commitBlockNumber);
        
        emit HashCommitted(gameId, _hash, games[gameId].commitBlockNumber);
    }

    /**
     * Function that allows the gamemaster to reveal the committed value
     * Verifies the reveal against the commit and generates randomness using blockhash
     *
     * @param gameId The ID of the game
     * @param _reveal (bytes32) - the original value that was hashed for the commit
     */
    function revealHash(uint256 gameId, bytes32 _reveal) public isGamemaster(gameId) {
        require(games[gameId].hasCommitted, "No hash has been committed");
        require(!games[gameId].hasRevealed, "Hash has already been revealed");
        require(block.number >= games[gameId].commitBlockNumber, "Cannot reveal before the commit block number");
        
        // Verify that the reveal hashes to the committed hash
        bytes32 hashedReveal = keccak256(abi.encodePacked(_reveal));
        require(hashedReveal == games[gameId].committedHash, "Reveal does not match the committed hash");
        
        // Get the blockhash from the commit block number for randomness
        bytes32 blockHash = blockhash(games[gameId].commitBlockNumber);
        require(blockHash != bytes32(0), "Blockhash not available (too old)");
        
        // Create random hash by combining reveal with blockhash
        bytes32 newRandomHash = keccak256(abi.encodePacked(_reveal, blockHash));
        
        // Save the values
        games[gameId].revealValue = _reveal;
        games[gameId].randomHash = newRandomHash;
        games[gameId].hasRevealed = true;

        console.log("Hash revealed and random hash generated for game %s", gameId);
        
        emit HashRevealed(gameId, _reveal, newRandomHash);
    }

    /**
     * View function to get the current state of the commit-reveal system
     */
    function getCommitRevealState(uint256 gameId) public view returns (
        bytes32 _committedHash,
        uint256 _commitBlockNumber,
        bytes32 _revealValue,
        bytes32 _randomHash,
        bool _hasCommitted,
        bool _hasRevealed
    ) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        return (
            games[gameId].committedHash,
            games[gameId].commitBlockNumber,
            games[gameId].revealValue,
            games[gameId].randomHash,
            games[gameId].hasCommitted,
            games[gameId].hasRevealed
        );
    }

    /**
     * Function that allows the gamemaster to payout the game's prize pool to winners
     * Gives the gamemaster 1% of the total prize pool and splits the remaining 99% equally among the winners
     * 
     * @param gameId The ID of the game
     * @param _winners (address[]) - array of addresses to split the payout among
     */
    function payout(uint256 gameId, address[] calldata _winners) public isGamemaster(gameId) {
        require(_winners.length > 0, "Must provide at least one winner address");
        require(games[gameId].players.length > 0, "No players in the game");
        require(!games[gameId].hasPaidOut, "Game has already been paid out");
        
        // Calculate the total prize pool for this specific game
        uint256 gamePrizePool = games[gameId].stakeAmount * games[gameId].players.length;
        require(gamePrizePool > 0, "No prize pool available for this game");
        require(address(this).balance >= gamePrizePool, "Contract doesn't have enough funds");
        
        // Calculate gamemaster's 1% cut
        uint256 gamemasterCut = gamePrizePool / 100; // 1% of the total pot
        
        // Calculate remaining 99% for winners
        uint256 winnersPool = gamePrizePool - gamemasterCut;
        uint256 amountPerWinner = winnersPool / _winners.length;
        require(amountPerWinner > 0, "Payout amount per winner must be greater than 0");
        
        console.log("Paying out ETH for game %s", gameId);
        console.log("Game prize pool: %s ETH", gamePrizePool);
        console.log("Gamemaster cut (1%%): %s ETH", gamemasterCut);
        console.log("Winners pool (99%%): %s ETH", winnersPool);
        console.log("Amount per winner: %s ETH", amountPerWinner);
        
        // Store winners and payout info in contract state
        for (uint256 i = 0; i < _winners.length; i++) {
            require(_winners[i] != address(0), "Winner address cannot be zero address");
            games[gameId].winners.push(_winners[i]);
        }
        games[gameId].payoutAmount = amountPerWinner;
        games[gameId].hasPaidOut = true;
        
        // Send gamemaster their 1% cut first
        (bool gmSuccess, ) = payable(games[gameId].gamemaster).call{value: gamemasterCut}("");
        require(gmSuccess, "Failed to send payout to gamemaster");
        console.log("Sent %s ETH to gamemaster: %s", gamemasterCut, games[gameId].gamemaster);
        
        // Send payout to each winner
        for (uint256 i = 0; i < _winners.length; i++) {
            (bool success, ) = payable(_winners[i]).call{value: amountPerWinner}("");
            require(success, "Failed to send payout to winner");
            
            console.log("Sent %s ETH to winner: %s", amountPerWinner, _winners[i]);
        }
        
        emit PayoutCompleted(gameId, _winners, amountPerWinner);
    }

    /**
     * Function to get the current contract balance
     */
    function getContractBalance() public view returns (uint256) {
        return address(this).balance;
    }

    /**
     * Function to get game info including immutability flags
     */
    function getGameInfo(uint256 gameId) public view returns (
        address gamemaster,
        uint256 stakeAmount,
        bool open,
        uint256 playerCount,
        bool hasOpened,
        bool hasClosed
    ) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        return (
            games[gameId].gamemaster,
            games[gameId].stakeAmount,
            games[gameId].open,
            games[gameId].players.length,
            games[gameId].hasOpened,
            games[gameId].hasClosed
        );
    }

    /**
     * Function to check if a player has joined a specific game
     */
    function hasPlayerJoined(uint256 gameId, address player) public view returns (bool) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        return games[gameId].hasJoined[player];
    }

    /**
     * Function to get the payout information for a game
     */
    function getPayoutInfo(uint256 gameId) public view returns (
        address[] memory winners,
        uint256 payoutAmount,
        bool hasPaidOut
    ) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        return (
            games[gameId].winners,
            games[gameId].payoutAmount,
            games[gameId].hasPaidOut
        );
    }
}
