"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { NextPage } from "next";
import { QRCodeSVG } from "qrcode.react";
import Confetti from "react-confetti";
import { formatEther } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { ClientOnlyWrapper } from "~~/components/ClientOnlyWrapper";
import { Address } from "~~/components/scaffold-eth";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useWatchBalance } from "~~/hooks/scaffold-eth/useWatchBalance";

//const API_BASE = "https://slop.computer:8000";
const API_BASE = "http://localhost:8000";

// Types for the game API responses
interface GameStatus {
  success: boolean;
  gameLoaded: boolean;
  mapSize: number;
  totalPlayers: number;
  players: string[];
  revealSeed: string;
  serverTime: string;
  open?: boolean; // Whether the game is open for joining
}

interface MapTile {
  tile: number;
  player: boolean;
}

interface MapResponse {
  success: boolean;
  player: string;
  localView: (MapTile | null)[][];
  position: { x: number; y: number };
  mapSize: number;
  score?: number;
  movesRemaining?: number;
  minesRemaining?: number;
  legend: Record<string, string>;
}

interface PlayerInfo {
  address: string;
  position: { x: number; y: number };
  tile: number;
  score?: number;
  movesRemaining?: number;
  minesRemaining?: number;
}

interface RegisterResponse {
  success: boolean;
  message: string;
  instructions: string;
  timestamp: number;
}

interface AuthResponse {
  success: boolean;
  token: string;
  expiresIn: string;
  message: string;
}

interface PlayersResponse {
  success: boolean;
  players: PlayerInfo[];
  count: number;
}

