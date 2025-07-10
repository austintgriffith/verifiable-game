"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { NextPage } from "next";
import { formatEther } from "viem";
import { ClientOnlyWrapper } from "~~/components/ClientOnlyWrapper";
import { Address } from "~~/components/scaffold-eth";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

const GameListContent = () => {
  const [loading] = useState(false);

  // Read the next game ID to determine how many games exist
  const { data: nextGameId } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "nextGameId",
  });

  return (
    <>
      <div className="flex items-center flex-col grow pt-2">
        <div className="px-5 w-full max-w-4xl">
          {/* Cover Image with Button on top */}
          <div className="text-center mb-8 relative">
            <Image
              src="/cover.jpg"
              alt="Game Cover"
              className="w-full max-w-2xl h-auto mx-auto"
              width={800}
              height={600}
              priority
            />

            {/* Create Game Button positioned on top of image */}
            <div className="absolute inset-0 flex items-end justify-center pb-20">
              <Link
                href="/create"
                className="btn btn-xl text-xl px-8 py-4 shadow-2xl drop-shadow-2xl text-white hover:animate-none transition-all duration-300 hover:scale-110"
                style={{
                  backgroundColor: "#ff6b35",
                  borderColor: "#ff6b35",
                  boxShadow:
                    "0 25px 25px -5px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.1), 0 0 20px rgba(255, 107, 53, 0.5)",
                  animation: "scalePulse 2s ease-in-out infinite",
                }}
              >
                ⛏️ Create New Game
              </Link>
            </div>
          </div>

          {/* Games List */}
          <div className="bg-base-100 rounded-lg p-6 shadow-lg">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-base-content">Active Games</h2>
              <div className="text-sm text-base-content/70">
                {nextGameId && `${Number(nextGameId) - 1} total games created`}
              </div>
            </div>

            {loading ? (
              <div className="text-center py-8">
                <div className="loading loading-spinner loading-lg"></div>
                <p className="mt-4 text-base-content">Loading games...</p>
              </div>
            ) : nextGameId && Number(nextGameId) > 1 ? (
              <div className="grid gap-4">
                {Array.from({ length: Number(nextGameId) - 1 }, (_, i) => i + 1)
                  .reverse()
                  .map(gameId => (
                    <GameCard key={gameId} gameId={gameId} />
                  ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-base-content/70 text-lg">No active games found</p>
                <p className="text-sm text-base-content/50 mt-2">Be the first to create a game!</p>
              </div>
            )}
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
      <div className="border border-base-300 rounded-lg p-4 animate-pulse">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-base-300 rounded"></div>
            <div>
              <div className="w-20 h-3 bg-base-300 rounded mb-1"></div>
              <div className="w-32 h-4 bg-base-300 rounded"></div>
            </div>
          </div>
          <div className="w-16 h-6 bg-base-300 rounded-full"></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
          <div className="text-center">
            <div className="w-20 h-4 bg-base-300 rounded mx-auto mb-1"></div>
            <div className="w-16 h-6 bg-base-300 rounded mx-auto"></div>
          </div>
          <div className="text-center">
            <div className="w-16 h-4 bg-base-300 rounded mx-auto mb-1"></div>
            <div className="w-8 h-6 bg-base-300 rounded mx-auto"></div>
          </div>
          <div className="text-center md:col-span-1 col-span-2">
            <div className="w-12 h-4 bg-base-300 rounded mx-auto mb-1"></div>
            <div className="w-32 h-6 bg-base-300 rounded mx-auto"></div>
          </div>
        </div>
        <div className="flex justify-between items-center pt-3 border-t border-base-300">
          <div className="w-20 h-4 bg-base-300 rounded"></div>
          <div className="w-24 h-8 bg-base-300 rounded"></div>
        </div>
      </div>
    );
  }

  // gameInfo is a tuple: [gamemaster, creator, stakeAmount, open, playerCount, hasOpened, hasClosed]
  const gamemaster = gameInfo[0];
  const stakeAmount = gameInfo[2];
  const open = gameInfo[3];
  const playerCount = gameInfo[4];

  // Don't render closed games
  if (!open) {
    return null;
  }

  return (
    <div className="border border-base-300 rounded-lg p-4 hover:shadow-lg transition-shadow">
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center space-x-3">
          <span className="text-2xl font-bold text-primary">#{gameId}</span>
          <div>
            <p className="text-sm text-base-content/70">Gamemaster</p>
            <Address address={gamemaster} />
          </div>
        </div>
        <div className="text-right">
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              open
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                : "bg-base-200 text-base-content/70"
            }`}
          >
            {open ? "Open" : "Closed"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <p className="text-sm text-base-content/70">Stake Amount</p>
          <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">{formatEther(stakeAmount)} ETH</p>
        </div>
        <div className="text-center">
          <p className="text-sm text-base-content/70">Players</p>
          <p className="text-lg font-semibold text-purple-600 dark:text-purple-400">{playerCount.toString()}</p>
        </div>
        <div className="text-center md:col-span-1 col-span-2">
          <p className="text-sm text-base-content/70">Status</p>
          <p className="text-lg font-semibold text-base-content">{open ? "🟢 Accepting Players" : "🔴 Game Closed"}</p>
        </div>
      </div>

      <div className="flex justify-end items-center pt-3 border-t border-base-300">
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
            <p className="mt-4 text-base-content">Loading games...</p>
          </div>
        </div>
      }
    >
      <GameListContent />
    </ClientOnlyWrapper>
  );
};

export default Home;
