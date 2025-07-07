"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NextPage } from "next";
import { decodeEventLog, isAddress, parseEther } from "viem";
import { useAccount } from "wagmi";
import { ClientOnlyWrapper } from "~~/components/ClientOnlyWrapper";
import { AddressInput, EtherInput } from "~~/components/scaffold-eth";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

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

  // Get contract info for parsing events
  const { data: contractInfo } = useDeployedContractInfo({
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

      const result = await writeYourContractAsync(
        {
          functionName: "createGame",
          args: [gamemaster, parseEther(stakeAmount)],
        },
        {
          onBlockConfirmation: txReceipt => {
            console.log("📋 Transaction confirmed, parsing logs...");

            // Parse the logs to find the GameCreated event
            if (contractInfo?.abi) {
              try {
                const gameCreatedEvent = txReceipt.logs.find(log => {
                  try {
                    const decodedLog = decodeEventLog({
                      abi: contractInfo.abi,
                      data: log.data,
                      topics: log.topics,
                    });
                    return decodedLog.eventName === "GameCreated";
                  } catch {
                    return false;
                  }
                });

                if (gameCreatedEvent) {
                  const decodedLog = decodeEventLog({
                    abi: contractInfo.abi,
                    data: gameCreatedEvent.data,
                    topics: gameCreatedEvent.topics,
                  });

                  if (decodedLog.eventName === "GameCreated") {
                    const gameId = decodedLog.args.gameId;
                    console.log("🎯 Game created with ID:", gameId);

                    // Redirect to the specific game page
                    router.push(`/game/${gameId}`);
                    return;
                  }
                }
              } catch (error) {
                console.error("⚠️ Error parsing event logs:", error);
              }
            }

            // Fallback to home page if event parsing fails
            console.log("📄 Falling back to home page");
            router.push("/");
          },
        },
      );

      console.log("✅ Game created successfully!", result);
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
            <h1 className="text-4xl font-bold mb-4">⛏️ Create New Game</h1>
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
                  className="btn btn-lg w-full text-white transition-all duration-300 hover:scale-105"
                  style={{
                    backgroundColor: "#ff6b35",
                    borderColor: "#ff6b35",
                    boxShadow:
                      "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 0 0 15px rgba(255, 107, 53, 0.3)",
                  }}
                  onClick={createGame}
                  disabled={loading || !connectedAddress}
                >
                  <div className="flex items-center justify-center space-x-2">
                    {loading && (
                      <svg
                        className="animate-spin h-4 w-4 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                    )}
                    <span>{loading ? "Creating Game..." : "Create Game"}</span>
                  </div>
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
            <div className="loading loading-spinner loading-md"></div>
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
