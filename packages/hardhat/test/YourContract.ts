import { expect } from "chai";
import { ethers } from "hardhat";
import { YourContract } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("YourContract", function () {
  let yourContract: YourContract;
  let gamemaster: SignerWithAddress;
  let creator: SignerWithAddress;
  let player1: SignerWithAddress;
  let player2: SignerWithAddress;
  let player3: SignerWithAddress;

  const STAKE_AMOUNT = ethers.parseEther("0.001");
  const HIGHER_STAKE_AMOUNT = ethers.parseEther("0.01");

  beforeEach(async () => {
    [, gamemaster, creator, player1, player2, player3] = await ethers.getSigners();

    const yourContractFactory = await ethers.getContractFactory("YourContract");
    yourContract = (await yourContractFactory.deploy()) as YourContract;
    await yourContract.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should deploy successfully", async function () {
      expect(await yourContract.getAddress()).to.be.a("string");
    });

    it("Should start with nextGameId = 1", async function () {
      expect(await yourContract.nextGameId()).to.equal(1);
    });
  });

  describe("Game Creation", function () {
    it("Should create a new game", async function () {
      const tx = await yourContract.connect(creator).createGame(gamemaster.address, STAKE_AMOUNT);
      const receipt = await tx.wait();

      expect(receipt?.logs).to.have.length.greaterThan(0);
      expect(await yourContract.nextGameId()).to.equal(2);

      const gameInfo = await yourContract.getGameInfo(1);
      expect(gameInfo.gamemaster).to.equal(gamemaster.address);
      expect(gameInfo.creator).to.equal(creator.address);
      expect(gameInfo.stakeAmount).to.equal(STAKE_AMOUNT);
      expect(gameInfo.open).to.equal(false);
      expect(gameInfo.playerCount).to.equal(0);
    });

    it("Should create multiple games with different settings", async function () {
      await yourContract.connect(creator).createGame(gamemaster.address, STAKE_AMOUNT);
      await yourContract.connect(player1).createGame(player2.address, HIGHER_STAKE_AMOUNT);

      const game1Info = await yourContract.getGameInfo(1);
      const game2Info = await yourContract.getGameInfo(2);

      expect(game1Info.gamemaster).to.equal(gamemaster.address);
      expect(game1Info.creator).to.equal(creator.address);
      expect(game1Info.stakeAmount).to.equal(STAKE_AMOUNT);

      expect(game2Info.gamemaster).to.equal(player2.address);
      expect(game2Info.creator).to.equal(player1.address);
      expect(game2Info.stakeAmount).to.equal(HIGHER_STAKE_AMOUNT);
    });

    it("Should reject zero address gamemaster", async function () {
      await expect(yourContract.connect(creator).createGame(ethers.ZeroAddress, STAKE_AMOUNT)).to.be.revertedWith(
        "Gamemaster cannot be zero address",
      );
    });

    it("Should reject zero stake amount", async function () {
      await expect(yourContract.connect(creator).createGame(gamemaster.address, 0)).to.be.revertedWith(
        "Stake amount must be greater than 0",
      );
    });
  });

  describe("Game Management", function () {
    beforeEach(async () => {
      await yourContract.connect(creator).createGame(gamemaster.address, STAKE_AMOUNT);
    });

    it("Should automatically open game when gamemaster commits", async function () {
      // Gamemaster commits hash and game should automatically open
      const secretValue = ethers.randomBytes(32);
      const hash = ethers.keccak256(secretValue);
      await yourContract.connect(gamemaster).commitHash(1, hash);

      const gameInfo = await yourContract.getGameInfo(1);
      expect(gameInfo.open).to.equal(true);
      expect(gameInfo.hasOpened).to.equal(true);
    });

    it("Should allow creator to close game", async function () {
      // First, gamemaster must commit (which auto-opens the game)
      const secretValue = ethers.randomBytes(32);
      const hash = ethers.keccak256(secretValue);
      await yourContract.connect(gamemaster).commitHash(1, hash);

      // Close the game
      await yourContract.connect(creator).closeGame(1);

      const gameInfo = await yourContract.getGameInfo(1);
      expect(gameInfo.open).to.equal(false);
    });
  });

  describe("Player Joining", function () {
    beforeEach(async () => {
      await yourContract.connect(creator).createGame(gamemaster.address, STAKE_AMOUNT);

      // Gamemaster must commit (which automatically opens the game)
      const secretValue = ethers.randomBytes(32);
      const hash = ethers.keccak256(secretValue);
      await yourContract.connect(gamemaster).commitHash(1, hash);
    });

    it("Should allow player to join game", async function () {
      await yourContract.connect(player1).joinGame(1, { value: STAKE_AMOUNT });

      const gameInfo = await yourContract.getGameInfo(1);
      expect(gameInfo.playerCount).to.equal(1);

      const players = await yourContract.getPlayers(1);
      expect(players).to.include(player1.address);

      const hasJoined = await yourContract.hasPlayerJoined(1, player1.address);
      expect(hasJoined).to.equal(true);
    });

    it("Should allow multiple players to join", async function () {
      await yourContract.connect(player1).joinGame(1, { value: STAKE_AMOUNT });
      await yourContract.connect(player2).joinGame(1, { value: STAKE_AMOUNT });
      await yourContract.connect(player3).joinGame(1, { value: STAKE_AMOUNT });

      const gameInfo = await yourContract.getGameInfo(1);
      expect(gameInfo.playerCount).to.equal(3);
    });

    it("Should reject joining with wrong stake amount", async function () {
      await expect(yourContract.connect(player1).joinGame(1, { value: ethers.parseEther("0.002") })).to.be.revertedWith(
        "Must stake the exact required amount to join",
      );
    });

    it("Should reject joining closed game", async function () {
      await yourContract.connect(creator).closeGame(1);
      await expect(yourContract.connect(player1).joinGame(1, { value: STAKE_AMOUNT })).to.be.revertedWith(
        "Game is not open for joining",
      );
    });

    it("Should reject joining twice", async function () {
      await yourContract.connect(player1).joinGame(1, { value: STAKE_AMOUNT });
      await expect(yourContract.connect(player1).joinGame(1, { value: STAKE_AMOUNT })).to.be.revertedWith(
        "Player has already joined the game",
      );
    });

    it("Should reject joining non-existent game", async function () {
      await expect(yourContract.connect(player1).joinGame(999, { value: STAKE_AMOUNT })).to.be.revertedWith(
        "Game does not exist",
      );
    });
  });

  describe("Commit-Reveal System", function () {
    beforeEach(async () => {
      await yourContract.connect(creator).createGame(gamemaster.address, STAKE_AMOUNT);
    });

    it("Should allow gamemaster to commit hash", async function () {
      const secretValue = ethers.randomBytes(32);
      const hash = ethers.keccak256(secretValue);

      await yourContract.connect(gamemaster).commitHash(1, hash);

      const state = await yourContract.getCommitRevealState(1);
      expect(state._committedHash).to.equal(hash);
      expect(state._hasCommitted).to.equal(true);
      expect(state._hasRevealed).to.equal(false);
    });

    it("Should allow gamemaster to reveal hash", async function () {
      const secretValue = ethers.randomBytes(32);
      const hash = ethers.keccak256(secretValue);

      await yourContract.connect(gamemaster).commitHash(1, hash);

      // Mine a block to ensure we're at the commit block number
      await ethers.provider.send("evm_mine", []);

      await yourContract.connect(gamemaster).revealHash(1, secretValue);

      const state = await yourContract.getCommitRevealState(1);
      expect(state._revealValue).to.equal(ethers.hexlify(secretValue));
      expect(state._hasRevealed).to.equal(true);
      expect(state._randomHash).to.not.equal(ethers.ZeroHash);
    });

    it("Should reject reveal with wrong value", async function () {
      const secretValue = ethers.randomBytes(32);
      const wrongValue = ethers.randomBytes(32);
      const hash = ethers.keccak256(secretValue);

      await yourContract.connect(gamemaster).commitHash(1, hash);
      await ethers.provider.send("evm_mine", []);

      await expect(yourContract.connect(gamemaster).revealHash(1, wrongValue)).to.be.revertedWith(
        "Reveal does not match the committed hash",
      );
    });

    it("Should reject non-gamemaster commit", async function () {
      const hash = ethers.keccak256(ethers.randomBytes(32));

      await expect(yourContract.connect(player1).commitHash(1, hash)).to.be.revertedWith(
        "Not authorized - only gamemaster can call this function",
      );
    });
  });

  describe("Payout", function () {
    beforeEach(async () => {
      await yourContract.connect(creator).createGame(gamemaster.address, STAKE_AMOUNT);

      // Gamemaster must commit (which automatically opens the game)
      const secretValue = ethers.randomBytes(32);
      const hash = ethers.keccak256(secretValue);
      await yourContract.connect(gamemaster).commitHash(1, hash);

      await yourContract.connect(player1).joinGame(1, { value: STAKE_AMOUNT });
      await yourContract.connect(player2).joinGame(1, { value: STAKE_AMOUNT });
      await yourContract.connect(player3).joinGame(1, { value: STAKE_AMOUNT });
    });

    it("Should payout to winners", async function () {
      const initialBalance1 = await ethers.provider.getBalance(player1.address);
      const initialBalance2 = await ethers.provider.getBalance(player2.address);

      const contractBalanceBefore = await yourContract.getContractBalance();
      expect(contractBalanceBefore).to.equal(STAKE_AMOUNT * 3n);

      await yourContract.connect(gamemaster).payout(1, [player1.address, player2.address]);

      const finalBalance1 = await ethers.provider.getBalance(player1.address);
      const finalBalance2 = await ethers.provider.getBalance(player2.address);

      // Gamemaster gets 1% of the pot
      const gamemasterCut = contractBalanceBefore / 100n;

      // Winners split the remaining 99%
      const winnersPool = contractBalanceBefore - gamemasterCut;
      const expectedPayout = winnersPool / 2n;

      expect(finalBalance1 - initialBalance1).to.equal(expectedPayout);
      expect(finalBalance2 - initialBalance2).to.equal(expectedPayout);
      // Note: We don't check gamemaster balance exactly due to gas costs
    });

    it("Should reject payout with empty winners array", async function () {
      await expect(yourContract.connect(gamemaster).payout(1, [])).to.be.revertedWith(
        "Must provide at least one winner address",
      );
    });

    it("Should reject payout from non-gamemaster", async function () {
      await expect(yourContract.connect(player1).payout(1, [player1.address])).to.be.revertedWith(
        "Not authorized - only gamemaster can call this function",
      );
    });
  });

  describe("View Functions", function () {
    it("Should return contract balance", async function () {
      const balance = await yourContract.getContractBalance();
      expect(balance).to.equal(0);
    });

    it("Should reject getting info for non-existent game", async function () {
      await expect(yourContract.getGameInfo(999)).to.be.revertedWith("Game does not exist");
    });
  });
});
