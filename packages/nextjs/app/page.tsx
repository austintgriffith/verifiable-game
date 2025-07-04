"use client";

import { useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { ClientOnlyWrapper } from "~~/components/ClientOnlyWrapper";
import { Address } from "~~/components/scaffold-eth";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

const GameListContent = () => {
  const { address: connectedAddress } = useAccount();
  const [loading] = useState(false);

  // Read the next game ID to determine how many games exist
  const { data: nextGameId } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "nextGameId",
  });

  return (
    <>
      <div className="flex items-center flex-col grow pt-10">
        <div className="px-5 w-full max-w-4xl">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-4">🎮 Game Hub</h1>
            <p className="text-lg text-gray-600">Discover active games or create your own commit-reveal game</p>
          </div>

          {/* Create Game Button */}
          <div className="text-center mb-8">
            <Link href="/create" className="btn btn-primary btn-lg">
              🎯 Create New Game
            </Link>
          </div>

          {/* Games List */}
          <div className="bg-base-100 rounded-lg p-6 shadow-lg">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Active Games</h2>
              <div className="text-sm text-gray-600">{nextGameId && `${Number(nextGameId) - 1} total games`}</div>
            </div>

            {loading ? (
              <div className="text-center py-8">
                <div className="loading loading-spinner loading-lg"></div>
                <p className="mt-4">Loading games...</p>
              </div>
            ) : nextGameId && Number(nextGameId) > 1 ? (
              <div className="grid gap-4">
                {Array.from({ length: Number(nextGameId) - 1 }, (_, i) => i + 1).map(gameId => (
                  <GameCard key={gameId} gameId={gameId} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500 text-lg">No games found</p>
                <p className="text-sm text-gray-400 mt-2">Be the first to create a game!</p>
              </div>
            )}
          </div>

          {/* Connect Wallet Prompt */}
          {!connectedAddress && (
            <div className="bg-blue-50 border-l-4 border-blue-400 p-6 rounded mt-8">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm text-blue-700">Connect your wallet to create games or join existing ones.</p>
                </div>
              </div>
            </div>
          )}

          {/* How it Works */}
          <div className="bg-base-100 rounded-lg p-6 shadow-lg mt-8">
            <h2 className="text-2xl font-bold mb-4">How it Works</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold mb-2">🎯 Create a Game</h3>
                <p className="text-gray-600">
                  Set up your own commit-reveal game with custom gamemaster and stake amount. Players join by staking
                  the required ETH.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">🎮 Join a Game</h3>
                <p className="text-gray-600">
                  Browse active games and join by paying the stake amount. Participate in commit-reveal rounds and win
                  prizes!
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">🔐 Commit-Reveal</h3>
                <p className="text-gray-600">
                  Gamemasters commit hashes, then reveal them to generate provably fair randomness for determining
                  winners.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">💰 Win Prizes</h3>
                <p className="text-gray-600">
                  Winners receive their share of the total stakes collected from all players who joined the game.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

// Component for individual game cards
const GameCard = ({ gameId }: { gameId: number }) => {
  // Read game info for this specific game
  const { data: gameInfo } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "getGameInfo",
    args: [BigInt(gameId)],
  });

  if (!gameInfo) {
    return (
      <div className="border border-gray-200 rounded-lg p-4 animate-pulse">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gray-300 rounded"></div>
            <div>
              <div className="w-20 h-3 bg-gray-300 rounded mb-1"></div>
              <div className="w-32 h-4 bg-gray-300 rounded"></div>
            </div>
          </div>
          <div className="w-16 h-6 bg-gray-300 rounded-full"></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
          <div className="text-center">
            <div className="w-20 h-4 bg-gray-300 rounded mx-auto mb-1"></div>
            <div className="w-16 h-6 bg-gray-300 rounded mx-auto"></div>
          </div>
          <div className="text-center">
            <div className="w-16 h-4 bg-gray-300 rounded mx-auto mb-1"></div>
            <div className="w-8 h-6 bg-gray-300 rounded mx-auto"></div>
          </div>
          <div className="text-center md:col-span-1 col-span-2">
            <div className="w-12 h-4 bg-gray-300 rounded mx-auto mb-1"></div>
            <div className="w-32 h-6 bg-gray-300 rounded mx-auto"></div>
          </div>
        </div>
        <div className="flex justify-between items-center pt-3 border-t">
          <div className="w-20 h-4 bg-gray-300 rounded"></div>
          <div className="w-24 h-8 bg-gray-300 rounded"></div>
        </div>
      </div>
    );
  }

  // gameInfo is a tuple: [gamemaster, stakeAmount, open, playerCount]
  const gamemaster = gameInfo[0];
  const stakeAmount = gameInfo[1];
  const open = gameInfo[2];
  const playerCount = gameInfo[3];

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:shadow-lg transition-shadow">
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center space-x-3">
          <span className="text-2xl font-bold text-primary">#{gameId}</span>
          <div>
            <p className="text-sm text-gray-600">Gamemaster</p>
            <Address address={gamemaster} />
          </div>
        </div>
        <div className="text-right">
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              open ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
            }`}
          >
            {open ? "Open" : "Closed"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <p className="text-sm text-gray-600">Stake Amount</p>
          <p className="text-lg font-semibold text-blue-600">{formatEther(stakeAmount)} ETH</p>
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-600">Players</p>
          <p className="text-lg font-semibold text-purple-600">{playerCount.toString()}</p>
        </div>
        <div className="text-center md:col-span-1 col-span-2">
          <p className="text-sm text-gray-600">Status</p>
          <p className="text-lg font-semibold">{open ? "🟢 Accepting Players" : "🔴 Game Closed"}</p>
        </div>
      </div>

      <div className="flex justify-between items-center pt-3 border-t">
        <div className="text-sm text-gray-500">Game ID: {gameId}</div>
        <Link href={`/game/${gameId}`} className="btn btn-sm btn-primary">
          View Game
        </Link>
      </div>
    </div>
  );
};

const Home: NextPage = () => {
  return (
    <ClientOnlyWrapper
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="loading loading-spinner loading-lg"></div>
            <p className="mt-4">Loading games...</p>
          </div>
        </div>
      }
    >
      <GameListContent />
    </ClientOnlyWrapper>
  );
};

export default Home;
