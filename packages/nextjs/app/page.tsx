"use client";

import { useCallback, useEffect, useState } from "react";
import type { NextPage } from "next";
import { QRCodeSVG } from "qrcode.react";
import Confetti from "react-confetti";
import { formatEther, parseEther } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { ClientOnlyWrapper } from "~~/components/ClientOnlyWrapper";
import { Address } from "~~/components/scaffold-eth";
import { useScaffoldEventHistory, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useWatchBalance } from "~~/hooks/scaffold-eth/useWatchBalance";

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

interface PayoutEventData {
  winners: string[];
  amountPerWinner: bigint;
  blockNumber: bigint;
  transactionHash: string;
}

const API_BASE = "https://slop.computer:8000";

const GameContent = () => {
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
  const [payoutEvent, setPayoutEvent] = useState<PayoutEventData | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  // Watch balance to check if user has ETH
  const { data: balance } = useWatchBalance({
    address: connectedAddress,
  });

  // Read contract state for game open status
  const { data: contractOpen } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "open",
  });

  // Read contract players list
  const { data: contractPlayers } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "getPlayers",
  });

  // Contract function to join the game
  const { writeContractAsync: writeYourContractAsync } = useScaffoldWriteContract({
    contractName: "YourContract",
  });

  // Watch for PayoutCompleted events using useScaffoldEventHistory
  const { data: payoutEvents } = useScaffoldEventHistory({
    contractName: "YourContract",
    eventName: "PayoutCompleted",
    fromBlock: 0n,
    watch: true,
    blockData: true,
    transactionData: true,
  });

  // Process the latest payout event
  useEffect(() => {
    if (payoutEvents && payoutEvents.length > 0) {
      const latestEvent = payoutEvents[payoutEvents.length - 1];
      console.log("🎉 PayoutCompleted event detected:", latestEvent);

      // Check if latestEvent exists and has required properties
      if (!latestEvent || !latestEvent.args) {
        console.log("❌ No valid event data found");
        return;
      }

      const { winners, amountPerWinner } = latestEvent.args;
      console.log("Winners:", winners);
      console.log("Amount per winner:", amountPerWinner);

      // Ensure we have valid winners array
      if (!winners || !Array.isArray(winners) || winners.length === 0) {
        console.log("❌ No valid winners found in event");
        return;
      }

      // Ensure we have required event metadata
      if (!latestEvent.blockNumber || !latestEvent.transactionHash) {
        console.log("❌ Missing event metadata");
        return;
      }

      const payoutData: PayoutEventData = {
        winners: winners as string[],
        amountPerWinner: amountPerWinner as bigint,
        blockNumber: latestEvent.blockNumber,
        transactionHash: latestEvent.transactionHash,
      };

      setPayoutEvent(payoutData);

      // Check if connected user is a winner
      if (connectedAddress && winners.includes(connectedAddress)) {
        console.log("🎊 Connected user is a winner! Starting confetti...");
        setShowConfetti(true);
        // Auto-hide confetti after 5 seconds
        setTimeout(() => setShowConfetti(false), 5000);
      }
    }
  }, [payoutEvents, connectedAddress]);

  const hasEth = balance && balance.value > 0n;
  const isPlayer = connectedAddress && contractPlayers?.includes(connectedAddress);
  const canPlay = isPlayer && isAuthenticated;
  const gameIsOpen = contractOpen || gameStatus?.open; // Use contract data as primary source, fallback to server data

  // Debug state changes
  useEffect(() => {
    console.log("🔍 State Debug Info:");
    console.log("  - Connected Address:", connectedAddress);
    console.log("  - Is Authenticated:", isAuthenticated);
    console.log("  - Is Player:", isPlayer);
    console.log("  - Can Play:", canPlay);
    console.log("  - Game Status:", gameStatus ? "loaded" : "not loaded");
    console.log("  - JWT Token:", jwtToken ? "present" : "null");
    console.log("  - Game Is Open:", gameIsOpen);
    console.log("  - Contract Open:", contractOpen);
    console.log("  - Contract Players:", contractPlayers);
  }, [
    connectedAddress,
    isAuthenticated,
    isPlayer,
    canPlay,
    gameStatus,
    jwtToken,
    gameIsOpen,
    contractOpen,
    contractPlayers,
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
        "Your address is not registered as a player in this game. You need to join the game first by paying 0.001 ETH.",
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
        const tokenKey = `gameJwtToken_${API_BASE}`;
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
    const tokenKey = `gameJwtToken_${API_BASE}`;
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

    setLoading(true);
    setError(null);

    try {
      console.log("🎮 Attempting to join game...");
      await writeYourContractAsync({
        functionName: "joinGame",
        value: parseEther("0.001"), // 0.001 ETH stake
      });
      console.log("✅ Successfully joined the game!");
      // Refresh game status to update player list
      fetchGameStatus();
    } catch (err) {
      console.error("💥 Failed to join game:", err);
      setError("Failed to join game. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Check for existing token on mount
  useEffect(() => {
    console.log("🔍 Checking for existing token on mount...");
    const tokenKey = `gameJwtToken_${API_BASE}`;
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
  }, []);

  // Fetch game status
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
      console.error("Error details:", {
        name: err instanceof Error ? err.name : "Unknown",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
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
      console.error("Error details:", {
        name: err instanceof Error ? err.name : "Unknown",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  };

  // Fetch player's map view - using useCallback to prevent infinite re-renders
  const fetchPlayerMap = useCallback(async () => {
    console.log("🗺️ Fetching player map...");
    console.log("Can play:", canPlay);
    console.log("Has JWT token:", !!jwtToken);
    console.log("JWT token (first 20 chars):", jwtToken ? jwtToken.substring(0, 20) + "..." : "null");

    if (!canPlay || !jwtToken) {
      console.log("❌ Cannot fetch map - missing requirements");
      return;
    }

    try {
      console.log("📡 Making map request...");
      console.log("Request URL:", `${API_BASE}/map`);
      console.log("Authorization header:", `Bearer ${jwtToken.substring(0, 20)}...`);

      const response = await fetch(`${API_BASE}/map`, {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
        },
      });

      console.log("Map response status:", response.status);
      console.log("Map response headers:", Object.fromEntries(response.headers.entries()));

      const data = await response.json();
      console.log("Map response data:", data);

      if (data.success) {
        console.log("✅ Map data received successfully");
        console.log("Player position:", data.position);
        console.log("Local view dimensions:", data.localView?.length, "x", data.localView?.[0]?.length);
        setPlayerMap(data);
      } else if (response.status === 401) {
        console.log("🔒 Token expired or invalid (401)");
        // Token expired or invalid
        setIsAuthenticated(false);
        setJwtToken(null);
        const tokenKey = `gameJwtToken_${API_BASE}`;
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(tokenKey);
        }
        setError("Authentication expired. Please sign in again.");
      } else if (response.status === 403 && data.error === "Invalid or expired token") {
        console.log("🔒 Token invalid or expired (403)");
        // Token invalid or expired
        setIsAuthenticated(false);
        setJwtToken(null);
        const tokenKey = `gameJwtToken_${API_BASE}`;
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(tokenKey);
        }
        setError("Authentication expired. Please sign in again.");
      } else {
        console.log("❌ Map request failed:", data);
      }
    } catch (err) {
      console.error("💥 Failed to fetch player map:", err);
      console.error("Error details:", {
        name: err instanceof Error ? err.name : "Unknown",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }, [canPlay, jwtToken]);

  // Move player
  const movePlayer = async (direction: string) => {
    console.log("🚶 Attempting to move player...");
    console.log("Direction:", direction);
    console.log("Can play:", canPlay);
    console.log("Has JWT token:", !!jwtToken);

    if (!canPlay || !jwtToken) {
      console.log("❌ Cannot move - missing requirements");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log("📡 Making move request...");
      console.log("Request URL:", `${API_BASE}/move`);
      console.log("Direction payload:", { direction });
      console.log("Authorization header:", `Bearer ${jwtToken.substring(0, 20)}...`);

      const response = await fetch(`${API_BASE}/move`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwtToken}`,
        },
        body: JSON.stringify({ direction }),
      });

      console.log("Move response status:", response.status);
      console.log("Move response headers:", Object.fromEntries(response.headers.entries()));

      const data = await response.json();
      console.log("Move response data:", data);

      if (data.success) {
        console.log("✅ Move successful!");
        console.log("New position:", data.newPosition);
        console.log("New tile:", data.tile);
        console.log("Valid directions:", data.validDirections);

        // Update the map with new position and stats
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
        // Refresh all players to see updated positions
        fetchAllPlayers();
      } else if (response.status === 401) {
        console.log("🔒 Token expired or invalid during move (401)");
        // Token expired or invalid
        setIsAuthenticated(false);
        setJwtToken(null);
        const tokenKey = `gameJwtToken_${API_BASE}`;
        sessionStorage.removeItem(tokenKey);
        setError("Authentication expired. Please sign in again.");
      } else if (response.status === 403 && data.error === "Invalid or expired token") {
        console.log("🔒 Token invalid or expired during move (403)");
        // Token invalid or expired
        setIsAuthenticated(false);
        setJwtToken(null);
        const tokenKey = `gameJwtToken_${API_BASE}`;
        sessionStorage.removeItem(tokenKey);
        setError("Authentication expired. Please sign in again.");
      } else {
        console.log("❌ Move failed:", data);
        setError(data.error || "Move failed");
      }
    } catch (err) {
      console.error("💥 Failed to move player:", err);
      console.error("Error details:", {
        name: err instanceof Error ? err.name : "Unknown",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      setError("Failed to move player");
    } finally {
      setLoading(false);
      console.log("🏁 Move attempt completed");
    }
  };

  // Mine at current position
  const minePlayer = async () => {
    console.log("⛏️ Attempting to mine...");
    console.log("Can play:", canPlay);
    console.log("Has JWT token:", !!jwtToken);

    if (!canPlay || !jwtToken) {
      console.log("❌ Cannot mine - missing requirements");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log("📡 Making mine request...");
      console.log("Request URL:", `${API_BASE}/mine`);
      console.log("Authorization header:", `Bearer ${jwtToken.substring(0, 20)}...`);

      const response = await fetch(`${API_BASE}/mine`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwtToken}`,
        },
        body: JSON.stringify({}),
      });

      console.log("Mine response status:", response.status);
      console.log("Mine response headers:", Object.fromEntries(response.headers.entries()));

      const data = await response.json();
      console.log("Mine response data:", data);

      if (data.success) {
        console.log("✅ Mine successful!");
        console.log("Points earned:", data.pointsEarned);
        console.log("Total score:", data.totalScore);
        console.log("Moves remaining:", data.movesRemaining);
        console.log("Mines remaining:", data.minesRemaining);

        // Update the map with new stats and view
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
        // Refresh all players to see updated stats
        fetchAllPlayers();
      } else if (response.status === 401) {
        console.log("🔒 Token expired or invalid during mine (401)");
        // Token expired or invalid
        setIsAuthenticated(false);
        setJwtToken(null);
        const tokenKey = `gameJwtToken_${API_BASE}`;
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(tokenKey);
        }
        setError("Authentication expired. Please sign in again.");
      } else if (response.status === 403 && data.error === "Invalid or expired token") {
        console.log("🔒 Token invalid or expired during mine (403)");
        // Token invalid or expired
        setIsAuthenticated(false);
        setJwtToken(null);
        const tokenKey = `gameJwtToken_${API_BASE}`;
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(tokenKey);
        }
        setError("Authentication expired. Please sign in again.");
      } else {
        console.log("❌ Mine failed:", data);
        setError(data.error || "Mining failed");
      }
    } catch (err) {
      console.error("💥 Failed to mine:", err);
      console.error("Error details:", {
        name: err instanceof Error ? err.name : "Unknown",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      setError("Failed to mine");
    } finally {
      setLoading(false);
      console.log("🏁 Mine attempt completed");
    }
  };

  // Poll for updates every 2 seconds
  useEffect(() => {
    console.log("⏰ Setting up polling interval...");
    console.log("Can play:", canPlay);

    fetchGameStatus();
    fetchAllPlayers();

    const interval = setInterval(() => {
      console.log("⏰ Polling interval tick...");
      fetchGameStatus();
      fetchAllPlayers();
      if (canPlay) {
        console.log("🔄 Fetching player map in poll");
        fetchPlayerMap();
      }
    }, 2000);

    return () => {
      console.log("⏰ Cleaning up polling interval");
      clearInterval(interval);
    };
  }, [canPlay, fetchPlayerMap]);

  // Fetch player map when authentication and player status change
  useEffect(() => {
    console.log("🎮 Game play status changed, canPlay:", canPlay);
    if (canPlay) {
      console.log("🗺️ Fetching initial player map due to canPlay change");
      fetchPlayerMap();
    }
  }, [canPlay, fetchPlayerMap]);

  // Get tile color based on type
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

  // Get tile name
  const getTileName = (tileType: number) => {
    switch (tileType) {
      case 1:
        return "Common";
      case 2:
        return "Uncommon";
      case 3:
        return "Rare";
      default:
        return "Unknown";
    }
  };

  // Get direction based on tile position relative to center
  const getDirectionFromPosition = (rowIndex: number, colIndex: number): string | null => {
    const directions = [
      ["northwest", "north", "northeast"],
      ["west", "", "east"],
      ["southwest", "south", "southeast"],
    ];
    return directions[rowIndex][colIndex] || null;
  };

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
          {/* Game Finished - Payout Display */}
          {payoutEvent && (
            <div className="bg-gradient-to-r from-green-50 to-blue-50 border-2 border-green-300 rounded-lg p-6 mb-6 shadow-lg">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-green-800 mb-4">🎉 Game Finished! 🎉</h2>
                <p className="text-lg text-gray-700 mb-4">
                  Payout of{" "}
                  <span className="font-bold text-green-600">{formatEther(payoutEvent.amountPerWinner)} ETH</span> each
                </p>

                <div className="space-y-3">
                  <h3 className="text-xl font-semibold text-gray-800">Winners:</h3>
                  {payoutEvent.winners?.map((winner, index) => {
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
                            {formatEther(payoutEvent.amountPerWinner)} ETH
                            {isConnectedUser && " 🏆"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 text-sm text-gray-600">
                  <p>Block: {payoutEvent.blockNumber.toString()}</p>
                  <p>Transaction: {payoutEvent.transactionHash}</p>
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

          {/* Player's Game Interface - Map at top when authenticated */}
          {canPlay && playerMap && (
            <div className="bg-base-100 rounded-lg p-6 shadow-lg mb-6">
              <h2 className="text-xl font-bold mb-4">Your Game View</h2>

              {/* Player Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 text-center">
                <div className="bg-base-200 rounded-lg p-3">
                  <p className="text-sm text-gray-600">Score</p>
                  <p className="text-xl font-bold text-green-600">{playerMap.score ?? 0}</p>
                </div>
                <div className="bg-base-200 rounded-lg p-3">
                  <p className="text-sm text-gray-600">Moves Left</p>
                  <p className="text-xl font-bold text-blue-600">{playerMap.movesRemaining ?? 0}</p>
                </div>
                <div className="bg-base-200 rounded-lg p-3">
                  <p className="text-sm text-gray-600">Mines Left</p>
                  <p className="text-xl font-bold text-orange-600">{playerMap.minesRemaining ?? 0}</p>
                </div>
                <div className="bg-base-200 rounded-lg p-3">
                  <p className="text-sm text-gray-600">Position</p>
                  <p className="text-xl font-bold text-purple-600">
                    ({playerMap.position.x}, {playerMap.position.y})
                  </p>
                </div>
              </div>

              {/* Interactive 3x3 Map Grid */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3 text-center">Local View (Click to Move)</h3>
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

          {/* Authentication Status - Only show for players */}
          {connectedAddress && isPlayer && hasEth && (
            <div className="bg-base-100 rounded-lg p-6 mb-6 shadow-lg">
              <h2 className="text-xl font-bold mb-4">Authentication Status</h2>
              <div className="flex flex-col items-center space-y-4">
                <div className="flex items-center space-x-4">
                  <span className="font-semibold">Status:</span>
                  <span
                    className={`px-3 py-1 rounded-full text-sm ${
                      isAuthenticated ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                    }`}
                  >
                    {isAuthenticated ? "Authenticated" : "Not Authenticated"}
                  </span>
                </div>

                {!isAuthenticated && (
                  <>
                    <button
                      className={`btn btn-primary ${authLoading ? "loading" : ""}`}
                      onClick={signIn}
                      disabled={authLoading || !connectedAddress || !isPlayer}
                    >
                      {authLoading ? "Signing In..." : "Sign In to Play"}
                    </button>
                    <p className="text-sm text-gray-600 text-center">
                      You need to sign a message with your wallet to authenticate and play the game.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Game Status - Always show when available */}
          {(gameStatus || contractPlayers) && (
            <div className="bg-base-100 rounded-lg p-6 mb-6 shadow-lg">
              <h2 className="text-xl font-bold mb-4">Game Status</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <p className="font-semibold">Game Loaded:</p>
                  <p className={gameStatus?.gameLoaded ? "text-green-600" : "text-red-600"}>
                    {gameStatus?.gameLoaded ? "Yes" : "No"}
                  </p>
                </div>
                <div>
                  <p className="font-semibold">Map Size:</p>
                  <p>
                    {gameStatus?.mapSize}x{gameStatus?.mapSize}
                  </p>
                </div>
                <div>
                  <p className="font-semibold">Total Players:</p>
                  <p>{contractPlayers?.length || gameStatus?.totalPlayers || 0}</p>
                </div>
                <div>
                  <p className="font-semibold">You are a player:</p>
                  <p className={isPlayer ? "text-green-600" : "text-red-600"}>{isPlayer ? "Yes" : "No"}</p>
                </div>
                <div>
                  <p className="font-semibold">Can play:</p>
                  <p className={canPlay ? "text-green-600" : "text-red-600"}>{canPlay ? "Yes" : "No"}</p>
                </div>
              </div>
            </div>
          )}

          {/* All Players List - Always show when available */}
          {(allPlayers.length > 0 || (contractPlayers && contractPlayers.length > 0)) && (
            <div className="bg-base-100 rounded-lg p-6 mb-6 shadow-lg">
              <h2 className="text-xl font-bold mb-4">All Players ({contractPlayers?.length || allPlayers.length})</h2>
              <div className="space-y-3">
                {allPlayers.length > 0
                  ? allPlayers.map(player => (
                      <div key={player.address} className="p-4 bg-base-200 rounded-lg">
                        <div className="flex justify-between items-start mb-2">
                          <Address address={player.address} />
                          <span className={`px-2 py-1 rounded text-xs ${getTileColor(player.tile)}`}>
                            {getTileName(player.tile)}
                          </span>
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
                  : contractPlayers?.map(playerAddress => (
                      <div key={playerAddress} className="p-4 bg-base-200 rounded-lg">
                        <div className="flex justify-between items-start mb-2">
                          <Address address={playerAddress} />
                          <span className="px-2 py-1 rounded text-xs bg-gray-200">Joined</span>
                        </div>
                        <div className="text-sm text-gray-600">
                          <p>Game server data not available - showing contract players only</p>
                        </div>
                      </div>
                    ))}
              </div>
            </div>
          )}

          {/* Instructions for players who have bought in but game hasn't started */}
          {connectedAddress && hasEth && isPlayer && !canPlay && (
            <div className="bg-green-50 border-l-4 border-green-400 p-6 rounded mb-6">
              <div className="flex flex-col items-center text-center space-y-4">
                <p className="text-lg font-semibold text-green-800 mb-2">✅ You have bought in!</p>
                <p className="text-sm text-green-700">
                  You have successfully paid 0.001 ETH and joined the game. You are waiting for the game to start.
                </p>
                <p className="text-sm text-green-600">
                  Once the game server is ready, you can authenticate and start playing.
                </p>
              </div>
            </div>
          )}

          {/* Instructions for non-players with ETH */}
          {connectedAddress && hasEth && !isPlayer && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-6 rounded mb-6">
              <div className="flex flex-col items-center text-center space-y-4">
                {gameIsOpen ? (
                  <>
                    <p className="text-lg font-semibold text-yellow-800 mb-2">Join the Game</p>
                    <p className="text-sm text-yellow-700 mb-4">The game is open! You can join by staking 0.001 ETH.</p>
                    <button
                      className={`btn btn-primary ${loading ? "loading" : ""}`}
                      onClick={joinGame}
                      disabled={loading || !gameIsOpen}
                    >
                      {loading ? "Joining Game..." : "Join Game (0.001 ETH)"}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-semibold text-yellow-800 mb-2">Game Not Open</p>
                    <p className="text-sm text-yellow-700">
                      The game is not currently open for new players. Check back later or contact the game
                      administrator.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Sign Out Button - At the bottom for authenticated players */}
          {connectedAddress && isPlayer && isAuthenticated && (
            <div className="flex justify-center mt-8">
              <button className="btn btn-outline btn-sm" onClick={signOut}>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

const Home: NextPage = () => {
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
      <GameContent />
    </ClientOnlyWrapper>
  );
};

export default Home;
