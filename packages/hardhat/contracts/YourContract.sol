//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

// Useful for debugging. Remove when deploying to a live network.
import "hardhat/console.sol";

/**
 * A smart contract that implements a commit-reveal system for generating randomness
 * Only the designated gamemaster can commit and reveal hashes
 * Players can join the game by staking 0.001 ETH when the game is open
 * @author BuidlGuidl
 */
contract YourContract {
    // Gamemaster address - the only address that can commit/reveal
    address public constant GAMEMASTER = 0xc8db9D26551886BaB74F818324aD855A7aBfB632;
    
    // Game state variables
    bool public open = false;
    address[] public players;
    mapping(address => bool) public hasJoined;
    uint256 public constant STAKE_AMOUNT = 0.001 ether;
    
    // Commit-Reveal System State Variables
    bytes32 public committedHash;
    uint256 public commitBlockNumber;
    bytes32 public revealValue;
    bytes32 public randomHash;
    bool public hasCommitted = false;
    bool public hasRevealed = false;

    // Events
    event HashCommitted(bytes32 indexed committedHash, uint256 nextBlockNumber);
    event HashRevealed(bytes32 indexed reveal, bytes32 indexed randomHash);
    event GameOpened();
    event GameClosed();
    event PlayerJoined(address indexed player);
    event PayoutCompleted(address[] winners, uint256 amountPerWinner);

    // Constructor
    constructor() {
        // No initialization needed
    }

    // Modifier: used to ensure only the gamemaster can commit/reveal
    modifier isGamemaster() {
        require(msg.sender == GAMEMASTER, "Not authorized - only gamemaster can call this function");
        _;
    }

    /**
     * Function that opens the game for players to join
     * Only the gamemaster can call this function
     */
    function openGame() public isGamemaster {
        require(!open, "Game is already open");
        open = true;
        
        console.log("Game opened for players to join");
        emit GameOpened();
    }

    /**
     * Function that closes the game, preventing new players from joining
     * Only the gamemaster can call this function
     */
    function closeGame() public isGamemaster {
        require(open, "Game is already closed");
        open = false;
        
        console.log("Game closed. Total players: %s", players.length);
        emit GameClosed();
    }

    /**
     * Function that allows players to join the game by staking 0.001 ETH
     * Players can only join once and only when the game is open
     */
    function joinGame() public payable {
        require(open, "Game is not open for joining");
        require(msg.value == STAKE_AMOUNT, "Must stake exactly 0.001 ETH to join");
        require(!hasJoined[msg.sender], "Player has already joined the game");
        
        // Add player to the game
        players.push(msg.sender);
        hasJoined[msg.sender] = true;
        
        console.log("Player %s joined the game", msg.sender);
        emit PlayerJoined(msg.sender);
    }

    /**
     * Function to get the list of players who have joined the game
     */
    function getPlayers() public view returns (address[] memory) {
        return players;
    }

    /**
     * Function to get the number of players who have joined
     */
    function getPlayerCount() public view returns (uint256) {
        return players.length;
    }

    /**
     * Function to reset the game state (only gamemaster can call this)
     * Clears all players and resets the game to closed state
     */
    function resetGame() public isGamemaster {
        // Reset game state
        open = false;
        
        // Clear players array and mapping
        for (uint256 i = 0; i < players.length; i++) {
            hasJoined[players[i]] = false;
        }
        delete players;
        
        console.log("Game reset - all players cleared");
    }

    /**
     * Function that allows the gamemaster to commit a hash
     * Records the hash and the next block number for later reveal
     *
     * @param _hash (bytes32) - the hash to commit
     */
    function commitHash(bytes32 _hash) public isGamemaster {
        require(!hasCommitted || hasRevealed, "Previous commit must be revealed first");
        
        committedHash = _hash;
        commitBlockNumber = block.number + 1; // Next block number
        hasCommitted = true;
        hasRevealed = false;

        console.log("Hash committed. Next block number: %s", commitBlockNumber);
        
        emit HashCommitted(_hash, commitBlockNumber);
    }

    /**
     * Function that allows the gamemaster to reveal the committed value
     * Verifies the reveal against the commit and generates randomness using blockhash
     *
     * @param _reveal (bytes32) - the original value that was hashed for the commit
     */
    function revealHash(bytes32 _reveal) public isGamemaster {
        require(hasCommitted, "No hash has been committed");
        require(!hasRevealed, "Hash has already been revealed");
        require(block.number >= commitBlockNumber, "Cannot reveal before the commit block number");
        
        // Verify that the reveal hashes to the committed hash
        bytes32 hashedReveal = keccak256(abi.encodePacked(_reveal));
        require(hashedReveal == committedHash, "Reveal does not match the committed hash");
        
        // Get the blockhash from the commit block number for randomness
        bytes32 blockHash = blockhash(commitBlockNumber);
        require(blockHash != bytes32(0), "Blockhash not available (too old)");
        
        // Create random hash by combining reveal with blockhash
        bytes32 newRandomHash = keccak256(abi.encodePacked(_reveal, blockHash));
        
        // Save the values
        revealValue = _reveal;
        randomHash = newRandomHash;
        hasRevealed = true;

        console.log("Hash revealed and random hash generated");
        
        emit HashRevealed(_reveal, newRandomHash);
    }

    /**
     * Function to reset the commit-reveal system (only gamemaster can call this)
     */
    function resetCommitReveal() public isGamemaster {
        committedHash = bytes32(0);
        commitBlockNumber = 0;
        revealValue = bytes32(0);
        randomHash = bytes32(0);
        hasCommitted = false;
        hasRevealed = false;
    }

    /**
     * View function to get the current state of the commit-reveal system
     */
    function getCommitRevealState() public view returns (
        bytes32 _committedHash,
        uint256 _commitBlockNumber,
        bytes32 _revealValue,
        bytes32 _randomHash,
        bool _hasCommitted,
        bool _hasRevealed
    ) {
        return (
            committedHash,
            commitBlockNumber,
            revealValue,
            randomHash,
            hasCommitted,
            hasRevealed
        );
    }

    /**
     * Function that allows the gamemaster to payout the contract balance to winners
     * Splits the total contract balance equally among the provided addresses
     * 
     * @param _winners (address[]) - array of addresses to split the payout among
     */
    function payout(address[] calldata _winners) public isGamemaster {
        require(_winners.length > 0, "Must provide at least one winner address");
        
        uint256 contractBalance = address(this).balance;
        require(contractBalance > 0, "No funds available for payout");
        
        uint256 amountPerWinner = contractBalance / _winners.length;
        require(amountPerWinner > 0, "Payout amount per winner must be greater than 0");
        
        console.log("Paying out %s ETH to %s winners (%s ETH each)", contractBalance, _winners.length, amountPerWinner);
        
        // Send payout to each winner
        for (uint256 i = 0; i < _winners.length; i++) {
            require(_winners[i] != address(0), "Winner address cannot be zero address");
            
            (bool success, ) = payable(_winners[i]).call{value: amountPerWinner}("");
            require(success, "Failed to send payout to winner");
            
            console.log("Sent %s ETH to winner: %s", amountPerWinner, _winners[i]);
        }
        
        emit PayoutCompleted(_winners, amountPerWinner);
    }

    /**
     * Function to get the current contract balance
     */
    function getContractBalance() public view returns (uint256) {
        return address(this).balance;
    }
}
