//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

/*
   ____                  _        _   _             _             __             
  / ___|_ __ _   _ _ __ | |_ ___ | | | |_   _ _ __ | |_ ___ _ __ / _|_   _ _ __  
 | |   | '__| | | | '_ \| __/ _ \| |_| | | | | '_ \| __/ _ \ '__| |_| | | | '_ \ 
 | |___| |  | |_| | |_) | || (_) |  _  | |_| | | | | ||  __/ |_ |  _| |_| | | | |
  \____|_|   \__, | .__/ \__\___/|_| |_|\__,_|_| |_|\__\___|_(_)|_|  \__,_|_| |_|
             |___/|_|   
             
a verifiable ethereum game with a gamemaster backend 

*/

contract YourContract {
    // Game struct to hold all game-specific data
    struct Game {
        address gamemaster;
        address creator;
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
        bytes32 commitBlockHash; // Store the actual block hash to avoid 256-block limitation
        bytes32 revealValue;
        bytes32 randomHash;
        bool hasCommitted;
        bool hasRevealed;
        bool hasStoredBlockHash; // Track if block hash has been stored
        uint256 mapSize;
        
        // Game URL - set by gamemaster when storing block hash
        string url;
        
        // Payout System State Variables
        address[] winners;
        uint256 payoutAmount;
        bool hasPaidOut;
        
        // Timeout and Withdrawal System
        uint256 startTime;
        uint256 openTime; // When the game was opened (commitHash called)
        mapping(address => bool) hasWithdrawn;
        bool canWithdraw;
    }
    
    // Global state variables
    uint256 public nextGameId = 1;
    mapping(uint256 => Game) public games;
    
    // Timeout constant (5 minutes in seconds)
    uint256 public constant PAYOUT_TIMEOUT = 300;
    
    // Creator timeout constant (2.5 minutes in seconds)
    uint256 public constant CREATOR_TIMEOUT = 150;
    
    // Events
    event GameCreated(uint256 indexed gameId, address indexed gamemaster, address indexed creator, uint256 stakeAmount);
    event HashCommitted(uint256 indexed gameId, bytes32 indexed committedHash, uint256 nextBlockNumber);
    event HashRevealed(uint256 indexed gameId, bytes32 indexed reveal, bytes32 indexed randomHash);
    event BlockHashStored(uint256 indexed gameId, bytes32 blockHash, string url);
    event GameOpened(uint256 indexed gameId);
    event GameClosed(uint256 indexed gameId, uint256 startTime, uint256 mapSize);
    event PlayerJoined(uint256 indexed gameId, address indexed player);
    event PayoutCompleted(uint256 indexed gameId, address[] winners, uint256 amountPerWinner);
    event PlayerWithdrew(uint256 indexed gameId, address indexed player, uint256 amount);
    event WithdrawalPeriodStarted(uint256 indexed gameId);

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

    // Modifier: used to ensure only the creator can call functions for a specific game
    modifier isCreator(uint256 gameId) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        require(msg.sender == games[gameId].creator, "Not authorized - only creator can call this function");
        _;
    }

    /**
     * Function to create a new game with specified gamemaster and stake amount
     * The creator (msg.sender) will be able to close the game
     * The game will automatically open when the gamemaster commits a hash
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
        games[gameId].creator = msg.sender;
        games[gameId].stakeAmount = _stakeAmount;
        games[gameId].open = false;
        // Other fields are automatically initialized to default values
        
        emit GameCreated(gameId, _gamemaster, msg.sender, _stakeAmount);
        
        return gameId;
    }

    /**
     * Function that closes the game, preventing new players from joining
     * Only the creator can call this function, UNLESS the creator has abandoned the game
     * After 2.5 minutes and at least one player has joined, anyone can close an abandoned game
     * Can only be called once per game and is irreversible (immutable)
     * Sets the start time for the timeout mechanism
     * Automatically calculates map size using formula: mapSize = 1 + (number of players * 4)
     */
    function closeGame(uint256 gameId) public {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        require(games[gameId].hasOpened, "Game must be opened before it can be closed");
        require(!games[gameId].hasClosed, "Game has already been closed and cannot be closed again");
        require(games[gameId].open, "Game is already closed");
        
        // Check if caller is authorized to close the game
        bool callerIsCreator = msg.sender == games[gameId].creator;
        bool gameIsAbandoned = games[gameId].openTime > 0 && 
                              block.timestamp >= games[gameId].openTime + CREATOR_TIMEOUT &&
                              games[gameId].players.length > 0;
        
        require(callerIsCreator || gameIsAbandoned, "Not authorized - only creator can close game, or anyone after 2.5 minutes if creator abandoned");
        
        // Calculate map size based on number of players: mapSize = 1 + (number of players * 4)
        uint256 calculatedMapSize = 1 + (games[gameId].players.length * 4);
        
        games[gameId].open = false;
        games[gameId].hasClosed = true;
        games[gameId].startTime = block.timestamp; // Set start time when game closes
        games[gameId].mapSize = calculatedMapSize; // Set calculated map size when game closes
        
        emit GameClosed(gameId, block.timestamp, calculatedMapSize);
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
     * Function to get the blockhash from the commit block for a given game
     * This allows the server to generate the map using the same randomness that will be used during reveal
     * Can only be called after the game has been closed (so the commit block is in the past)
     */
    function getCommitBlockHash(uint256 gameId) public view returns (bytes32) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        require(games[gameId].hasCommitted, "No hash has been committed for this game");
        require(games[gameId].hasClosed, "Game must be closed before accessing commit block hash");
        
        bytes32 blockHash = games[gameId].commitBlockHash;
        require(blockHash != bytes32(0), "Commit block hash not available (too old or not stored)");
        
        return blockHash;
    }

    /**
     * Function that allows the gamemaster to commit a hash
     * Records the hash and the next block number for later reveal
     * Can only be called once per game (immutable)
     * Automatically opens the game for players to join after committing
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

        // Automatically open the game for players to join
        games[gameId].open = true;
        games[gameId].hasOpened = true;
        games[gameId].openTime = block.timestamp; // Track when game was opened

        emit HashCommitted(gameId, _hash, games[gameId].commitBlockNumber);
        emit GameOpened(gameId);
    }

    /**
     * Function that allows the gamemaster to store the commit block hash and set the game URL
     * This should be called immediately after commitHash to ensure the block hash is captured
     * before the 256-block limitation makes it unavailable
     * Can only be called once per game and only after a hash has been committed
     *
     * @param gameId The ID of the game
     * @param _url The URL for the game's backend server
     */
    function storeCommitBlockHash(uint256 gameId, string calldata _url) public isGamemaster(gameId) {
        require(games[gameId].hasCommitted, "No hash has been committed yet");
        require(!games[gameId].hasStoredBlockHash, "Block hash has already been stored");
        require(block.number >= games[gameId].commitBlockNumber, "Must wait for the commit block to be mined");
        require(bytes(_url).length > 0, "URL cannot be empty");
        
        // Get the block hash for the commit block
        bytes32 blockHash = blockhash(games[gameId].commitBlockNumber);
        require(blockHash != bytes32(0), "Commit block hash not available (too old or invalid)");
        
        // Store the block hash and URL
        games[gameId].commitBlockHash = blockHash;
        games[gameId].url = _url;
        games[gameId].hasStoredBlockHash = true;
        
        emit BlockHashStored(gameId, blockHash, _url);
    }

    /**
     * Function that allows the gamemaster to reveal the committed value
     * Verifies the reveal against the commit and generates randomHash using blockhash + reveal
     * The randomHash is used for map generation and must match what the server calculated
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
        
        // Save the reveal value
        games[gameId].revealValue = _reveal;
        games[gameId].hasRevealed = true;

        // Calculate randomHash using blockhash and reveal value
        bytes32 blockHash = games[gameId].commitBlockHash;
        require(blockHash != bytes32(0), "Block hash not available for randomHash calculation");
        games[gameId].randomHash = keccak256(abi.encodePacked(blockHash, _reveal));

        emit HashRevealed(gameId, _reveal, games[gameId].randomHash);
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
        bool _hasRevealed,
        bool _hasStoredBlockHash,
        uint256 _mapSize
    ) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        return (
            games[gameId].committedHash,
            games[gameId].commitBlockNumber,
            games[gameId].revealValue,
            games[gameId].randomHash,
            games[gameId].hasCommitted,
            games[gameId].hasRevealed,
            games[gameId].hasStoredBlockHash,
            games[gameId].mapSize
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
        require(!games[gameId].canWithdraw, "Players have already started withdrawing - payout no longer available");
        
        // Calculate the total prize pool for this specific game
        uint256 gamePrizePool = games[gameId].stakeAmount * games[gameId].players.length;
        require(gamePrizePool > 0, "No prize pool available for this game");
        
        // Calculate gamemaster's 1% cut
        uint256 gamemasterCut = gamePrizePool / 100; // 1% of the total pot
        
        // Calculate remaining 99% for winners
        uint256 winnersPool = gamePrizePool - gamemasterCut;
        uint256 amountPerWinner = winnersPool / _winners.length;
        require(amountPerWinner > 0, "Payout amount per winner must be greater than 0");
        
        // Store winners and payout info in contract state
        for (uint256 i = 0; i < _winners.length; i++) {
            require(_winners[i] != address(0), "Winner address cannot be zero address");
            games[gameId].winners.push(_winners[i]);
        }
        games[gameId].payoutAmount = amountPerWinner;
        games[gameId].hasPaidOut = true;
        
        // Send gamemaster their 1% cut first (skip if cut is 0)
        if (gamemasterCut > 0) {
            (bool gmSuccess, ) = payable(games[gameId].gamemaster).call{value: gamemasterCut}("");
            require(gmSuccess, "Failed to send payout to gamemaster");
        }
        
        // Send payout to each winner
        for (uint256 i = 0; i < _winners.length; i++) {
            (bool success, ) = payable(_winners[i]).call{value: amountPerWinner}("");
            require(success, "Failed to send payout to winner");
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
     * Function to get the balance for a specific game
     */
    function getGameBalance(uint256 gameId) public view returns (uint256) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        return games[gameId].stakeAmount * games[gameId].players.length;
    }

    /**
     * Function to get game info including immutability flags
     */
    function getGameInfo(uint256 gameId) public view returns (
        address gamemaster,
        address creator,
        uint256 stakeAmount,
        bool open,
        uint256 playerCount,
        bool hasOpened,
        bool hasClosed
    ) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        return (
            games[gameId].gamemaster,
            games[gameId].creator,
            games[gameId].stakeAmount,
            games[gameId].open,
            games[gameId].players.length,
            games[gameId].hasOpened,
            games[gameId].hasClosed
        );
    }

    /**
     * Function to check if a game has been abandoned by its creator
     */
    function isGameAbandoned(uint256 gameId) public view returns (
        bool abandoned,
        uint256 timeUntilAbandonmentTimeout
    ) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        
        bool isAbandoned = games[gameId].openTime > 0 && 
                          block.timestamp >= games[gameId].openTime + CREATOR_TIMEOUT &&
                          games[gameId].players.length > 0 &&
                          games[gameId].open; // Still open means creator hasn't closed it
        
        uint256 timeUntil = 0;
        if (games[gameId].openTime > 0 && block.timestamp < games[gameId].openTime + CREATOR_TIMEOUT) {
            timeUntil = games[gameId].openTime + CREATOR_TIMEOUT - block.timestamp;
        }
        
        return (isAbandoned, timeUntil);
    }

    /**
     * Function to check if a player has joined a specific game
     */
    function hasPlayerJoined(uint256 gameId, address player) public view returns (bool) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        return games[gameId].hasJoined[player];
    }

    /**
     * Function to get the map size for a specific game
     */
    function getMapSize(uint256 gameId) public view returns (uint256) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        return games[gameId].mapSize;
    }

    /**
     * Function to get the URL for a specific game
     */
    function getGameUrl(uint256 gameId) public view returns (string memory) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        return games[gameId].url;
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

    /**
     * Function to check if a player has withdrawn from a specific game
     */
    function hasPlayerWithdrawn(uint256 gameId, address player) public view returns (bool) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        return games[gameId].hasWithdrawn[player];
    }



    /**
     * Function to get withdrawal information for a game
     */
    function getWithdrawalInfo(uint256 gameId) public view returns (
        uint256 startTime,
        bool canWithdraw,
        bool canWithdrawNow,
        uint256 timeUntilWithdrawal
    ) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        
        uint256 withdrawalTime = games[gameId].startTime + PAYOUT_TIMEOUT;
        bool withdrawAvailableNow = games[gameId].canWithdraw || 
                                   (games[gameId].hasClosed && 
                                    games[gameId].startTime > 0 && 
                                    block.timestamp >= withdrawalTime && 
                                    !games[gameId].hasPaidOut);
        
        uint256 timeUntil = 0;
        if (games[gameId].startTime > 0 && block.timestamp < withdrawalTime) {
            timeUntil = withdrawalTime - block.timestamp;
        }
        
        return (
            games[gameId].startTime,
            games[gameId].canWithdraw,
            withdrawAvailableNow,
            timeUntil
        );
    }

    /**
     * Function that allows players to withdraw their stake if the game hasn't been paid out within 5 minutes
     * Can only be called once per player per game
     * First person to call this after timeout sets hasPaidOut to true to prevent normal payout
     * 
     * @param gameId The ID of the game to withdraw from
     */
    function playerWithdraw(uint256 gameId) public {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        require(games[gameId].hasClosed, "Game must be closed before withdrawal");
        require(games[gameId].hasJoined[msg.sender], "Player did not join this game");
        require(!games[gameId].hasWithdrawn[msg.sender], "Player has already withdrawn from this game");
        require(games[gameId].startTime > 0, "Game has no start time set");

        // Check if withdrawals can happen
        bool timeoutReached = block.timestamp >= games[gameId].startTime + PAYOUT_TIMEOUT;
        require(
            games[gameId].canWithdraw || (timeoutReached && !games[gameId].hasPaidOut),
            "Withdrawal not available - either timeout not reached or game already paid out"
        );

        // If this is the first withdrawal, set the flags
        if (!games[gameId].canWithdraw) {
            games[gameId].canWithdraw = true;
            games[gameId].hasPaidOut = true; // Prevent normal payout
            emit WithdrawalPeriodStarted(gameId);
        }

        // Calculate withdrawal amount (player's stake)
        uint256 withdrawalAmount = games[gameId].stakeAmount;

        // Mark player as withdrawn
        games[gameId].hasWithdrawn[msg.sender] = true;

        // Send the stake back to the player
        (bool success, ) = payable(msg.sender).call{value: withdrawalAmount}("");
        require(success, "Failed to send withdrawal to player");

        emit PlayerWithdrew(gameId, msg.sender, withdrawalAmount);
    }

    /**
     * COMPREHENSIVE VIEW FUNCTION - Returns all game data in a single call
     * This replaces the need for multiple separate contract calls from the frontend
     * 
     * @param gameId The ID of the game
     * @param playerAddress Optional address to check player-specific data (use zero address if not needed)
     */
    function getFullGameState(uint256 gameId, address playerAddress) public view returns (
        // Basic game info (from getGameInfo)
        address gamemaster,
        address creator,
        uint256 stakeAmount,
        bool open,
        uint256 playerCount,
        bool hasOpened,
        bool hasClosed,
        
        // Players array (from getPlayers)
        address[] memory players,
        
        // Commit-reveal state (from getCommitRevealState)
        bytes32 committedHash,
        uint256 commitBlockNumber,
        bytes32 revealValue,
        bytes32 randomHash,
        bool hasCommitted,
        bool hasRevealed,
        bool hasStoredBlockHash,
        uint256 mapSize,
        
        // Game URL
        string memory url,
        
        // Payout info (from getPayoutInfo)
        address[] memory winners,
        uint256 payoutAmount,
        bool hasPaidOut,
        
        // Abandonment info (from isGameAbandoned)
        bool gameAbandoned,
        uint256 timeUntilAbandonmentTimeout,
        
        // Withdrawal info (from getWithdrawalInfo)
        uint256 startTime,
        bool canWithdraw,
        bool canWithdrawNow,
        uint256 timeUntilWithdrawal,
        
        // Player-specific info (from hasPlayerWithdrawn and hasPlayerJoined)
        bool playerWithdrawn,
        bool playerJoined
    ) {
        require(games[gameId].gamemaster != address(0), "Game does not exist");
        
        // Calculate abandonment status
        bool abandoned = games[gameId].openTime > 0 && 
                        block.timestamp >= games[gameId].openTime + CREATOR_TIMEOUT &&
                        games[gameId].players.length > 0 &&
                        games[gameId].open;
        
        uint256 abandonmentTimeUntil = 0;
        if (games[gameId].openTime > 0 && block.timestamp < games[gameId].openTime + CREATOR_TIMEOUT) {
            abandonmentTimeUntil = games[gameId].openTime + CREATOR_TIMEOUT - block.timestamp;
        }
        
        // Calculate withdrawal status
        uint256 withdrawalTime = games[gameId].startTime + PAYOUT_TIMEOUT;
        bool withdrawNow = games[gameId].canWithdraw || 
                          (games[gameId].hasClosed && 
                           games[gameId].startTime > 0 && 
                           block.timestamp >= withdrawalTime && 
                           !games[gameId].hasPaidOut);
        
        uint256 withdrawalTimeUntil = 0;
        if (games[gameId].startTime > 0 && block.timestamp < withdrawalTime) {
            withdrawalTimeUntil = withdrawalTime - block.timestamp;
        }
        
        // Player-specific data (only if playerAddress is provided)
        bool hasPlayerWithdrawnLocal = false;
        bool hasPlayerJoinedLocal = false;
        if (playerAddress != address(0)) {
            hasPlayerWithdrawnLocal = games[gameId].hasWithdrawn[playerAddress];
            hasPlayerJoinedLocal = games[gameId].hasJoined[playerAddress];
        }
        
        return (
            // Basic game info
            games[gameId].gamemaster,
            games[gameId].creator,
            games[gameId].stakeAmount,
            games[gameId].open,
            games[gameId].players.length,
            games[gameId].hasOpened,
            games[gameId].hasClosed,
            
            // Players array
            games[gameId].players,
            
            // Commit-reveal state
            games[gameId].committedHash,
            games[gameId].commitBlockNumber,
            games[gameId].revealValue,
            games[gameId].randomHash,
            games[gameId].hasCommitted,
            games[gameId].hasRevealed,
            games[gameId].hasStoredBlockHash,
            games[gameId].mapSize,
            
            // Game URL
            games[gameId].url,
            
            // Payout info
            games[gameId].winners,
            games[gameId].payoutAmount,
            games[gameId].hasPaidOut,
            
            // Abandonment info
            abandoned,
            abandonmentTimeUntil,
            
            // Withdrawal info
            games[gameId].startTime,
            games[gameId].canWithdraw,
            withdrawNow,
            withdrawalTimeUntil,
            
            // Player-specific info
            hasPlayerWithdrawnLocal,
            hasPlayerJoinedLocal
        );
    }
}