const GamePageContent = () => {
  const params = useParams();
  const router = useRouter();
  const gameId = parseInt(params?.gameId as string);
  const { address: connectedAddress } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [gameStatus, setGameStatus] = useState<GameStatus | null>(null);
  const [playerMap, setPlayerMap] = useState<MapResponse | null>(null);
  const [allPlayers, setAllPlayers] = useState<PlayerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Authentication state
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  // Payout event state
  const [showConfetti, setShowConfetti] = useState(false);

  // Watch balance to check if user has ETH
  const { data: balance } = useWatchBalance({
    address: connectedAddress,
  });

  // Read game info
  const { data: gameInfo } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "getGameInfo",
    args: [BigInt(gameId)],
  });

  // Read game players
  const { data: contractPlayers } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "getPlayers",
    args: [BigInt(gameId)],
  });

  // Read payout info
  const { data: payoutInfo } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "getPayoutInfo",
    args: [BigInt(gameId)],
  });

  // Read commit-reveal state
  const { data: commitRevealState } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "getCommitRevealState",
    args: [BigInt(gameId)],
  });

  // Contract write functions
  const { writeContractAsync: writeYourContractAsync } = useScaffoldWriteContract({
    contractName: "YourContract",
  });

  // Game state derived from contract data
  const gamemaster = gameInfo?.[0];
  const creator = gameInfo?.[1];
  const stakeAmount = gameInfo?.[2];
  const open = gameInfo?.[3];
  const playerCount = gameInfo?.[4];
  const hasOpened = gameInfo?.[5];
  const hasClosed = gameInfo?.[6];

  // Payout state derived from contract data
  const winners = payoutInfo?.[0] || [];
  const payoutAmount = payoutInfo?.[1] || 0n;
  const hasPaidOut = payoutInfo?.[2] || false;

  // Commit-reveal state derived from contract data
  const committedHash = commitRevealState?.[0];
  const commitBlockNumber = commitRevealState?.[1];
  const randomHash = commitRevealState?.[3];
  const hasCommitted = commitRevealState?.[4] || false;
  const hasRevealed = commitRevealState?.[5] || false;

  const hasEth = balance && balance.value > 0n;
  const isPlayer = connectedAddress && contractPlayers?.includes(connectedAddress);
  const canPlay = isPlayer && isAuthenticated;
  const gameIsOpen = open || gameStatus?.open; // Use contract data as primary source, fallback to server data
  const isCreator = connectedAddress && creator && connectedAddress.toLowerCase() === creator.toLowerCase();

  // Process payout state from contract
  useEffect(() => {
    console.log("🔍 Payout state useEffect triggered");
    console.log("  - Has paid out:", hasPaidOut);
    console.log("  - Winners:", winners);
    console.log("  - Payout amount:", payoutAmount);

    if (hasPaidOut && winners && winners.length > 0) {
      console.log("🎉 Payout detected from contract state");
      console.log("  - Winners from contract:", winners);
      console.log("  - Amount per winner from contract:", payoutAmount);

      console.log("✅ Processing payout contract data");

      // Check if connected user is a winner
      if (connectedAddress && winners.includes(connectedAddress)) {
        console.log("🎊 Connected user is a winner! Starting confetti...");
        setShowConfetti(true);
        // Auto-hide confetti after 5 seconds
        setTimeout(() => setShowConfetti(false), 5000);
      }
    } else {
      console.log("📭 No payout found yet");
    }
  }, [hasPaidOut, winners, payoutAmount, connectedAddress]);

  // Debug current payout state
  useEffect(() => {
    console.log("🎯 Current payout state:", { hasPaidOut, winners, payoutAmount });
  }, [hasPaidOut, winners, payoutAmount]);

  // Debug state changes
  useEffect(() => {
    console.log("🔍 State Debug Info:");
    console.log("  - Connected Address:", connectedAddress);
    console.log("  - Game ID:", gameId);
    console.log("  - Is Authenticated:", isAuthenticated);
    console.log("  - Is Player:", isPlayer);
    console.log("  - Is Creator:", isCreator);
    console.log("  - Can Play:", canPlay);
    console.log("  - Game Status:", gameStatus ? "loaded" : "not loaded");
    console.log("  - JWT Token:", jwtToken ? "present" : "null");
    console.log("  - Game Is Open:", gameIsOpen);
    console.log("  - Has Opened:", hasOpened);
    console.log("  - Has Closed:", hasClosed);
    console.log("  - Has Committed:", hasCommitted);
    console.log("  - Contract Players:", contractPlayers);
    console.log("  - Has Paid Out:", hasPaidOut);
    console.log("  - Winners:", winners);
    console.log("  - Payout Amount:", payoutAmount);
  }, [
    connectedAddress,
    gameId,
    isAuthenticated,
    isPlayer,
    isCreator,
    canPlay,
    gameStatus,
    jwtToken,
    gameIsOpen,
    hasOpened,
    hasClosed,
    hasCommitted,
    contractPlayers,
    hasPaidOut,
    winners,
    payoutAmount,
  ]);

  // Authentication functions
  const signIn = async () => {
    console.log("🔐 Starting sign-in process...");
    console.log("Connected address:", connectedAddress);

    if (!connectedAddress) {
      console.log("❌ No connected address");
      setError("Please connect your wallet first");
      return;
    }

    // Check if user is a player before allowing sign-in
    if (!isPlayer) {
      console.log("❌ User is not a player in the game");
      setError(
        "Your address is not registered as a player in this game. You need to join the game first by paying the stake amount.",
      );
      return;
    }

    console.log("✅ User is a registered player, proceeding with authentication");
    setAuthLoading(true);
    setError(null);

    try {
      // Step 1: Get the message to sign
      console.log("📝 Step 1: Fetching register message from server...");
      console.log("Request URL:", `${API_BASE}/register`);

      const registerResponse = await fetch(`${API_BASE}/register`);
      console.log("Register response status:", registerResponse.status);
      console.log("Register response headers:", Object.fromEntries(registerResponse.headers.entries()));

      const registerData: RegisterResponse = await registerResponse.json();
      console.log("Register response data:", registerData);

      if (!registerData.success) {
        console.log("❌ Failed to get register message:", registerData);
        setError("Failed to get authentication message");
        return;
      }

      console.log("✅ Got message to sign:", registerData.message);
      console.log("Instructions:", registerData.instructions);
      console.log("⏰ Timestamp:", registerData.timestamp);

      // Step 2: Sign the message
      console.log("✍️ Step 2: Requesting wallet signature...");
      const signature = await signMessageAsync({
        message: registerData.message,
      });
      console.log("✅ Got signature:", signature);
      console.log("Signature length:", signature.length);

      // Step 3: Submit signature for JWT token
      console.log("🚀 Step 3: Submitting signature for JWT token...");
      const authPayload = {
        signature,
        address: connectedAddress,
        timestamp: registerData.timestamp,
      };
      console.log("Auth payload:", authPayload);

      const authResponse = await fetch(`${API_BASE}/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(authPayload),
      });

      console.log("Auth response status:", authResponse.status);
      console.log("Auth response headers:", Object.fromEntries(authResponse.headers.entries()));

      const authData: AuthResponse = await authResponse.json();
      console.log("Auth response data:", authData);

      if (authData.success) {
        console.log("🎉 Authentication successful!");
        console.log("JWT token received:", authData.token);
        console.log("Token expires in:", authData.expiresIn);
        console.log("Server message:", authData.message);

        setJwtToken(authData.token);
        setIsAuthenticated(true);
        // Store token in sessionStorage for persistence during session with namespaced key
        const tokenKey = `gameJwtToken_${API_BASE}_${gameId}`;
        if (typeof window !== "undefined") {
          sessionStorage.setItem(tokenKey, authData.token);
          console.log("Token stored in sessionStorage with key:", tokenKey);
        }
      } else {
        console.log("❌ Authentication failed:", authData);
        setError("Authentication failed");
      }
    } catch (err) {
      console.error("💥 Authentication error:", err);
      console.error("Error details:", {
        name: err instanceof Error ? err.name : "Unknown",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      setError("Failed to authenticate. Please try again.");
    } finally {
      setAuthLoading(false);
      console.log("🏁 Sign-in process completed");
    }
  };

  const signOut = () => {
    console.log("🚪 Signing out...");
    setJwtToken(null);
    setIsAuthenticated(false);
    const tokenKey = `gameJwtToken_${API_BASE}_${gameId}`;
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(tokenKey);
      console.log("✅ Signed out successfully from:", tokenKey);
    }
  };

  // Join game function
  const joinGame = async () => {
    if (!connectedAddress) {
      setError("Please connect your wallet first");
      return;
    }

    if (!gameIsOpen) {
      setError("Game is not open for joining");
      return;
    }

    if (!stakeAmount) {
      setError("Stake amount not available");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log("🎮 Attempting to join game...");
      await writeYourContractAsync({
        functionName: "joinGame",
        args: [BigInt(gameId)],
        value: stakeAmount,
      });
      console.log("✅ Successfully joined the game!");
      // Refresh game info to update player list
      // The useEffect hooks will handle the refresh
    } catch (err) {
      console.error("💥 Failed to join game:", err);
      setError("Failed to join game. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Close game function (for creator)
  const closeGame = async () => {
    if (!connectedAddress) {
      setError("Please connect your wallet first");
      return;
    }

    if (!isCreator) {
      setError("Only the game creator can close the game");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log("🔒 Attempting to close game...");
      await writeYourContractAsync({
        functionName: "closeGame",
        args: [BigInt(gameId)],
      });
      console.log("✅ Successfully closed the game!");
    } catch (err) {
      console.error("💥 Failed to close game:", err);
      setError("Failed to close game. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Need to add the required functions for the new UI
  // Check for existing token on mount
  useEffect(() => {
    console.log("🔍 Checking for existing token on mount...");
    const tokenKey = `gameJwtToken_${API_BASE}_${gameId}`;
    if (typeof window !== "undefined") {
      const savedToken = sessionStorage.getItem(tokenKey);
      console.log("Checking for token with key:", tokenKey);
      console.log("Saved token found:", !!savedToken);
      if (savedToken) {
        console.log("Saved token (first 20 chars):", savedToken.substring(0, 20) + "...");
        setJwtToken(savedToken);
        setIsAuthenticated(true);
        console.log("✅ Restored authentication from saved token");
      } else {
        console.log("No saved token found for this game instance");
      }
    }
  }, [gameId]);

  // Game API functions
  const fetchGameStatus = async () => {
    console.log("📊 Fetching game status...");
    try {
      console.log("Request URL:", `${API_BASE}/status`);
      const response = await fetch(`${API_BASE}/status`);
      console.log("Status response status:", response.status);

      const data = await response.json();
      console.log("Status response data:", data);

      setGameStatus(data);
      console.log("✅ Game status updated");
    } catch (err) {
      console.error("💥 Failed to fetch game status:", err);
      // Silently retry - don't show error to user when server is temporarily down
    }
  };

  // Fetch all players
  const fetchAllPlayers = async () => {
    console.log("👥 Fetching all players...");
    try {
      console.log("Request URL:", `${API_BASE}/players`);
      const response = await fetch(`${API_BASE}/players`);
      console.log("Players response status:", response.status);

      const data: PlayersResponse = await response.json();
      console.log("Players response data:", data);

      if (data.success) {
        console.log("✅ Players data updated:", data.players.length, "players");
        setAllPlayers(data.players);
      } else {
        console.log("❌ Players request unsuccessful:", data);
      }
    } catch (err) {
      console.error("💥 Failed to fetch players:", err);
    }
  };

  // Fetch player's map view - using useCallback to prevent infinite re-renders
  const fetchPlayerMap = useCallback(async () => {
    console.log("🗺️ Fetching player map...");
    console.log("Can play:", canPlay);
    console.log("Has JWT token:", !!jwtToken);

    if (!canPlay || !jwtToken) {
      console.log("❌ Cannot fetch map - missing requirements");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/map`, {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
        },
      });

      const data = await response.json();
      console.log("Map response data:", data);

      if (data.success) {
        console.log("✅ Map data received successfully");
        setPlayerMap(data);
      } else if (response.status === 401 || response.status === 403) {
        console.log("🔒 Token expired or invalid");
        setIsAuthenticated(false);
        setJwtToken(null);
        const tokenKey = `gameJwtToken_${API_BASE}_${gameId}`;
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(tokenKey);
        }
        setError("Authentication expired. Please sign in again.");
      }
    } catch (err) {
      console.error("💥 Failed to fetch player map:", err);
    }
  }, [canPlay, jwtToken, gameId]);

  // Move player
  const movePlayer = async (direction: string) => {
    if (!canPlay || !jwtToken) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/move`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwtToken}`,
        },
        body: JSON.stringify({ direction }),
      });

      const data = await response.json();

      if (data.success) {
        setPlayerMap(prevMap =>
          prevMap
            ? {
                ...prevMap,
                localView: data.localView,
                position: data.newPosition,
                score: data.score,
                movesRemaining: data.movesRemaining,
                minesRemaining: data.minesRemaining,
              }
            : null,
        );
        fetchAllPlayers();
      } else if (response.status === 401 || response.status === 403) {
        setIsAuthenticated(false);
        setJwtToken(null);
        const tokenKey = `gameJwtToken_${API_BASE}_${gameId}`;
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(tokenKey);
        }
        setError("Authentication expired. Please sign in again.");
      } else {
        setError(data.error || "Move failed");
      }
    } catch (err) {
      console.error("💥 Failed to move player:", err);
      setError("Failed to move player");
    } finally {
      setLoading(false);
    }
  };

  // Mine at current position
  const minePlayer = async () => {
    if (!canPlay || !jwtToken) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/mine`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwtToken}`,
        },
        body: JSON.stringify({}),
      });

      const data = await response.json();

      if (data.success) {
        setPlayerMap(prevMap =>
          prevMap
            ? {
                ...prevMap,
                localView: data.localView,
                score: data.totalScore,
                movesRemaining: data.movesRemaining,
                minesRemaining: data.minesRemaining,
              }
            : null,
        );
        fetchAllPlayers();
      } else if (response.status === 401 || response.status === 403) {
        setIsAuthenticated(false);
        setJwtToken(null);
        const tokenKey = `gameJwtToken_${API_BASE}_${gameId}`;
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(tokenKey);
        }
        setError("Authentication expired. Please sign in again.");
      } else {
        setError(data.error || "Mining failed");
      }
    } catch (err) {
      console.error("💥 Failed to mine:", err);
      setError("Failed to mine");
    } finally {
      setLoading(false);
    }
  };

  // Helper functions
  const getTileColor = (tileType: number) => {
    switch (tileType) {
      case 1:
        return "bg-green-200"; // Common
      case 2:
        return "bg-blue-200"; // Uncommon
      case 3:
        return "bg-purple-200"; // Rare
      default:
        return "bg-gray-200";
    }
  };

  const getDirectionFromPosition = (rowIndex: number, colIndex: number): string | null => {
    const directions = [
      ["northwest", "north", "northeast"],
      ["west", "", "east"],
      ["southwest", "south", "southeast"],
    ];
    return directions[rowIndex][colIndex] || null;
  };

  // Poll for updates every 1 second - only when game is closed but not finished
  useEffect(() => {
    console.log("⏰ Setting up polling interval...");
    console.log("Game closed status:", hasClosed);
    console.log("Has paid out:", hasPaidOut);

    if (!hasClosed) {
      console.log("⏸️ Game not closed yet, skipping API calls");
      return;
    }

    if (hasPaidOut) {
      console.log("🎉 Game finished with payout, stopping API calls");
      return;
    }

    fetchGameStatus();
    fetchAllPlayers();

    const interval = setInterval(() => {
      fetchGameStatus();
      fetchAllPlayers();
      if (canPlay) {
        fetchPlayerMap();
      }
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [canPlay, fetchPlayerMap, hasClosed, hasPaidOut]);

  // Fetch player map when authentication and player status change
  useEffect(() => {
    if (canPlay) {
      fetchPlayerMap();
    }
  }, [canPlay, fetchPlayerMap]);

  if (!gameInfo) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg"></div>
          <p className="mt-4">Loading game #{gameId}...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Confetti Animation */}
      {showConfetti && typeof window !== "undefined" && (
        <Confetti
          width={window.innerWidth}
          height={window.innerHeight}
          recycle={false}
          numberOfPieces={200}
          gravity={0.3}
        />
      )}

      <div className="flex items-center flex-col grow pt-10">
        <div className="px-5 w-full max-w-4xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-4xl font-bold mb-2">Game #{gameId}</h1>
            </div>
            <button className="btn btn-ghost" onClick={() => router.push("/")}>
              ← Back to Games
            </button>
          </div>

          {/* Game Finished - Payout Display */}
          {hasPaidOut && winners && winners.length > 0 && (
            <div className="bg-gradient-to-r from-green-50 to-blue-50 border-2 border-green-300 rounded-lg p-6 mb-6 shadow-lg">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-green-800 mb-4">🎉 Game Finished! 🎉</h2>
                <p className="text-lg text-gray-700 mb-4">
                  Payout of <span className="font-bold text-green-600">{formatEther(payoutAmount)} ETH</span> each
                </p>

                <div className="space-y-3">
                  <h3 className="text-xl font-semibold text-gray-800">Winners:</h3>
                  {winners.map((winner, index) => {
                    const isConnectedUser = connectedAddress && winner.toLowerCase() === connectedAddress.toLowerCase();
                    return (
                      <div
                        key={`${winner}-${index}`}
                        className={`p-3 rounded-lg border-2 ${
                          isConnectedUser
                            ? "bg-yellow-100 border-yellow-400 font-bold text-yellow-800"
                            : "bg-white border-gray-200"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <Address address={winner} />
                          <span
                            className={`text-lg font-bold ${isConnectedUser ? "text-yellow-600" : "text-green-600"}`}
                          >
                            {formatEther(payoutAmount)} ETH
                            {isConnectedUser && " 🏆"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 text-sm text-gray-600">
                  <p>Payout completed successfully!</p>
                </div>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="alert alert-error mb-4">
              <span>{error}</span>
              <button className="btn btn-sm" onClick={() => setError(null)}>
                ×
              </button>
            </div>
          )}

          {/* No wallet connected */}
          {!connectedAddress && (
            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm text-blue-700">
                    Connect your wallet to see if you&apos;re registered as a player in this game.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Wallet connected but no ETH */}
          {connectedAddress && !hasEth && (
            <div className="bg-red-50 border-l-4 border-red-400 p-6 rounded mb-6">
              <div className="flex flex-col items-center text-center space-y-4">
                <p className="text-lg font-semibold text-red-800 mb-2">Your wallet doesn&apos;t have any ETH</p>
                <p className="text-sm text-red-700 mb-4">Please send some ETH to this address:</p>

                {/* QR Code */}
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <QRCodeSVG value={connectedAddress} size={200} />
                </div>

                {/* Address */}
                <div className="mt-4">
                  <Address address={connectedAddress} />
                </div>
              </div>
            </div>
          )}

          {/* JOIN GAME - Top priority call-to-action for non-players with ETH */}
          {connectedAddress && hasEth && !isPlayer && (
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-300 rounded-lg p-6 mb-6 shadow-lg">
              <div className="flex flex-col items-center text-center space-y-4">
                {gameIsOpen ? (
                  <>
                    <button
                      className={`btn btn-primary btn-lg ${loading ? "loading" : ""}`}
                      onClick={joinGame}
                      disabled={loading || !gameIsOpen}
                    >
                      {loading ? "Joining Game..." : `🚀 Join Game (${formatEther(stakeAmount || 0n)} ETH)`}
                    </button>
                  </>
                ) : (
                  <>
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">
                      ⏳ Waiting for gamemaster to open the game...
                    </h2>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Game Status - Show prominently at top when player is not authenticated */}
          {connectedAddress && isPlayer && hasEth && !isAuthenticated && (
            <div className="bg-base-100 rounded-lg p-6 mb-6 shadow-lg border-2 border-primary">
              {!hasClosed ? (
                <>
                  <h2 className="text-2xl font-bold mb-4 text-center">⏳ Waiting for Game to Start</h2>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-bold mb-4 text-center">🔐 Authentication Required</h2>
                  <div className="flex flex-col items-center space-y-4">
                    <button
                      className={`btn btn-primary btn-lg ${authLoading ? "loading" : ""}`}
                      onClick={signIn}
                      disabled={authLoading || !connectedAddress || !isPlayer}
                    >
                      {authLoading ? "Signing In..." : "🔑 Sign In to Play"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Game Creator Controls - Show right after game status if user is creator and game hasn't closed */}
          {isCreator && !hasClosed && (
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-2 border-purple-300 rounded-lg p-6 mb-6 shadow-lg">
              <div className="flex flex-col items-center space-y-4">
                {/* Action buttons */}
                {hasOpened && !hasClosed && (
                  <button
                    className={`btn btn-primary btn-lg ${loading ? "loading" : ""}`}
                    onClick={closeGame}
                    disabled={loading || !playerCount || playerCount === 0n}
                  >
                    {loading ? "Starting..." : "🚀 Start Game"}
                  </button>
                )}

                {/* Status messages */}
                {hasClosed && (
                  <div className="text-center p-3 bg-gray-100 rounded-lg">
                    <p className="text-gray-700 font-medium">Game has been closed permanently</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Player's Game Interface - Map at top when authenticated */}
          {canPlay && playerMap && (
            <div className="bg-base-100 rounded-lg p-6 shadow-lg mb-6">
              <h2 className="text-xl font-bold mb-4">Your Game View</h2>

              {/* Interactive 3x3 Map Grid */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3 text-center">
                  Score: {playerMap.score ?? 0} | Moves: {playerMap.movesRemaining ?? 0} | Mines:{" "}
                  {playerMap.minesRemaining ?? 0} | Position: ({playerMap.position.x}, {playerMap.position.y})
                </h3>
                <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
                  {playerMap.localView.map((row, rowIndex) =>
                    row.map((cell, colIndex) => {
                      const direction = getDirectionFromPosition(rowIndex, colIndex);
                      const isClickable = cell && !cell.player && direction;
                      const isPlayerTile = cell?.player;
                      const canMine = isPlayerTile && (playerMap.minesRemaining ?? 0) > 0;

                      return (
                        <div
                          key={`${rowIndex}-${colIndex}`}
                          className={`
                            w-20 h-20 border-2 border-gray-400 flex items-center justify-center text-sm font-semibold
                            relative transition-all duration-200
                            ${cell ? getTileColor(cell.tile) : "bg-gray-100"}
                            ${cell?.player ? "ring-4 ring-yellow-400" : ""}
                            ${isClickable ? "cursor-pointer hover:brightness-110 hover:scale-105 hover:border-blue-500 hover:shadow-lg" : ""}
                            ${canMine ? "cursor-pointer hover:brightness-110 hover:scale-105 hover:border-green-500 hover:shadow-lg" : ""}
                            ${loading ? "opacity-50" : ""}
                          `}
                          onClick={() => {
                            if (loading || !canPlay) return;
                            if (isClickable) {
                              movePlayer(direction);
                            } else if (canMine) {
                              minePlayer();
                            }
                          }}
                          title={
                            isClickable
                              ? `Move ${direction}`
                              : canMine
                                ? `Mine here for ${cell.tile === 1 ? "1" : cell.tile === 2 ? "5" : "10"} points`
                                : cell?.player
                                  ? (playerMap.minesRemaining ?? 0) > 0
                                    ? "Click to mine"
                                    : "No mines remaining"
                                  : "Cannot move here"
                          }
                        >
                          {cell ? (
                            <div className="text-center">
                              <div>{cell.tile}</div>
                              {cell.player && (
                                <div className="text-yellow-600">
                                  {(playerMap.minesRemaining ?? 0) > 0 ? "⛏️" : "👤"}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}

                          {/* Subtle directional indicator for clickable tiles */}
                          {isClickable && (
                            <div className="absolute top-1 right-1 text-xs opacity-60">
                              {direction === "northwest" && "↖"}
                              {direction === "north" && "↑"}
                              {direction === "northeast" && "↗"}
                              {direction === "west" && "←"}
                              {direction === "east" && "→"}
                              {direction === "southwest" && "↙"}
                              {direction === "south" && "↓"}
                              {direction === "southeast" && "↘"}
                            </div>
                          )}

                          {/* Mine indicator for player tile */}
                          {canMine && <div className="absolute top-1 left-1 text-xs opacity-80 text-green-600">⛏️</div>}
                        </div>
                      );
                    }),
                  )}
                </div>
                <p className="text-center text-sm text-gray-600 mt-2">
                  Click on adjacent tiles to move • Click your position (⛏️) to mine for points
                </p>
              </div>

              {/* Legend */}
              <div className="text-center">
                <h3 className="text-lg font-semibold mb-2">Land Types</h3>
                <div className="flex justify-center space-x-4 text-sm">
                  <span className="flex items-center">
                    <div className="w-4 h-4 bg-green-200 border mr-1"></div>1 = Common
                  </span>
                  <span className="flex items-center">
                    <div className="w-4 h-4 bg-blue-200 border mr-1"></div>2 = Uncommon
                  </span>
                  <span className="flex items-center">
                    <div className="w-4 h-4 bg-purple-200 border mr-1"></div>3 = Rare
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Authentication Status - Show below map when authenticated */}
          {connectedAddress && isPlayer && hasEth && isAuthenticated && (
            <div className="bg-green-50 border-l-4 border-green-400 p-4 rounded mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="text-green-600 font-semibold">✅ Authenticated</span>
                  <span className="text-sm text-green-700">Ready to play!</span>
                </div>
                <button className="btn btn-outline btn-sm" onClick={signOut}>
                  Sign Out
                </button>
              </div>
            </div>
          )}

          {/* Players List - Consolidated */}
          {(allPlayers.length > 0 || (contractPlayers && contractPlayers.length > 0)) && (
            <div className="bg-base-100 rounded-lg p-6 mb-6 shadow-lg">
              <h2 className="text-xl font-bold mb-4">Players ({contractPlayers?.length || allPlayers.length})</h2>
              <div className="space-y-3">
                {allPlayers.length > 0
                  ? allPlayers.map(player => (
                      <div key={player.address} className="p-4 bg-base-200 rounded-lg">
                        <div className="flex justify-between items-start mb-2">
                          <Address address={player.address} />
                          <div className="flex items-center space-x-2">
                            {connectedAddress && player.address.toLowerCase() === connectedAddress.toLowerCase() && (
                              <span className="badge badge-primary">You</span>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                          <div>
                            <span className="text-gray-600">Position:</span>
                            <span className="ml-1 font-semibold">
                              ({player.position.x}, {player.position.y})
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-600">Score:</span>
                            <span className="ml-1 font-semibold text-green-600">{player.score ?? 0}</span>
                          </div>
                          <div>
                            <span className="text-gray-600">Moves:</span>
                            <span className="ml-1 font-semibold text-blue-600">{player.movesRemaining ?? 0}</span>
                          </div>
                          <div>
                            <span className="text-gray-600">Mines:</span>
                            <span className="ml-1 font-semibold text-orange-600">{player.minesRemaining ?? 0}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  : contractPlayers?.map((playerAddress, index) => (
                      <div key={`${playerAddress}-${index}`} className="p-4 bg-base-200 rounded-lg">
                        <div className="flex justify-between items-start mb-2">
                          <Address address={playerAddress} />
                          <div className="flex items-center space-x-2">
                            <span className="px-2 py-1 rounded text-xs bg-gray-200">Joined</span>
                            {connectedAddress && playerAddress.toLowerCase() === connectedAddress.toLowerCase() && (
                              <span className="badge badge-primary">You</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
              </div>
            </div>
          )}

          {/* Game Info */}
          <div className="bg-base-100 rounded-lg p-6 shadow-lg mb-6">
            <h2 className="text-2xl font-bold mb-4">Game Information</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-gray-600 mb-1">Gamemaster</p>
                <Address address={gamemaster} />
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Creator</p>
                <Address address={creator} />
                {isCreator && (
                  <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">You</span>
                )}
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Stake Amount</p>
                <p className="text-xl font-bold text-blue-600">{formatEther(stakeAmount || 0n)} ETH</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Players Joined</p>
                <p className="text-xl font-bold text-purple-600">{playerCount?.toString() || 0}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Status</p>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    open ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {open ? "Open" : "Closed"}
                </span>
              </div>
              {(hasCommitted || hasRevealed) && (
                <div>
                  <p className="text-sm text-gray-600 mb-1">Commit-Reveal</p>
                  <div
                    className="cursor-help"
                    title={
                      hasRevealed
                        ? `Hash committed at block ${commitBlockNumber} - Revealed random hash: ${randomHash}`
                        : hasCommitted
                          ? `Hash committed: ${committedHash} (Block: ${commitBlockNumber}) - Waiting for reveal`
                          : "No commit yet"
                    }
                  >
                    {hasRevealed ? (
                      <span className="text-green-600">✅ Hash revealed: {randomHash?.slice(0, 12)}...</span>
                    ) : hasCommitted ? (
                      <span className="text-yellow-600">Hash committed, waiting for reveal.</span>
                    ) : (
                      <span className="text-gray-600">❌ Not Committed</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Share Game */}
          <div className="bg-base-100 rounded-lg p-6 shadow-lg mb-6">
            <h2 className="text-2xl font-bold mb-4">Share Game</h2>
            <div className="flex flex-col items-center space-y-4">
              {/* QR Code */}
              <div className="bg-white p-4 rounded-lg shadow-sm">
                <QRCodeSVG value={typeof window !== "undefined" ? window.location.href : ""} size={180} />
              </div>

              {/* URL with Copy Button */}
              <div className="flex items-center space-x-2 bg-gray-50 p-3 rounded-lg w-full max-w-md">
                <span className="text-sm text-gray-700 truncate flex-1">
                  {typeof window !== "undefined" ? window.location.href : ""}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      navigator.clipboard.writeText(window.location.href).then(() => {
                        // You could add a toast notification here if you have one
                        console.log("URL copied to clipboard!");
                      });
                    }
                  }}
                  title="Copy URL"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

const GamePage: NextPage = () => {
  return (
    <ClientOnlyWrapper
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="loading loading-spinner loading-lg"></div>
            <p className="mt-4">Loading game...</p>
          </div>
        </div>
      }
    >
      <GamePageContent />
    </ClientOnlyWrapper>
  );
};

export default GamePage;
