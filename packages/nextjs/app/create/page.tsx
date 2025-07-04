"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NextPage } from "next";
import { isAddress, parseEther } from "viem";
import { useAccount } from "wagmi";
import { ClientOnlyWrapper } from "~~/components/ClientOnlyWrapper";
import { AddressInput, EtherInput } from "~~/components/scaffold-eth";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

// Default values from the old contract
const DEFAULT_GAMEMASTER = "0xc8db9D26551886BaB74F818324aD855A7aBfB632";
const DEFAULT_STAKE_AMOUNT = "0.001";

const CreateGameContent = () => {
  const { address: connectedAddress } = useAccount();
  const router = useRouter();
  const [gamemaster, setGamemaster] = useState<string>(DEFAULT_GAMEMASTER);
  const [stakeAmount, setStakeAmount] = useState<string>(DEFAULT_STAKE_AMOUNT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Contract function to create a game
  const { writeContractAsync: writeYourContractAsync } = useScaffoldWriteContract({
    contractName: "YourContract",
  });

  const createGame = async () => {
    if (!connectedAddress) {
      setError("Please connect your wallet first");
      return;
    }

    if (!isAddress(gamemaster)) {
      setError("Please enter a valid gamemaster address");
      return;
    }

    if (!stakeAmount || parseFloat(stakeAmount) <= 0) {
      setError("Please enter a valid stake amount");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log("🎮 Creating game with:", {
        gamemaster,
        stakeAmount: parseEther(stakeAmount),
      });

      const result = await writeYourContractAsync({
        functionName: "createGame",
        args: [gamemaster, parseEther(stakeAmount)],
      });

      console.log("✅ Game created successfully!", result);

      // Redirect to the main page after successful creation
      router.push("/");
    } catch (err) {
      console.error("💥 Failed to create game:", err);
      setError("Failed to create game. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center flex-col grow pt-10">
        <div className="px-5 w-full max-w-2xl">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-4">🎯 Create New Game</h1>
            <p className="text-lg text-gray-600">Set up your commit-reveal game with custom settings</p>
          </div>

          {/* Create Game Form */}
          <div className="bg-base-100 rounded-lg p-8 shadow-lg">
            <div className="space-y-6">
              {/* Gamemaster Address */}
              <div>
                <label className="block text-sm font-semibold mb-2">Gamemaster Address</label>
                <AddressInput value={gamemaster} onChange={setGamemaster} placeholder="Enter gamemaster address" />
                <p className="text-sm text-gray-500 mt-1">
                  The address that will have control over this game (commit/reveal, open/close, payout)
                </p>
              </div>

              {/* Stake Amount */}
              <div>
                <label className="block text-sm font-semibold mb-2">Stake Amount (ETH)</label>
                <EtherInput value={stakeAmount} onChange={setStakeAmount} placeholder="0.001" />
                <p className="text-sm text-gray-500 mt-1">The amount of ETH players must stake to join this game</p>
              </div>

              {/* Error Display */}
              {error && (
                <div className="alert alert-error">
                  <span>{error}</span>
                </div>
              )}

              {/* Create Button */}
              <div className="flex flex-col space-y-4">
                <button
                  className={`btn btn-primary btn-lg w-full ${loading ? "loading" : ""}`}
                  onClick={createGame}
                  disabled={loading || !connectedAddress}
                >
                  {loading ? "Creating Game..." : "Create Game"}
                </button>

                <button className="btn btn-ghost w-full" onClick={() => router.push("/")} disabled={loading}>
                  Cancel
                </button>
              </div>

              {/* Connect Wallet Prompt */}
              {!connectedAddress && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
                  <div className="flex">
                    <div className="ml-3">
                      <p className="text-sm text-yellow-700">Please connect your wallet to create a game.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Default Values Info */}
          <div className="bg-blue-50 rounded-lg p-6 mt-8">
            <h3 className="text-lg font-semibold mb-3">ℹ️ Default Values</h3>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-medium">Default Gamemaster:</p>
                <p className="text-gray-600 font-mono break-all">{DEFAULT_GAMEMASTER}</p>
              </div>
              <div>
                <p className="font-medium">Default Stake Amount:</p>
                <p className="text-gray-600">{DEFAULT_STAKE_AMOUNT} ETH</p>
              </div>
            </div>
            <p className="text-gray-600 mt-3">
              These are the original values from the single-game contract. You can customize them for your new game.
            </p>
          </div>

          {/* How it Works */}
          <div className="bg-base-100 rounded-lg p-6 shadow-lg mt-8">
            <h3 className="text-lg font-semibold mb-3">🔧 How Game Creation Works</h3>
            <div className="space-y-3 text-sm text-gray-600">
              <p>
                <strong>1. Gamemaster:</strong> The address that controls the game. Only this address can open/close the
                game, commit/reveal hashes, and distribute payouts.
              </p>
              <p>
                <strong>2. Stake Amount:</strong> The amount players must pay to join. All stakes are pooled together
                and distributed to winners.
              </p>
              <p>
                <strong>3. Game Flow:</strong> After creation, the gamemaster opens the game, players join by paying the
                stake, then the gamemaster runs commit-reveal rounds to determine winners fairly.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

const CreateGame: NextPage = () => {
  return (
    <ClientOnlyWrapper
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="loading loading-spinner loading-lg"></div>
            <p className="mt-4">Loading...</p>
          </div>
        </div>
      }
    >
      <CreateGameContent />
    </ClientOnlyWrapper>
  );
};

export default CreateGame;
