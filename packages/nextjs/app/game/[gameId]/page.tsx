"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DeterministicDice, GameLandGenerator, PlayerPositionGenerator } from "deterministic-map";
import type { NextPage } from "next";
import { QRCodeSVG } from "qrcode.react";
import Confetti from "react-confetti";
import { formatEther } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { ClientOnlyWrapper } from "~~/components/ClientOnlyWrapper";
import { Address } from "~~/components/scaffold-eth";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useWatchBalance } from "~~/hooks/scaffold-eth/useWatchBalance";

const API_BASE = "https://slop.computer:8000";
//const API_BASE = "http://localhost:8000";

// Heavy debug flag - set to true to log all server communications
const heavyDebug = true;

// Map data persistence - 10 minutes
const MAP_DATA_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// Types for the game API responses
interface GameStatus {
  success: boolean;
  gameId: string;
  activeGames: string[];
  gameLoaded: boolean;
  totalPlayers: number;
  players: string[];
  serverTime: string;
  timer: {
    active: boolean;
    duration: number;
    timeRemaining: number;
    timeElapsed: number;
    startTime: number;
  };
}

interface MapTile {
  tile: number | string;
  player: boolean;
  coordinates: { x: number; y: number };
}

interface MapResponse {
  success: boolean;
  player: string;
  localView: MapTile[][];
  position: { x: number; y: number };
  score: number;
  movesRemaining: number;
  minesRemaining: number;
  timeRemaining: number;
  legend: Record<string, string>;
}

interface PlayerInfo {
  address: string;
  score: number;
  movesRemaining: number;
  minesRemaining: number;
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
  timeRemaining?: number;
}

interface StoredMapData {
  data: Array<[string, number | string]>;
  timestamp: number;
}

interface StoredTokenData {
  token: string;
  timestamp: number;
}

// Helper functions for localStorage operations
const getStorageKey = (contractAddress: string, gameId: number, dataType: "discovered" | "original" | "jwt") => {
  return `gameMap_${contractAddress}_${gameId}_${dataType}`;
};

const saveMapToStorage = (
  contractAddress: string,
  gameId: number,
  dataType: "discovered" | "original",
  mapData: Map<string, number | string>,
) => {
  if (typeof window === "undefined") return;

  try {
    const storageData: StoredMapData = {
      data: Array.from(mapData.entries()),
      timestamp: Date.now(),
    };

    const key = getStorageKey(contractAddress, gameId, dataType);
    localStorage.setItem(key, JSON.stringify(storageData));
    console.log(`💾 Saved ${dataType} map data to localStorage:`, key, `(${mapData.size} tiles)`);
  } catch (error) {
    console.error(`Failed to save ${dataType} map data to localStorage:`, error);
  }
};

const loadMapFromStorage = (
  contractAddress: string,
  gameId: number,
  dataType: "discovered" | "original",
): Map<string, number | string> => {
  if (typeof window === "undefined") return new Map();

  try {
    const key = getStorageKey(contractAddress, gameId, dataType);
    const stored = localStorage.getItem(key);

    if (!stored) {
      console.log(`📭 No stored ${dataType} map data found for:`, key);
      return new Map();
    }

    const storageData: StoredMapData = JSON.parse(stored);
    const now = Date.now();

    // Check if data has expired (10 minutes)
    if (now - storageData.timestamp > MAP_DATA_EXPIRY_MS) {
      console.log(`⏰ Stored ${dataType} map data expired, clearing:`, key);
      localStorage.removeItem(key);
      return new Map();
    }

    const restoredMap = new Map(storageData.data);
    console.log(
      `✅ Loaded ${dataType} map data from localStorage:`,
      key,
      `(${restoredMap.size} tiles, ${Math.round((now - storageData.timestamp) / 1000)}s old)`,
    );
    return restoredMap;
  } catch (error) {
    console.error(`Failed to load ${dataType} map data from localStorage:`, error);
    return new Map();
  }
};

const saveTokenToStorage = (contractAddress: string, gameId: number, token: string) => {
  if (typeof window === "undefined") return;

  try {
    const storageData: StoredTokenData = {
      token,
      timestamp: Date.now(),
    };

    const key = getStorageKey(contractAddress, gameId, "jwt");
    localStorage.setItem(key, JSON.stringify(storageData));
    console.log(`💾 Saved JWT token to localStorage:`, key);
  } catch (error) {
    console.error("Failed to save JWT token to localStorage:", error);
  }
};

const loadTokenFromStorage = (contractAddress: string, gameId: number): string | null => {
  if (typeof window === "undefined") return null;

  try {
    const key = getStorageKey(contractAddress, gameId, "jwt");
    const stored = localStorage.getItem(key);

    if (!stored) {
      console.log(`📭 No stored JWT token found for:`, key);
      return null;
    }

    const storageData: StoredTokenData = JSON.parse(stored);
    const now = Date.now();

    // Check if token has expired (10 minutes)
    if (now - storageData.timestamp > MAP_DATA_EXPIRY_MS) {
      console.log(`⏰ Stored JWT token expired, clearing:`, key);
      localStorage.removeItem(key);
      return null;
    }

    console.log(
      `✅ Loaded JWT token from localStorage:`,
      key,
      `(${Math.round((now - storageData.timestamp) / 1000)}s old)`,
    );
    return storageData.token;
  } catch (error) {
    console.error("Failed to load JWT token from localStorage:", error);
    return null;
  }
};

const removeTokenFromStorage = (contractAddress: string, gameId: number) => {
  if (typeof window === "undefined") return;

  try {
    const key = getStorageKey(contractAddress, gameId, "jwt");
    localStorage.removeItem(key);
    console.log(`🗑️ Removed JWT token from localStorage:`, key);
  } catch (error) {
    console.error("Failed to remove JWT token from localStorage:", error);
  }
};

const cleanupExpiredMapData = () => {
  if (typeof window === "undefined") return;

  try {
    const now = Date.now();
    const keysToRemove: string[] = [];

    // Check all localStorage keys for expired game data (maps and JWT tokens)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("gameMap_")) {
        try {
          const stored = localStorage.getItem(key);
          if (stored) {
            // Try to parse as either map data or token data
            const storageData = JSON.parse(stored);
            if (storageData.timestamp && now - storageData.timestamp > MAP_DATA_EXPIRY_MS) {
              keysToRemove.push(key);
            }
          }
        } catch {
          // Invalid data, mark for removal
          keysToRemove.push(key);
        }
      }
    }

    // Remove expired data
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
      console.log(`🗑️ Cleaned up expired game data:`, key);
    });

    if (keysToRemove.length > 0) {
      console.log(`🧹 Cleaned up ${keysToRemove.length} expired game data entries`);
    }
  } catch (error) {
    console.error("Failed to cleanup expired game data:", error);
  }
};

const GamePageContent = () => {
  const params = useParams();
  const router = useRouter();
  const gameId = parseInt(params?.gameId as string);
  const { address: connectedAddress } = useAccount();
  const { signMessageAsync } = useSignMessage();

  // Get contract info for storage namespacing
  const { data: contractInfo } = useDeployedContractInfo("YourContract");
  const contractAddress = contractInfo?.address || "unknown";

  const [gameStatus, setGameStatus] = useState<GameStatus | null>(null);
  const [playerMap, setPlayerMap] = useState<MapResponse | null>(null);
  const [allPlayers, setAllPlayers] = useState<PlayerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Authentication state
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  // Join game debounce state
  const [joinGameLoading, setJoinGameLoading] = useState(false);

  // Start game debounce state
  const [startGameLoading, setStartGameLoading] = useState(false);

  // Payout event state
  const [showConfetti, setShowConfetti] = useState(false);

  // Timer state
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  // Track recent moves to prevent polling conflicts
  const [recentMoveTimestamp, setRecentMoveTimestamp] = useState<number | null>(null);

  // Use ref to access current recentMoveTimestamp without causing useCallback recreation
  const recentMoveTimestampRef = useRef<number | null>(null);
  const timeRemainingRef = useRef<number | null>(null);

  // Update refs when state changes
  useEffect(() => {
    recentMoveTimestampRef.current = recentMoveTimestamp;
  }, [recentMoveTimestamp]);

  useEffect(() => {
    timeRemainingRef.current = timeRemaining;
  }, [timeRemaining]);

  // Radar/Map state - track discovered tiles (with localStorage persistence)
  const [discoveredTiles, setDiscoveredTiles] = useState<Map<string, number | string>>(() => {
    // Initialize from localStorage if available
    if (contractAddress !== "unknown") {
      return loadMapFromStorage(contractAddress, gameId, "discovered");
    }
    return new Map();
  });

  // Track original (non-mined) tile values for map verification (with localStorage persistence)
  const [originalDiscoveredTiles, setOriginalDiscoveredTiles] = useState<Map<string, number | string>>(() => {
    // Initialize from localStorage if available
    if (contractAddress !== "unknown") {
      return loadMapFromStorage(contractAddress, gameId, "original");
    }
    return new Map();
  });

  // Load from localStorage when contract address becomes available
  useEffect(() => {
    if (contractAddress !== "unknown") {
      console.log(`🔄 Contract address available, loading map data for contract: ${contractAddress}`);

      // Clean up any expired data first
      cleanupExpiredMapData();

      // Load discovered tiles
      const loadedDiscovered = loadMapFromStorage(contractAddress, gameId, "discovered");
      if (loadedDiscovered.size > 0) {
        setDiscoveredTiles(loadedDiscovered);
      }

      // Load original tiles
      const loadedOriginal = loadMapFromStorage(contractAddress, gameId, "original");
      if (loadedOriginal.size > 0) {
        setOriginalDiscoveredTiles(loadedOriginal);
      }

      // Load JWT token
      const loadedToken = loadTokenFromStorage(contractAddress, gameId);
      if (loadedToken) {
        setJwtToken(loadedToken);
        setIsAuthenticated(true);
        console.log("✅ Restored JWT authentication from localStorage");
      }
    }
  }, [contractAddress, gameId]);

  // Save discovered tiles to localStorage when they change
  useEffect(() => {
    if (contractAddress !== "unknown" && discoveredTiles.size > 0) {
      saveMapToStorage(contractAddress, gameId, "discovered", discoveredTiles);
    }
  }, [discoveredTiles, contractAddress, gameId]);

  // Save original discovered tiles to localStorage when they change
  useEffect(() => {
    if (contractAddress !== "unknown" && originalDiscoveredTiles.size > 0) {
      saveMapToStorage(contractAddress, gameId, "original", originalDiscoveredTiles);
    }
  }, [originalDiscoveredTiles, contractAddress, gameId]);

  // Watch balance to check if user has ETH
  const { data: balance } = useWatchBalance({
    address: connectedAddress,
  });

  // COMPREHENSIVE CONTRACT CALL - Get all game data in a single call
  const { data: fullGameState } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "getFullGameState",
    args: [BigInt(gameId), connectedAddress || "0x0000000000000000000000000000000000000000"],
  });

  // Contract write functions
  const { writeContractAsync: writeYourContractAsync } = useScaffoldWriteContract({
    contractName: "YourContract",
  });

  // Game state derived from comprehensive contract data - cast to any to bypass TypeScript issues
  const gameState = fullGameState as any;

  // Game state derived from comprehensive contract data
  const gamemaster = gameState?.[0] as string | undefined;
  const creator = gameState?.[1] as string | undefined;
  const stakeAmount = gameState?.[2] as bigint | undefined;
  const open = gameState?.[3] as boolean | undefined;
  const playerCount = gameState?.[4] as bigint | undefined;
  const hasOpened = gameState?.[5] as boolean | undefined;
  const hasClosed = gameState?.[6] as boolean | undefined;

  // Players array from comprehensive contract data
  const contractPlayers = useMemo(() => (gameState?.[7] as string[] | undefined) || [], [gameState]);

  // Commit-reveal state from comprehensive contract data
  const committedHash = gameState?.[8] as string | undefined;
  const commitBlockNumber = gameState?.[9] as bigint | undefined;
  // revealValue = gameState?.[10] (available but not currently used)
  const randomHash = gameState?.[11] as string | undefined;
  const hasCommitted = (gameState?.[12] as boolean | undefined) || false;
  const hasRevealed = (gameState?.[13] as boolean | undefined) || false;
  // hasStoredBlockHash = gameState?.[14] (available but not currently used)
  const contractMapSize = gameState?.[15] as bigint | undefined;

  // Payout state from comprehensive contract data
  const winners = useMemo(() => (gameState?.[16] as string[] | undefined) || [], [gameState]);
  const payoutAmount = (gameState?.[17] as bigint | undefined) || 0n;
  const hasPaidOut = (gameState?.[18] as boolean | undefined) || false;

  // Abandonment state from comprehensive contract data
  const isAbandoned = (gameState?.[19] as boolean | undefined) || false;
  const timeUntilAbandonmentTimeout = (gameState?.[20] as bigint | undefined) || 0n;

  // Withdrawal state from comprehensive contract data
  // startTime = gameState?.[21] (available but not currently used)
  // canWithdraw = gameState?.[22] (available but not currently used)
  const canWithdrawNow = (gameState?.[23] as boolean | undefined) || false;
  const timeUntilWithdrawal = (gameState?.[24] as bigint | undefined) || 0n;

  // Player-specific state from comprehensive contract data
  const hasWithdrawn = (gameState?.[25] as boolean | undefined) || false;

  // Map size - prioritize contract data when available, fallback to calculation
  const mapSize = useMemo(() => {
    // First try contract map size (available after game is closed)
    if (contractMapSize && typeof contractMapSize === "bigint") {
      return Number(contractMapSize);
    }

    // Calculate map size based on player count when game is closed
    // mapSize = 1 + (MAP_MULTIPLIER × actual_player_count) where MAP_MULTIPLIER = 4
    if (hasClosed && playerCount && playerCount > 0n) {
      return 1 + 4 * Number(playerCount);
    }

    // Default fallback if no data available
    return 100;
  }, [contractMapSize, hasClosed, playerCount]);

  const hasEth = balance && balance.value > 0n;
  const isPlayer = connectedAddress && contractPlayers?.includes(connectedAddress);
  const canPlay = isPlayer && isAuthenticated;
  const gameIsOpen = open; // Use contract data as primary source
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

  // Debug state changes (only log significant changes)
  useEffect(() => {
    // Only log on important state changes to reduce console spam
    const shouldLog = !isAuthenticated || !gameStatus || !playerMap;

    if (shouldLog) {
      console.log("🔍 State Debug Info:");
      console.log("  - Connected Address:", connectedAddress);
      console.log("  - Game ID:", gameId);
      console.log("  - Is Authenticated:", isAuthenticated);
      console.log("  - Is Player:", isPlayer);
      console.log("  - Can Play:", canPlay);
      console.log("  - Game Status:", gameStatus ? "loaded" : "not loaded");
      console.log("  - Has Closed:", hasClosed);
      console.log("  - Has Paid Out:", hasPaidOut);
    }
  }, [connectedAddress, gameId, isAuthenticated, isPlayer, canPlay, gameStatus, hasClosed, hasPaidOut, playerMap]);

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
      console.log("Request URL:", `${API_BASE}/register?gameId=${gameId}`);

      const registerResponse = await fetch(`${API_BASE}/register?gameId=${gameId}`);
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
        // Store token in localStorage with 10-minute expiration
        if (contractAddress !== "unknown") {
          saveTokenToStorage(contractAddress, gameId, authData.token);
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
    if (contractAddress !== "unknown") {
      removeTokenFromStorage(contractAddress, gameId);
    }
    console.log("✅ Signed out successfully");
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

    if (joinGameLoading) {
      return; // Prevent multiple clicks during debounce period
    }

    setJoinGameLoading(true);
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
      // Keep the debounce state for 5 seconds to prevent multiple clicks
      setTimeout(() => {
        setJoinGameLoading(false);
      }, 5000);
    }
  };

  // Close game function (for creator)
  const closeGame = async () => {
    if (!connectedAddress) {
      setError("Please connect your wallet first");
      return;
    }

    if (!isCreator && !isAbandoned) {
      setError("Only the game creator can close the game, or anyone after the creator abandons it");
      return;
    }

    if (startGameLoading) {
      return; // Prevent multiple clicks during debounce period
    }

    setStartGameLoading(true);
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
      // Keep the debounce state for 5 seconds to prevent multiple clicks
      setTimeout(() => {
        setStartGameLoading(false);
      }, 5000);
    }
  };

  // Withdraw function (for players when gamemaster abandons)
  const withdrawStake = async () => {
    if (!connectedAddress) {
      setError("Please connect your wallet first");
      return;
    }

    if (!isPlayer) {
      setError("Only players can withdraw their stakes");
      return;
    }

    if (!canWithdrawNow) {
      setError("Withdrawal not available yet");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log("💰 Attempting to withdraw stake...");
      await writeYourContractAsync({
        functionName: "playerWithdraw",
        args: [BigInt(gameId)],
      });
      console.log("✅ Successfully withdrew stake!");
    } catch (err) {
      console.error("💥 Failed to withdraw stake:", err);
      setError("Failed to withdraw stake. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // JWT token is now loaded in the main useEffect when contract address becomes available

  // Game API functions
  const fetchGameStatus = useCallback(async () => {
    if (heavyDebug) {
      console.log("🔥 [HEAVY DEBUG] fetchGameStatus() called");
      console.log("🔥 [HEAVY DEBUG] Expected Game ID:", gameId);
    }

    console.log("📊 Fetching game status...");
    console.log("🎯 EXPECTED GAME ID:", gameId);
    try {
      const statusUrl = `${API_BASE}/status?gameId=${gameId}`;
      console.log("Request URL:", statusUrl);

      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] About to fetch status from:", statusUrl);
      }

      const response = await fetch(statusUrl);
      console.log("Status response status:", response.status);

      const data = await response.json();
      console.log("Status response data:", data);

      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] Full status response:", JSON.stringify(data, null, 2));
        console.log("🔥 [HEAVY DEBUG] Status response keys:", Object.keys(data));
        console.log("🔥 [HEAVY DEBUG] Status response timer:", data.timer);
        console.log("🔥 [HEAVY DEBUG] Status response players:", data.players);
        console.log("🔥 [HEAVY DEBUG] Status response totalPlayers:", data.totalPlayers);
      }

      console.log("🔍 API GAME ID MISMATCH CHECK:");
      console.log("  - Expected Game ID:", gameId);
      console.log("  - API Returned Game ID:", data.gameId);
      console.log("  - Game IDs Match:", data.gameId === gameId.toString());

      setGameStatus(data);

      // Extract timer info from status response
      if (data.timer && typeof data.timer.timeRemaining === "number") {
        setTimeRemaining(data.timer.timeRemaining);
        if (heavyDebug) {
          console.log("🔥 [HEAVY DEBUG] Updated timeRemaining from status:", data.timer.timeRemaining);
        }
      }

      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] setGameStatus() called with:", data);
      }

      console.log("✅ Game status updated");
    } catch (err) {
      console.error("💥 Failed to fetch game status:", err);
      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] fetchGameStatus error:", err);
      }
      // Silently retry - don't show error to user when server is temporarily down
    }
  }, [gameId]);

  // Fetch all players
  const fetchAllPlayers = useCallback(async () => {
    if (heavyDebug) {
      console.log("🔥 [HEAVY DEBUG] fetchAllPlayers() called");
      console.log("🔥 [HEAVY DEBUG] Expected Game ID:", gameId);
    }

    console.log("👥 Fetching all players...");
    console.log("🎯 EXPECTED GAME ID:", gameId);
    try {
      const playersUrl = `${API_BASE}/players?gameId=${gameId}`;
      console.log("Request URL:", playersUrl);

      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] About to fetch players from:", playersUrl);
      }

      const response = await fetch(playersUrl);
      console.log("Players response status:", response.status);

      const data: PlayersResponse = await response.json();
      console.log("Players response data:", data);

      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] Full players response:", JSON.stringify(data, null, 2));
        console.log("🔥 [HEAVY DEBUG] Players response keys:", Object.keys(data));
        console.log("🔥 [HEAVY DEBUG] Players response success:", data.success);
        console.log("🔥 [HEAVY DEBUG] Players response count:", data.count);
        console.log("🔥 [HEAVY DEBUG] Players response players array:", data.players);
      }

      console.log("🔍 PLAYERS API GAME ID MISMATCH CHECK:");
      console.log("  - Expected Game ID:", gameId);
      console.log("  - API Returned Game ID:", (data as any).gameId);
      console.log("  - Game IDs Match:", (data as any).gameId === gameId.toString());

      if (data.success) {
        console.log("✅ Players data updated:", data.players.length, "players");
        setAllPlayers(data.players);

        if (heavyDebug) {
          console.log("🔥 [HEAVY DEBUG] setAllPlayers() called with:", data.players);
        }

        // Extract timer info from players response
        if (typeof (data as any).timeRemaining === "number") {
          setTimeRemaining((data as any).timeRemaining);
          if (heavyDebug) {
            console.log("🔥 [HEAVY DEBUG] Updated timeRemaining from players:", (data as any).timeRemaining);
          }
        }
      } else {
        console.log("❌ Players request unsuccessful:", data);
        if (heavyDebug) {
          console.log("🔥 [HEAVY DEBUG] Players request failed with data:", data);
        }
      }
    } catch (err) {
      console.error("💥 Failed to fetch players:", err);
      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] fetchAllPlayers error:", err);
      }
    }
  }, [gameId]);

  // Move player
  const movePlayer = async (direction: string) => {
    if (heavyDebug) {
      console.log("🔥 [HEAVY DEBUG] movePlayer() called with direction:", direction);
      console.log("🔥 [HEAVY DEBUG] Current playerMap state before move:", playerMap);
      console.log("🔥 [HEAVY DEBUG] Current player position:", playerMap?.position);
      console.log("🔥 [HEAVY DEBUG] Current player score:", playerMap?.score);
      console.log("🔥 [HEAVY DEBUG] Current player moves:", playerMap?.movesRemaining);
      console.log("🔥 [HEAVY DEBUG] Current player mines:", playerMap?.minesRemaining);
    }

    console.log("🎮 Move player attempt:", {
      direction,
      canPlay,
      hasJwtToken: !!jwtToken,
      loading,
      timeRemaining,
    });

    if (!canPlay || !jwtToken) {
      console.log("❌ Cannot move - missing requirements:", { canPlay, hasJwtToken: !!jwtToken });
      return;
    }

    // Check if timer has expired
    if (timeRemaining !== null && timeRemaining <= 0) {
      console.log("❌ Cannot move - time expired:", timeRemaining);
      setError("Time expired! Game over.");
      return;
    }

    if (loading) {
      console.log("❌ Cannot move - already loading");
      return;
    }

    if (hasPaidOut) {
      console.log("❌ Cannot move - game is completed (payout done)");
      setError("Game is completed. No more moves allowed.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const moveUrl = `${API_BASE}/move?gameId=${gameId}`;
      console.log("🚀 Sending move request:", { direction, url: moveUrl });

      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] About to send move request:", {
          url: moveUrl,
          direction,
          jwtToken: jwtToken?.substring(0, 20) + "...",
        });
      }

      const response = await fetch(moveUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwtToken}`,
        },
        body: JSON.stringify({ direction }),
      });

      console.log("📥 Move response status:", response.status);
      const data = await response.json();
      console.log("📥 Move response data:", data);

      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] Full move response:", JSON.stringify(data, null, 2));
        console.log("🔥 [HEAVY DEBUG] Move response keys:", Object.keys(data));
        console.log("🔥 [HEAVY DEBUG] Move response success:", data.success);
        console.log("🔥 [HEAVY DEBUG] Move response newPosition:", data.newPosition);
        console.log("🔥 [HEAVY DEBUG] Move response score:", data.score);
        console.log("🔥 [HEAVY DEBUG] Move response movesRemaining:", data.movesRemaining);
        console.log("🔥 [HEAVY DEBUG] Move response minesRemaining:", data.minesRemaining);
        console.log("🔥 [HEAVY DEBUG] Move response timeRemaining:", data.timeRemaining);
        console.log("🔥 [HEAVY DEBUG] Move response localView:", data.localView);
      }

      if (data.success) {
        console.log("✅ Move successful, updating player map");

        // Mark this as a recent move to prevent polling conflicts
        const moveTime = Date.now();
        setRecentMoveTimestamp(moveTime);

        if (heavyDebug) {
          console.log("🔥 [HEAVY DEBUG] About to update playerMap with move response");
          console.log("🔥 [HEAVY DEBUG] Setting recentMoveTimestamp to:", moveTime);
        }

        setPlayerMap(prevMap =>
          prevMap
            ? {
                ...prevMap,
                localView: data.localView,
                position: data.newPosition,
                score: data.score,
                movesRemaining: data.movesRemaining,
                minesRemaining: data.minesRemaining,
                timeRemaining: data.timeRemaining,
              }
            : null,
        );

        // Extract timer info from move response
        if (typeof data.timeRemaining === "number") {
          setTimeRemaining(data.timeRemaining);
          if (heavyDebug) {
            console.log("🔥 [HEAVY DEBUG] Updated timeRemaining from move:", data.timeRemaining);
          }
        }

        fetchAllPlayers();

        // Clear the recent move flag after 5 seconds to allow polling to resume
        setTimeout(() => {
          setRecentMoveTimestamp(prev => (prev === moveTime ? null : prev));
          if (heavyDebug) {
            console.log("🔥 [HEAVY DEBUG] Cleared recentMoveTimestamp after timeout");
          }
        }, 5000);
      } else if (response.status === 401 || response.status === 403) {
        console.log("🔒 Move failed - authentication expired");
        setIsAuthenticated(false);
        setJwtToken(null);
        if (contractAddress !== "unknown") {
          removeTokenFromStorage(contractAddress, gameId);
        }
        setError("Authentication expired. Please sign in again.");
      } else {
        console.log("❌ Move failed:", data);
        setError(data.error || "Move failed");
        if (heavyDebug) {
          console.log("🔥 [HEAVY DEBUG] Move failed with data:", data);
        }
      }
    } catch (err) {
      console.error("💥 Failed to move player:", err);
      setError("Failed to move player");
      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] movePlayer error:", err);
      }
    } finally {
      setLoading(false);
    }
  };

  // Mine at current position
  const minePlayer = async () => {
    if (heavyDebug) {
      console.log("🔥 [HEAVY DEBUG] minePlayer() called");
      console.log("🔥 [HEAVY DEBUG] Current playerMap state before mine:", playerMap);
      console.log("🔥 [HEAVY DEBUG] Current player position:", playerMap?.position);
      console.log("🔥 [HEAVY DEBUG] Current player score:", playerMap?.score);
      console.log("🔥 [HEAVY DEBUG] Current player moves:", playerMap?.movesRemaining);
      console.log("🔥 [HEAVY DEBUG] Current player mines:", playerMap?.minesRemaining);
    }

    console.log("⛏️ Mine player attempt:", {
      canPlay,
      hasJwtToken: !!jwtToken,
      loading,
      timeRemaining,
    });

    if (!canPlay || !jwtToken) {
      console.log("❌ Cannot mine - missing requirements:", { canPlay, hasJwtToken: !!jwtToken });
      return;
    }

    // Check if timer has expired
    if (timeRemaining !== null && timeRemaining <= 0) {
      console.log("❌ Cannot mine - time expired:", timeRemaining);
      setError("Time expired! Game over.");
      return;
    }

    if (loading) {
      console.log("❌ Cannot mine - already loading");
      return;
    }

    if (hasPaidOut) {
      console.log("❌ Cannot mine - game is completed (payout done)");
      setError("Game is completed. No more mining allowed.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const mineUrl = `${API_BASE}/mine?gameId=${gameId}`;
      console.log("🚀 Sending mine request:", { url: mineUrl });

      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] About to send mine request:", {
          url: mineUrl,
          jwtToken: jwtToken?.substring(0, 20) + "...",
        });
      }

      const response = await fetch(mineUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwtToken}`,
        },
        body: JSON.stringify({}),
      });

      console.log("📥 Mine response status:", response.status);
      const data = await response.json();
      console.log("📥 Mine response data:", data);

      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] Full mine response:", JSON.stringify(data, null, 2));
        console.log("🔥 [HEAVY DEBUG] Mine response keys:", Object.keys(data));
        console.log("🔥 [HEAVY DEBUG] Mine response success:", data.success);
        console.log("🔥 [HEAVY DEBUG] Mine response totalScore:", data.totalScore);
        console.log("🔥 [HEAVY DEBUG] Mine response movesRemaining:", data.movesRemaining);
        console.log("🔥 [HEAVY DEBUG] Mine response minesRemaining:", data.minesRemaining);
        console.log("🔥 [HEAVY DEBUG] Mine response timeRemaining:", data.timeRemaining);
        console.log("🔥 [HEAVY DEBUG] Mine response localView:", data.localView);
      }

      if (data.success) {
        console.log("✅ Mine successful, updating player map");

        // Mark this as a recent move to prevent polling conflicts
        const moveTime = Date.now();
        setRecentMoveTimestamp(moveTime);

        if (heavyDebug) {
          console.log("🔥 [HEAVY DEBUG] About to update playerMap with mine response");
          console.log("🔥 [HEAVY DEBUG] Setting recentMoveTimestamp to:", moveTime);
        }

        setPlayerMap(prevMap =>
          prevMap
            ? {
                ...prevMap,
                localView: data.localView,
                score: data.totalScore,
                movesRemaining: data.movesRemaining,
                minesRemaining: data.minesRemaining,
                timeRemaining: data.timeRemaining,
              }
            : null,
        );

        // Extract timer info from mine response
        if (typeof data.timeRemaining === "number") {
          setTimeRemaining(data.timeRemaining);
          if (heavyDebug) {
            console.log("🔥 [HEAVY DEBUG] Updated timeRemaining from mine:", data.timeRemaining);
          }
        }

        fetchAllPlayers();

        // Clear the recent move flag after 5 seconds to allow polling to resume
        setTimeout(() => {
          setRecentMoveTimestamp(prev => (prev === moveTime ? null : prev));
          if (heavyDebug) {
            console.log("🔥 [HEAVY DEBUG] Cleared recentMoveTimestamp after timeout");
          }
        }, 5000);
      } else if (response.status === 401 || response.status === 403) {
        console.log("🔒 Mine failed - authentication expired");
        setIsAuthenticated(false);
        setJwtToken(null);
        if (contractAddress !== "unknown") {
          removeTokenFromStorage(contractAddress, gameId);
        }
        setError("Authentication expired. Please sign in again.");
      } else {
        console.log("❌ Mine failed:", data);
        setError(data.error || "Mining failed");
        if (heavyDebug) {
          console.log("🔥 [HEAVY DEBUG] Mine failed with data:", data);
        }
      }
    } catch (err) {
      console.error("💥 Failed to mine:", err);
      setError("Failed to mine");
      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] minePlayer error:", err);
      }
    } finally {
      setLoading(false);
    }
  };

  // Fetch player's map view
  const fetchPlayerMap = useCallback(async () => {
    const currentRecentMoveTimestamp = recentMoveTimestampRef.current;

    if (heavyDebug) {
      console.log("🔥 [HEAVY DEBUG] fetchPlayerMap() called");
      console.log("🔥 [HEAVY DEBUG] Expected Game ID:", gameId);
      console.log("🔥 [HEAVY DEBUG] Can play:", canPlay);
      console.log("🔥 [HEAVY DEBUG] Has JWT token:", !!jwtToken);
      console.log("🔥 [HEAVY DEBUG] recentMoveTimestamp:", currentRecentMoveTimestamp);
    }

    console.log("🗺️ Fetching player map...");
    console.log("🎯 EXPECTED GAME ID:", gameId);
    console.log("Can play:", canPlay);
    console.log("Has JWT token:", !!jwtToken);

    if (!canPlay || !jwtToken) {
      console.log("❌ Cannot fetch map - missing requirements");
      return;
    }

    // Skip polling if there was a recent move to prevent overwriting fresh data
    if (currentRecentMoveTimestamp && Date.now() - currentRecentMoveTimestamp < 5000) {
      console.log("⏸️ Skipping map fetch - recent move detected");
      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] Skipping map fetch due to recent move:", {
          recentMoveTimestamp: currentRecentMoveTimestamp,
          timeSinceMove: Date.now() - currentRecentMoveTimestamp,
        });
      }
      return;
    }

    try {
      const mapUrl = `${API_BASE}/map?gameId=${gameId}`;

      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] About to fetch map from:", mapUrl);
        console.log("🔥 [HEAVY DEBUG] JWT token (first 20 chars):", jwtToken?.substring(0, 20) + "...");
      }

      const response = await fetch(mapUrl, {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
        },
      });

      console.log("📥 Map response status:", response.status);
      const data = await response.json();
      console.log("📥 Map response data:", data);

      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] Full map response:", JSON.stringify(data, null, 2));
        console.log("🔥 [HEAVY DEBUG] Map response keys:", Object.keys(data));
        console.log("🔥 [HEAVY DEBUG] Map response success:", data.success);
        console.log("🔥 [HEAVY DEBUG] Map response player:", data.player);
        console.log("🔥 [HEAVY DEBUG] Map response position:", data.position);
        console.log("🔥 [HEAVY DEBUG] Map response score:", data.score);
        console.log("🔥 [HEAVY DEBUG] Map response movesRemaining:", data.movesRemaining);
        console.log("🔥 [HEAVY DEBUG] Map response minesRemaining:", data.minesRemaining);
        console.log("🔥 [HEAVY DEBUG] Map response timeRemaining:", data.timeRemaining);
        console.log("🔥 [HEAVY DEBUG] Map response mapSize:", data.mapSize);
        console.log("🔥 [HEAVY DEBUG] Map response localView:", data.localView);
      }

      console.log("🔍 MAP API GAME ID CHECK:");
      console.log("  - Expected Game ID:", gameId);
      console.log("  - Map Size from API:", data.mapSize);

      if (data.success) {
        console.log("✅ Map data received successfully");

        if (heavyDebug) {
          console.log("🔥 [HEAVY DEBUG] ===== LOADING PLAYER STATE FROM SERVER =====");
          console.log("🔥 [HEAVY DEBUG] About to call setPlayerMap with:", data);
          console.log("🔥 [HEAVY DEBUG] 📍 POSITION:");
          console.log("🔥 [HEAVY DEBUG]   - New position:", data.position);
          console.log("🔥 [HEAVY DEBUG] 🎯 SCORE:");
          console.log("🔥 [HEAVY DEBUG]   - New score:", data.score);
          console.log("🔥 [HEAVY DEBUG] 🚶 MOVES:");
          console.log("🔥 [HEAVY DEBUG]   - New moves remaining:", data.movesRemaining);
          console.log("🔥 [HEAVY DEBUG] ⛏️ MINES:");
          console.log("🔥 [HEAVY DEBUG]   - New mines remaining:", data.minesRemaining);
          console.log("🔥 [HEAVY DEBUG] 🗺️ MAP VIEW:");
          console.log("🔥 [HEAVY DEBUG]   - Map size:", data.mapSize);
          console.log("🔥 [HEAVY DEBUG]   - Local view (3x3 grid):", data.localView);
          console.log("🔥 [HEAVY DEBUG] ⏰ TIME:");
          console.log("🔥 [HEAVY DEBUG]   - Time remaining:", data.timeRemaining);
          console.log("🔥 [HEAVY DEBUG] ===== END SERVER LOAD =====");
        }

        setPlayerMap(data);

        if (heavyDebug) {
          console.log("🔥 [HEAVY DEBUG] ✅ PLAYER STATE UPDATED SUCCESSFULLY");
          console.log("🔥 [HEAVY DEBUG] State should now show:");
          console.log("🔥 [HEAVY DEBUG]   - Position:", data.position);
          console.log("🔥 [HEAVY DEBUG]   - Score:", data.score);
          console.log("🔥 [HEAVY DEBUG]   - Moves remaining:", data.movesRemaining);
          console.log("🔥 [HEAVY DEBUG]   - Mines remaining:", data.minesRemaining);
          console.log("🔥 [HEAVY DEBUG]   - Map size:", data.mapSize);
        }

        // Extract timer info from map response
        if (typeof data.timeRemaining === "number") {
          setTimeRemaining(data.timeRemaining);
          if (heavyDebug) {
            console.log("🔥 [HEAVY DEBUG] Updated timeRemaining from map:", data.timeRemaining);
          }
        }
      } else if (response.status === 401 || response.status === 403) {
        console.log("🔒 Token expired or invalid");
        setIsAuthenticated(false);
        setJwtToken(null);
        if (contractAddress !== "unknown") {
          removeTokenFromStorage(contractAddress, gameId);
        }
        setError("Authentication expired. Please sign in again.");
      } else {
        console.log("❌ Map fetch failed:", data);
        if (heavyDebug) {
          console.log("🔥 [HEAVY DEBUG] Map fetch failed with data:", data);
        }
      }
    } catch (err) {
      console.error("💥 Failed to fetch player map:", err);
      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] fetchPlayerMap error:", err);
      }
    }
  }, [canPlay, jwtToken, gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper functions
  const getTileColor = (tileType: number | string) => {
    if (typeof tileType === "string") {
      switch (tileType) {
        case "X":
          return "bg-yellow-300"; // Special tile (bright gold)
        case "0":
          return "bg-gray-200"; // Depleted (light grey)
        case "1":
          return "bg-blue-200"; // Common (light blue)
        case "2":
          return "bg-green-200"; // Uncommon (light green)
        case "3":
          return "bg-[#ff6b35]"; // Rare (create game button color)
        default:
          return "bg-black"; // Unexplored (black)
      }
    }

    switch (tileType) {
      case 0:
        return "bg-gray-200"; // Depleted (light grey)
      case 1:
        return "bg-blue-200"; // Common (light blue)
      case 2:
        return "bg-green-200"; // Uncommon (light green)
      case 3:
        return "bg-[#ff6b35]"; // Rare (create game button color)
      default:
        return "bg-black"; // Unexplored (black)
    }
  };

  // Get radar tile color (without bg- prefix for direct color application)
  const getRadarTileColor = (tileType: number | string) => {
    if (typeof tileType === "string") {
      switch (tileType) {
        case "X":
          return "#fcd34d"; // Yellow-300 (bright gold)
        case "0":
          return "#e5e7eb"; // Gray-200 (light grey)
        case "1":
          return "#bfdbfe"; // Blue-200 (light blue)
        case "2":
          return "#bbf7d0"; // Green-200 (light green)
        case "3":
          return "#ff6b35"; // Create game button color
        default:
          return "#000000"; // Black
      }
    }

    switch (tileType) {
      case 0:
        return "#e5e7eb"; // Gray-200 (light grey)
      case 1:
        return "#bfdbfe"; // Blue-200 (light blue)
      case 2:
        return "#bbf7d0"; // Green-200 (light green)
      case 3:
        return "#ff6b35"; // Create game button color
      default:
        return "#000000"; // Black
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

  // Generate deterministic map from reveal hash
  const generateDeterministicMap = useMemo(() => {
    if (!randomHash || !hasRevealed) return null;

    try {
      console.log("🗺️ Generating deterministic map with:", { randomHash, mapSize });

      const dice = new DeterministicDice(randomHash);
      const mapGenerator = new GameLandGenerator(dice, mapSize);

      mapGenerator.generateLand();
      mapGenerator.placeStartingPosition();

      const mapData = {
        size: mapGenerator.size,
        land: mapGenerator.land,
        startingPosition: mapGenerator.startingPosition,
        metadata: {
          generated: new Date().toISOString(),
          gameId: gameId,
          revealValue: randomHash,
        },
      };

      console.log("✅ Generated map data:", mapData);
      return mapData;
    } catch (error) {
      console.error("❌ Failed to generate deterministic map:", error);
      return null;
    }
  }, [randomHash, hasRevealed, mapSize, gameId]);

  // Generate player positions
  const generatePlayerPositions = useMemo(() => {
    if (!randomHash || !hasRevealed || !contractPlayers?.length) return null;

    try {
      console.log("👥 Generating player positions with:", {
        randomHash,
        playerCount: contractPlayers.length,
        gameId,
        mapSize,
      });

      const positionGenerator = new PlayerPositionGenerator(randomHash);
      const positions = positionGenerator.generateAllPlayerPositions(contractPlayers, gameId, mapSize);

      console.log("✅ Generated player positions:", positions);
      return positions;
    } catch (error) {
      console.error("❌ Failed to generate player positions:", error);
      return null;
    }
  }, [randomHash, hasRevealed, contractPlayers, gameId, mapSize]);

  // Get color for land type
  const getLandColor = (landType: number | "X") => {
    if (landType === "X") {
      return "#fbbf24"; // Bright golden yellow for treasure tile
    }
    switch (landType) {
      case 0:
        return "#e5e7eb"; // Gray-200 (empty/depleted)
      case 1:
        return "#bfdbfe"; // Blue-200 (common)
      case 2:
        return "#bbf7d0"; // Green-200 (uncommon)
      case 3:
        return "#ff6b35"; // Orange (rare)
      default:
        return "#000000"; // Black (unknown)
    }
  };

  // Poll for updates - start when player can play
  useEffect(() => {
    console.log("⏰ Setting up polling interval...");
    console.log("Can play:", canPlay);
    console.log("Has paid out:", hasPaidOut);

    // Start polling when player can play (is authenticated and is a player)
    // This ensures we get game updates even if contract state isn't perfectly synced
    if (!canPlay || hasPaidOut) {
      console.log("⏸️ Polling skipped - conditions not met");
      return;
    }

    console.log("⏰ Starting polling for game updates...");

    // Initial fetch
    fetchGameStatus();
    fetchAllPlayers();

    // Set up interval with longer delay to reduce server load
    const interval = setInterval(() => {
      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] ===== POLLING INTERVAL TRIGGERED =====");
        console.log("🔥 [HEAVY DEBUG] Current time:", new Date().toLocaleTimeString());
        console.log("🔥 [HEAVY DEBUG] About to call fetchGameStatus(), fetchAllPlayers()");
        console.log("🔥 [HEAVY DEBUG] Will NOT fetch player map to avoid overwriting recent moves");
      }

      console.log("🔄 Polling update...");

      // Call the latest versions of these functions
      fetchGameStatus();
      fetchAllPlayers();

      // DON'T fetch player map in polling - it overwrites recent moves!
      // The player map is updated via move/mine responses and initial fetch
      // If we need fresh player data, it's fetched on authentication change
    }, 30000); // Slower polling for general game data

    console.log("✅ Polling interval created with ID:", interval);

    return () => {
      console.log("🛑 Clearing polling interval:", interval);
      clearInterval(interval);
    };
  }, [canPlay, hasPaidOut]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lightweight timer update - only fetch timer data more frequently
  useEffect(() => {
    console.log("⏱️ Timer effect triggered with conditions:", { hasClosed, hasPaidOut, canPlay, isAuthenticated });

    // Start timer updates when player can play (is authenticated and is a player)
    // This ensures timer works even if contract state isn't perfectly synced
    if (!canPlay || hasPaidOut) {
      console.log("⏱️ Timer effect skipped - conditions not met");
      return;
    }

    console.log("⏱️ Setting up timer update interval...");

    const timerInterval = setInterval(async () => {
      try {
        console.log("⏱️ TIMER UPDATE TICK - fetching latest time...");

        if (heavyDebug) {
          console.log("🔥 [HEAVY DEBUG] ===== TIMER UPDATE =====");
        }

        const statusUrl = `${API_BASE}/status?gameId=${gameId}`;
        const response = await fetch(statusUrl);
        const data = await response.json();

        console.log("⏱️ Timer response data:", data?.timer);

        if (data.success && data.timer && typeof data.timer.timeRemaining === "number") {
          console.log("⏱️ Updating timer from", timeRemainingRef.current, "to", data.timer.timeRemaining);
          setTimeRemaining(data.timer.timeRemaining);
          if (heavyDebug) {
            console.log("🔥 [HEAVY DEBUG] Timer updated to:", data.timer.timeRemaining);
          }
        } else {
          console.warn("⏱️ Timer update failed - invalid response:", data);
        }
      } catch (err) {
        console.error("⏱️ Timer update error:", err);
        if (heavyDebug) {
          console.log("🔥 [HEAVY DEBUG] Timer update failed:", err);
        }
      }
    }, 3000); // Update timer every 3 seconds for responsive countdown

    console.log("✅ Timer interval created with ID:", timerInterval);

    return () => {
      console.log("🛑 Clearing timer interval:", timerInterval);
      clearInterval(timerInterval);
    };
  }, [canPlay, hasPaidOut, gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch player map when authentication and player status change
  useEffect(() => {
    console.log("🗺️ Map fetch trigger - canPlay:", canPlay, "hasJwtToken:", !!jwtToken);
    if (canPlay && jwtToken) {
      console.log("🔄 Triggering initial map fetch...");
      fetchPlayerMap();
    }
  }, [canPlay, jwtToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Memoize radar calculations to prevent re-renders
  const radarConfig = useMemo(() => {
    if (!canPlay || !playerMap) return null;

    const numPlayers = Number(playerCount || 0);
    const tileSize = numPlayers > 100 ? 1 : numPlayers > 25 ? 2 : numPlayers > 10 ? 3 : numPlayers > 5 ? 4 : 5;

    return {
      tileSize,
      mapSize,
      dimensions: `${mapSize * tileSize + 8}px`,
    };
  }, [canPlay, playerMap, playerCount, mapSize]);

  // Update discovered tiles when player map changes
  useEffect(() => {
    if (heavyDebug) {
      console.log("🔥 [HEAVY DEBUG] ===== PLAYER MAP STATE CHANGED =====");
      console.log("🔥 [HEAVY DEBUG] New playerMap:", playerMap);
      if (playerMap) {
        console.log("🔥 [HEAVY DEBUG] Player map details:");
        console.log("🔥 [HEAVY DEBUG]   - Position:", playerMap.position);
        console.log("🔥 [HEAVY DEBUG]   - Score:", playerMap.score);
        console.log("🔥 [HEAVY DEBUG]   - Moves remaining:", playerMap.movesRemaining);
        console.log("🔥 [HEAVY DEBUG]   - Mines remaining:", playerMap.minesRemaining);
        console.log("🔥 [HEAVY DEBUG]   - Time remaining:", playerMap.timeRemaining);
        console.log("🔥 [HEAVY DEBUG]   - Local view:", playerMap.localView);
      } else {
        console.log("🔥 [HEAVY DEBUG] Player map is null");
      }
      console.log("🔥 [HEAVY DEBUG] ===== END PLAYER MAP STATE CHANGE =====");
    }

    if (playerMap?.localView) {
      setDiscoveredTiles(prev => {
        const newDiscovered = new Map(prev);

        // Update discovered tiles from the 3x3 local view
        playerMap.localView.forEach(row => {
          row.forEach(cell => {
            const { x, y } = cell.coordinates;
            const key = `${x},${y}`;
            newDiscovered.set(key, cell.tile);
          });
        });

        return newDiscovered;
      });

      // Also track original (non-mined) tile values for map verification
      setOriginalDiscoveredTiles(prev => {
        const newOriginal = new Map(prev);
        let newTilesAdded = 0;

        // Update original tiles from the 3x3 local view
        // Only set if we haven't seen this tile before (to preserve original values)
        playerMap.localView.forEach(row => {
          row.forEach(cell => {
            const { x, y } = cell.coordinates;
            const key = `${x},${y}`;

            // Only store the original value if we haven't seen this tile before
            if (!newOriginal.has(key)) {
              newOriginal.set(key, cell.tile);
              newTilesAdded++;
              console.log(`🗺️ Added original tile (${x},${y}): ${cell.tile}`);
            }
          });
        });

        if (newTilesAdded > 0) {
          console.log(`🗺️ Added ${newTilesAdded} new original tiles. Total: ${newOriginal.size}`);
        }

        return newOriginal;
      });
    }
  }, [playerMap]);

  useEffect(() => {
    if (heavyDebug) {
      console.log("🔥 [HEAVY DEBUG] ===== COMPONENT MOUNT / GAME ID CHANGE =====");
      console.log("🔥 [HEAVY DEBUG] Game ID:", gameId);
      console.log("🔥 [HEAVY DEBUG] Resetting all state variables to initial values");
      console.log("🔥 [HEAVY DEBUG] Previous playerMap state:", playerMap);
      console.log("🔥 [HEAVY DEBUG] Previous gameStatus state:", gameStatus);
      console.log("🔥 [HEAVY DEBUG] Previous allPlayers state:", allPlayers);
      console.log("🔥 [HEAVY DEBUG] Previous isAuthenticated state:", isAuthenticated);
    }

    // Reset state variables when a new game is loaded
    setGameStatus(null);
    setPlayerMap(null);
    setAllPlayers([]);
    setLoading(false);
    setError(null);
    setJwtToken(null);
    setIsAuthenticated(false);
    setAuthLoading(false);
    setJoinGameLoading(false);
    setStartGameLoading(false);
    setShowConfetti(false);
    setTimeRemaining(null);
    setRecentMoveTimestamp(null);
    setDiscoveredTiles(new Map());
    setOriginalDiscoveredTiles(new Map());

    if (heavyDebug) {
      console.log("🔥 [HEAVY DEBUG] ✅ STATE RESET COMPLETE");
      console.log("🔥 [HEAVY DEBUG] All state variables reset to initial values");
      console.log("🔥 [HEAVY DEBUG] ===== END COMPONENT MOUNT / GAME ID CHANGE =====");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // Map verification - compare explored tiles with generated map
  const mapVerification = useMemo(() => {
    console.log("🔍 Map verification check:");
    console.log("  - generateDeterministicMap exists:", !!generateDeterministicMap);
    console.log("  - originalDiscoveredTiles.size:", originalDiscoveredTiles.size);
    console.log("  - originalDiscoveredTiles:", Array.from(originalDiscoveredTiles.entries()));

    if (!generateDeterministicMap || !originalDiscoveredTiles.size) {
      console.log("❌ Map verification skipped - missing requirements");
      return null;
    }

    console.log("🔍 Starting map verification...");
    console.log("Generated map size:", generateDeterministicMap.size);
    console.log("Original discovered tiles count:", originalDiscoveredTiles.size);

    let matchCount = 0;
    let mismatchCount = 0;
    let preminedCount = 0;
    const mismatches: Array<{ x: number; y: number; expected: number | string; actual: number | string }> = [];

    // Check each discovered tile against the generated map
    for (const [key, discoveredValue] of originalDiscoveredTiles.entries()) {
      const [x, y] = key.split(",").map(Number);

      // Get the corresponding tile from the generated map
      const generatedValue = generateDeterministicMap.land[y]?.[x];

      if (generatedValue !== undefined) {
        // Skip verification for tiles that show as "0" (already mined by other players)
        if (discoveredValue === 0 || discoveredValue === "0") {
          preminedCount++;
          console.log(`⛏️ Skipping verification for mined tile at (${x},${y}) - was mined by another player`);
          continue;
        }

        if (discoveredValue === generatedValue) {
          matchCount++;
        } else {
          mismatchCount++;
          mismatches.push({
            x,
            y,
            expected: generatedValue,
            actual: discoveredValue,
          });
        }
      }
    }

    const isValid = mismatchCount === 0;
    console.log(`🔍 Map verification complete: ${matchCount} matches, ${mismatchCount} mismatches`);

    if (mismatches.length > 0) {
      console.log("❌ Map mismatches found:", mismatches);
    }

    return {
      isValid,
      matchCount,
      mismatchCount,
      preminedCount,
      mismatches,
      totalExplored: originalDiscoveredTiles.size,
    };
  }, [generateDeterministicMap, originalDiscoveredTiles]);

  if (!fullGameState) {
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
        <div className="fixed inset-0 pointer-events-none z-[9999]">
          <Confetti
            width={window.innerWidth}
            height={window.innerHeight}
            recycle={false}
            numberOfPieces={200}
            gravity={0.3}
          />
        </div>
      )}

      <div className="flex items-center flex-col grow pt-10">
        {/* Floating Radar/Map View */}
        {radarConfig && (
          <div
            className="fixed top-20 left-4 bg-white border border-gray-400 shadow-lg z-50"
            style={{
              width: radarConfig.dimensions,
              height: radarConfig.dimensions,
              padding: "4px",
              display: "grid",
              gridTemplateColumns: `repeat(${radarConfig.mapSize}, ${radarConfig.tileSize}px)`,
              gridTemplateRows: `repeat(${radarConfig.mapSize}, ${radarConfig.tileSize}px)`,
            }}
          >
            {Array.from({ length: radarConfig.mapSize * radarConfig.mapSize }, (_, index) => {
              const x = index % radarConfig.mapSize;
              const y = Math.floor(index / radarConfig.mapSize);
              const key = `${x},${y}`;
              const tileType = discoveredTiles.get(key);
              const isPlayerPosition = playerMap?.position && playerMap.position.x === x && playerMap.position.y === y;

              return (
                <div
                  key={key}
                  style={{
                    width: `${radarConfig.tileSize}px`,
                    height: `${radarConfig.tileSize}px`,
                    backgroundColor: tileType !== undefined ? getRadarTileColor(tileType) : "#000000", // Black for unknown
                    border: isPlayerPosition ? "1px solid #ef4444" : "none", // Red border for player position
                    boxSizing: "border-box",
                  }}
                  title={`${x},${y}: ${tileType !== undefined ? `Tile ${tileType}` : "Unknown"}`}
                />
              );
            })}
          </div>
        )}

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
                  Payout of <span className="font-bold text-green-600">{formatEther(payoutAmount || 0n)} ETH</span> each
                </p>

                <div className="space-y-3">
                  <h3 className="text-xl font-semibold text-base-content">Winners:</h3>
                  {winners.map((winner, index) => {
                    const isConnectedUser = connectedAddress && winner.toLowerCase() === connectedAddress.toLowerCase();
                    return (
                      <div
                        key={`${winner}-${index}`}
                        className={`p-3 rounded-lg border-2 ${
                          isConnectedUser
                            ? "bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 font-bold text-yellow-800 dark:text-yellow-300"
                            : "bg-base-200 border-base-300"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <Address address={winner} />
                          <span
                            className={`text-lg font-bold ${isConnectedUser ? "text-yellow-600 dark:text-yellow-400" : "text-green-600 dark:text-green-400"}`}
                          >
                            {formatEther(payoutAmount || 0n)} ETH
                            {isConnectedUser && " 🏆"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
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
            <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 p-4 rounded">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    Connect your wallet to see if you&apos;re registered as a player in this game.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Wallet connected but no ETH */}
          {connectedAddress && !hasEth && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 p-6 rounded mb-6">
              <div className="flex flex-col items-center text-center space-y-4">
                <p className="text-lg font-semibold text-red-800 dark:text-red-300 mb-2">
                  Your wallet doesn&apos;t have any ETH
                </p>
                <p className="text-sm text-red-700 dark:text-red-400 mb-4">Please send some ETH to this address:</p>

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
                      className={`btn btn-primary btn-lg ${joinGameLoading ? "loading" : ""}`}
                      onClick={joinGame}
                      disabled={joinGameLoading || !gameIsOpen}
                    >
                      {joinGameLoading ? "Joining Game..." : `🚀 Join Game (${formatEther(stakeAmount || 0n)} ETH)`}
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
                    className={`btn btn-lg text-white transition-all duration-300 ${
                      startGameLoading || !playerCount || playerCount === 0n
                        ? "opacity-50 cursor-not-allowed"
                        : "hover:scale-105"
                    } ${startGameLoading ? "loading" : ""}`}
                    style={{
                      backgroundColor: startGameLoading || !playerCount || playerCount === 0n ? "#9ca3af" : "#ff6b35",
                      borderColor: startGameLoading || !playerCount || playerCount === 0n ? "#9ca3af" : "#ff6b35",
                      boxShadow:
                        startGameLoading || !playerCount || playerCount === 0n
                          ? "none"
                          : "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 0 0 15px rgba(255, 107, 53, 0.3)",
                    }}
                    onClick={closeGame}
                    disabled={startGameLoading || !playerCount || playerCount === 0n}
                    title={
                      startGameLoading
                        ? "Starting game..."
                        : !playerCount || playerCount === 0n
                          ? "At least one player must join before starting the game"
                          : "Start the game for all players"
                    }
                  >
                    {startGameLoading ? "Starting..." : "🚀 Start Game"}
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

          {/* Abandoned Game Controls - Show when game is abandoned and anyone can close it */}
          {hasOpened && !hasClosed && isAbandoned && !isCreator && (
            <div className="bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-300 rounded-lg p-6 mb-6 shadow-lg">
              <div className="flex flex-col items-center space-y-4">
                <div className="text-center">
                  <h2 className="text-2xl font-bold text-red-800 mb-2">⚠️ Game Abandoned</h2>
                  <p className="text-red-700 mb-4">The creator has abandoned this game. Anyone can now start it!</p>
                </div>
                <button
                  className={`btn btn-warning btn-lg ${startGameLoading ? "loading" : ""}`}
                  onClick={closeGame}
                  disabled={startGameLoading}
                >
                  {startGameLoading ? "Starting..." : "🚀 Start Abandoned Game"}
                </button>
              </div>
            </div>
          )}

          {/* Withdrawal Controls - Show when players can withdraw their stakes */}
          {isPlayer && hasClosed && canWithdrawNow && !hasWithdrawn && (
            <div className="bg-gradient-to-r from-yellow-50 to-red-50 border-2 border-yellow-300 rounded-lg p-6 mb-6 shadow-lg">
              <div className="flex flex-col items-center space-y-4">
                <div className="text-center">
                  <h2 className="text-2xl font-bold text-yellow-800 mb-2">💰 Withdraw Available</h2>
                  <p className="text-yellow-700 mb-4">
                    The gamemaster has not paid out within the timeout period. You can withdraw your stake of{" "}
                    <span className="font-bold">{formatEther(stakeAmount || 0n)} ETH</span>.
                  </p>
                </div>
                <button
                  className={`btn btn-warning btn-lg ${loading ? "loading" : ""}`}
                  onClick={withdrawStake}
                  disabled={loading}
                >
                  {loading ? "Withdrawing..." : `💰 Withdraw ${formatEther(stakeAmount || 0n)} ETH`}
                </button>
              </div>
            </div>
          )}

          {/* Player's Game Interface - Map at top when authenticated */}
          {canPlay && playerMap && (
            <div className="bg-base-100 rounded-lg p-6 shadow-lg mb-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-base-content">Your Game View</h2>
                <div className="text-right">
                  <p className="text-sm text-base-content/70">Total Pot</p>
                  <p className="text-lg font-bold text-green-600 dark:text-green-400">
                    {formatEther((stakeAmount || 0n) * (playerCount || 0n))} ETH
                  </p>
                </div>
              </div>

              {/* Interactive 3x3 Map Grid */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3 text-center">
                  Score: {playerMap.score} | Moves: {playerMap.movesRemaining} | Mines: {playerMap.minesRemaining}
                  {timeRemaining !== null && <> | Time: {timeRemaining}s</>}
                </h3>
                <div className="grid grid-cols-5 gap-0 max-w-md mx-auto border-2 border-gray-400">
                  {Array.from({ length: 25 }, (_, index) => {
                    const gridRow = Math.floor(index / 5);
                    const gridCol = index % 5;

                    // Center 3x3 area (rows 1-3, cols 1-3 in 0-indexed 5x5 grid)
                    const isCenterArea = gridRow >= 1 && gridRow <= 3 && gridCol >= 1 && gridCol <= 3;

                    if (isCenterArea) {
                      // Map to original 3x3 coordinates
                      const localRow = gridRow - 1;
                      const localCol = gridCol - 1;
                      const cell = playerMap.localView[localRow][localCol];

                      const direction = getDirectionFromPosition(localRow, localCol);
                      const isClickable =
                        !cell.player &&
                        direction &&
                        (timeRemaining === null || timeRemaining > 0) &&
                        playerMap.movesRemaining > 0;
                      const isPlayerTile = cell.player;
                      const canMine =
                        isPlayerTile &&
                        playerMap.minesRemaining > 0 &&
                        (timeRemaining === null || timeRemaining > 0) &&
                        (typeof cell.tile === "number" ? cell.tile > 0 : cell.tile !== "0");

                      return (
                        <div
                          key={`center-${localRow}-${localCol}`}
                          className={`
                            w-full h-full flex items-center justify-center text-sm font-semibold
                            relative transition-all duration-200
                            ${gridRow > 0 ? "border-t border-gray-400" : ""}
                            ${gridCol > 0 ? "border-l border-gray-400" : ""}
                            ${getTileColor(cell.tile)}
                            ${isClickable ? "cursor-pointer hover:brightness-110 hover:scale-105 hover:shadow-lg" : ""}
                            ${canMine ? "cursor-pointer hover:brightness-110 hover:scale-105 hover:shadow-lg" : ""}
                            ${loading ? "opacity-50" : ""}
                            ${timeRemaining !== null && timeRemaining <= 0 ? "opacity-25 cursor-not-allowed" : ""}
                          `}
                          style={{ minWidth: "64px", minHeight: "64px" }}
                          onClick={() => {
                            if (loading || !canPlay) return;
                            if (timeRemaining !== null && timeRemaining <= 0) return;
                            if (isClickable) {
                              movePlayer(direction);
                            } else if (canMine) {
                              minePlayer();
                            }
                          }}
                          title={
                            timeRemaining !== null && timeRemaining <= 0
                              ? "Time expired! Game over."
                              : isClickable
                                ? `Move ${direction} to tile ${cell.tile}`
                                : canMine
                                  ? `Mine here for ${
                                      cell.tile === 1 || cell.tile === "1"
                                        ? "1"
                                        : cell.tile === 2 || cell.tile === "2"
                                          ? "5"
                                          : cell.tile === 3 || cell.tile === "3"
                                            ? "10"
                                            : cell.tile === "X"
                                              ? "special"
                                              : "0"
                                    } points`
                                  : cell.player
                                    ? playerMap.minesRemaining > 0
                                      ? cell.tile === 0 || cell.tile === "0"
                                        ? "Already mined (depleted)"
                                        : "Click to mine"
                                      : "No mines remaining"
                                    : "Cannot move here"
                          }
                        >
                          <div className="text-center">
                            <div>{cell.tile}</div>
                            {cell.player && (
                              <div className="text-yellow-600">
                                {playerMap.minesRemaining > 0 &&
                                (typeof cell.tile === "number" ? cell.tile > 0 : cell.tile !== "0")
                                  ? "⛏️"
                                  : "👤"}
                              </div>
                            )}
                          </div>

                          {/* Player position coordinates in top left */}
                          {cell.player && (
                            <div className="absolute top-1 left-1 text-xs opacity-90 text-gray-700 bg-white bg-opacity-80 px-1 rounded">
                              {playerMap.position.x},{playerMap.position.y}
                            </div>
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
                        </div>
                      );
                    } else {
                      // Outer fog of war tiles
                      const playerPos = playerMap.position;

                      // Calculate world coordinates relative to player position
                      const offsetX = gridCol - 2; // -2 because player is at center (2,2)
                      const offsetY = gridRow - 2;
                      const rawX = playerPos.x + offsetX;
                      const rawY = playerPos.y + offsetY;

                      // Proper modulo wrapping that handles negative numbers correctly
                      const worldX = ((rawX % mapSize) + mapSize) % mapSize;
                      const worldY = ((rawY % mapSize) + mapSize) % mapSize;

                      const tileKey = `${worldX},${worldY}`;
                      const discoveredTile = discoveredTiles.get(tileKey);

                      // Debug logging for wrap-around
                      if (heavyDebug) {
                        console.log(
                          `🔥 [HEAVY DEBUG] Outer tile calc: grid(${gridRow},${gridCol}) offset(${offsetX},${offsetY}) raw(${rawX},${rawY}) world(${worldX},${worldY}) mapSize=${mapSize}`,
                        );
                      }

                      // Determine if this outer tile is clickable for long-distance moves
                      const canMoveToOuterTile =
                        (timeRemaining === null || timeRemaining > 0) && playerMap.movesRemaining > 0 && !loading;

                      // Get direction for outer tile
                      const outerDirection =
                        gridRow === 0
                          ? gridCol === 0
                            ? "far-northwest"
                            : gridCol === 4
                              ? "far-northeast"
                              : "far-north"
                          : gridRow === 4
                            ? gridCol === 0
                              ? "far-southwest"
                              : gridCol === 4
                                ? "far-southeast"
                                : "far-south"
                            : gridCol === 0
                              ? "far-west"
                              : "far-east";

                      return (
                        <div
                          key={`outer-${gridRow}-${gridCol}`}
                          className={`
                            w-full h-full flex items-center justify-center text-xs font-semibold
                            relative transition-all duration-200 opacity-40
                            ${gridRow > 0 ? "border-t border-gray-400" : ""}
                            ${gridCol > 0 ? "border-l border-gray-400" : ""}
                            ${discoveredTile !== undefined ? getTileColor(discoveredTile) : "bg-black"}
                            ${canMoveToOuterTile ? "cursor-pointer hover:opacity-60 hover:scale-105" : ""}
                            ${loading ? "opacity-25" : ""}
                            ${timeRemaining !== null && timeRemaining <= 0 ? "opacity-15 cursor-not-allowed" : ""}
                          `}
                          style={{ minWidth: "64px", minHeight: "64px" }}
                          onClick={() => {
                            if (loading || !canPlay) return;
                            if (timeRemaining !== null && timeRemaining <= 0) return;
                            if (canMoveToOuterTile) {
                              // For outer tiles, we can implement multi-step movement later
                              // For now, just move in the general direction
                              const basicDirection = outerDirection.replace("far-", "");
                              movePlayer(basicDirection);
                            }
                          }}
                          title={
                            timeRemaining !== null && timeRemaining <= 0
                              ? "Time expired! Game over."
                              : canMoveToOuterTile
                                ? `Move ${outerDirection} ${discoveredTile !== undefined ? `to tile ${discoveredTile}` : "(unexplored)"}`
                                : "Cannot move here"
                          }
                        >
                          <div className="text-center opacity-70">
                            {discoveredTile !== undefined ? discoveredTile : "?"}
                          </div>
                        </div>
                      );
                    }
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Authentication Status - Show below map when authenticated */}
          {connectedAddress && isPlayer && hasEth && isAuthenticated && (
            <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400 p-4 rounded mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="text-green-600 dark:text-green-400 font-semibold">✅ Authenticated</span>
                  <span className="text-sm text-green-700 dark:text-green-300">Ready to play!</span>
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
              <h2 className="text-xl font-bold mb-4 text-base-content">
                Players ({contractPlayers?.length || allPlayers.length})
              </h2>
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
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                          <div>
                            <span className="text-base-content/70">Score:</span>
                            <span className="ml-1 font-semibold text-green-600 dark:text-green-400">
                              {player.score}
                            </span>
                          </div>
                          <div>
                            <span className="text-base-content/70">Moves:</span>
                            <span className="ml-1 font-semibold text-blue-600 dark:text-blue-400">
                              {player.movesRemaining}
                            </span>
                          </div>
                          <div>
                            <span className="text-base-content/70">Mines:</span>
                            <span className="ml-1 font-semibold text-orange-600 dark:text-orange-400">
                              {player.minesRemaining}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  : contractPlayers?.map((playerAddress, index) => (
                      <div key={`${playerAddress}-${index}`} className="p-4 bg-base-200 rounded-lg">
                        <div className="flex justify-between items-start mb-2">
                          <Address address={playerAddress} />
                          <div className="flex items-center space-x-2">
                            <span className="px-2 py-1 rounded text-xs bg-base-300 text-base-content/70">Joined</span>
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
            <h2 className="text-2xl font-bold mb-4 text-base-content">Game Information</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-base-content/70 mb-1">Gamemaster</p>
                <Address address={gamemaster} />
              </div>
              <div>
                <p className="text-sm text-base-content/70 mb-1">Creator</p>
                <Address address={creator} />
                {isCreator && (
                  <span className="ml-2 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 text-xs rounded-full">
                    You
                  </span>
                )}
              </div>
              <div>
                <p className="text-sm text-base-content/70 mb-1">Stake Amount</p>
                <p className="text-xl font-bold text-blue-600 dark:text-blue-400">
                  {formatEther(stakeAmount || 0n)} ETH
                </p>
              </div>
              <div>
                <p className="text-sm text-base-content/70 mb-1">Players Joined</p>
                <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{playerCount?.toString() || 0}</p>
              </div>
              <div>
                <p className="text-sm text-base-content/70 mb-1">Map Size</p>
                <p className="text-xl font-bold text-orange-600 dark:text-orange-400">
                  {contractMapSize && contractMapSize > 0
                    ? `${contractMapSize}×${contractMapSize}`
                    : hasClosed && playerCount && playerCount > 0n
                      ? `${1 + 4 * Number(playerCount)}×${1 + 4 * Number(playerCount)}`
                      : hasClosed
                        ? "Calculating..."
                        : "TBD after game closes"}
                </p>
              </div>
              <div>
                <p className="text-sm text-base-content/70 mb-1">Status</p>
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
              {(hasCommitted || hasRevealed) && (
                <div>
                  <p className="text-sm text-base-content/70 mb-1">Commit-Reveal</p>
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
                      <span className="text-green-600 dark:text-green-400">
                        ✅ Hash revealed: {randomHash?.slice(0, 12)}...
                      </span>
                    ) : hasCommitted ? (
                      <span className="text-yellow-600 dark:text-yellow-400">Hash committed, waiting for reveal.</span>
                    ) : (
                      <span className="text-base-content/70">❌ Not Committed</span>
                    )}
                  </div>
                </div>
              )}
              {hasOpened && !hasClosed && timeUntilAbandonmentTimeout > 0n && (
                <div>
                  <p className="text-sm text-base-content/70 mb-1">Abandonment Timeout</p>
                  <p className="text-sm text-orange-600 dark:text-orange-400">
                    {Math.floor(Number(timeUntilAbandonmentTimeout))} seconds until anyone can start the game
                  </p>
                </div>
              )}
              {hasClosed && timeUntilWithdrawal > 0n && !hasPaidOut && (
                <div>
                  <p className="text-sm text-base-content/70 mb-1">Withdrawal Timeout</p>
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {Math.floor(Number(timeUntilWithdrawal))} seconds until players can withdraw
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Generated Map Display */}
          {generateDeterministicMap && (
            <div className="bg-base-100 rounded-lg p-6 shadow-lg mb-6">
              <h2 className="text-2xl font-bold mb-4 text-base-content">Generated Map</h2>
              <div className="flex flex-col items-center space-y-4">
                {/* Map Display */}
                <div className="bg-base-200 p-4 rounded-lg shadow-sm border border-base-300">
                  <div className="mb-4 text-center">
                    <p className="text-sm text-base-content/70">
                      Map Size: {generateDeterministicMap.size}×{generateDeterministicMap.size}
                    </p>
                    <p className="text-sm text-base-content/70">
                      Generated from random hash: {randomHash?.slice(0, 12)}...{randomHash?.slice(-8)}
                    </p>
                    {randomHash && (
                      <div className="mt-2 p-2 bg-base-300 rounded text-xs font-mono break-all">
                        <span className="text-base-content/70">Full Random Hash:</span>
                        <br />
                        <span className="text-base-content">{randomHash}</span>
                      </div>
                    )}
                  </div>

                  {/* Map Grid with Exploration Overlay */}
                  <div className="w-full max-w-4xl mx-auto">
                    {(() => {
                      // Calculate appropriate tile size to keep map at reasonable display size
                      const maxDisplaySize = 500; // Max size in pixels for the map
                      const tileSize = Math.max(
                        2,
                        Math.min(10, Math.floor(maxDisplaySize / generateDeterministicMap.size)),
                      );
                      const actualMapSize = generateDeterministicMap.size * tileSize;

                      return (
                        <div
                          className="grid gap-0 border-2 border-gray-400 mx-auto shadow-lg relative"
                          style={{
                            gridTemplateColumns: `repeat(${generateDeterministicMap.size}, ${tileSize}px)`,
                            gridTemplateRows: `repeat(${generateDeterministicMap.size}, ${tileSize}px)`,
                            width: `${actualMapSize}px`,
                            height: `${actualMapSize}px`,
                          }}
                        >
                          {generateDeterministicMap.land.flat().map((landType: number | "X", index: number) => {
                            const x = index % generateDeterministicMap.size;
                            const y = Math.floor(index / generateDeterministicMap.size);
                            const isTreasureTile = landType === "X";

                            // Check if this tile was explored
                            const tileKey = `${x},${y}`;
                            const wasExplored = originalDiscoveredTiles.has(tileKey);
                            const exploredValue = originalDiscoveredTiles.get(tileKey);

                            // Check if there's a mismatch
                            const hasMismatch = mapVerification?.mismatches.some(m => m.x === x && m.y === y) || false;

                            return (
                              <div
                                key={`${x}-${y}`}
                                className="relative hover:scale-110 transition-transform duration-150"
                                style={{
                                  backgroundColor: getLandColor(landType),
                                  width: `${tileSize}px`,
                                  height: `${tileSize}px`,
                                  border: tileSize > 3 ? "1px solid rgba(0,0,0,0.1)" : "none",
                                  boxSizing: "border-box",
                                  // Add exploration overlay
                                  opacity: wasExplored ? 1.0 : 0.7, // Full opacity for explored, 70% for unexplored
                                  // Add a subtle glow effect for treasure tile
                                  boxShadow: isTreasureTile
                                    ? "0 0 8px rgba(252, 211, 77, 0.8)"
                                    : hasMismatch
                                      ? "0 0 4px rgba(220, 38, 38, 0.8)"
                                      : "none",
                                  // Add a red border for mismatched tiles
                                  borderColor: hasMismatch ? "#dc2626" : undefined,
                                  borderWidth: hasMismatch ? "2px" : undefined,
                                }}
                                title={`Position (${x},${y}): ${
                                  landType === "X"
                                    ? "Treasure Tile"
                                    : landType === 0
                                      ? "Empty"
                                      : landType === 1
                                        ? "Common"
                                        : landType === 2
                                          ? "Uncommon"
                                          : "Rare"
                                } ${
                                  wasExplored
                                    ? `(Explored: ${exploredValue}${hasMismatch ? " - MISMATCH!" : ""})`
                                    : "(Unexplored)"
                                }`}
                              >
                                {/* Show mismatch indicator for larger tiles */}
                                {tileSize > 8 && hasMismatch && (
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-red-600 font-bold text-xs">!</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Enhanced Legend */}
                  <div className="mt-4 space-y-2">
                    {/* Tile Type Legend */}
                    <div className="flex justify-center space-x-4 text-xs">
                      <div className="flex items-center space-x-1">
                        <div className="w-3 h-3 bg-blue-200 border"></div>
                        <span className="text-base-content">Common</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <div className="w-3 h-3 bg-green-200 border"></div>
                        <span className="text-base-content">Uncommon</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <div className="w-3 h-3 border" style={{ backgroundColor: "#ff6b35" }}></div>
                        <span className="text-base-content">Rare</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <div className="w-3 h-3 border" style={{ backgroundColor: "#fbbf24" }}></div>
                        <span className="text-base-content">Treasure</span>
                      </div>
                    </div>

                    {/* Map Verification Status - Single Line */}
                    {mapVerification && (
                      <div className="flex justify-center text-sm">
                        <span className="text-base-content">
                          {mapVerification.isValid ? "✅" : "❌"}
                          {mapVerification.isValid ? " Map Verified" : " Map Discrepancy Detected"} • Explored tiles:{" "}
                          {mapVerification.totalExplored} • Matches: {mapVerification.matchCount}
                          {mapVerification.preminedCount > 0 && ` • ${mapVerification.preminedCount} Premined`}
                          {mapVerification.mismatchCount > 0 && ` • Mismatches: ${mapVerification.mismatchCount}`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Player Positions */}
                {generatePlayerPositions && (
                  <div className="bg-base-200 p-4 rounded-lg w-full max-w-md">
                    <h3 className="font-semibold mb-2 text-base-content">Player Starting Positions</h3>
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {(() => {
                        const playerEntries: Array<[string, { x: number; y: number }]> = Array.from(
                          generatePlayerPositions.entries(),
                        ) as Array<[string, { x: number; y: number }]>;
                        return playerEntries.map(([playerAddress, position]) => (
                          <div key={playerAddress} className="flex items-center justify-between text-sm">
                            <div className="flex items-center mr-2">
                              <ClientOnlyWrapper
                                fallback={
                                  <span className="text-base-content">
                                    {playerAddress.slice(0, 6)}...{playerAddress.slice(-4)}
                                  </span>
                                }
                              >
                                <Address address={playerAddress} />
                              </ClientOnlyWrapper>
                              <span className="text-base-content">:</span>
                            </div>
                            <span className="font-mono text-base-content">
                              ({position.x}, {position.y})
                            </span>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Share Game - Only show if map not generated */}
          {!generateDeterministicMap && (
            <div className="bg-base-100 rounded-lg p-6 shadow-lg mb-6">
              <h2 className="text-2xl font-bold mb-4 text-base-content">Share Game</h2>
              <div className="flex flex-col items-center space-y-4">
                {/* QR Code */}
                <div className="bg-base-200 p-4 rounded-lg shadow-sm">
                  <QRCodeSVG value={typeof window !== "undefined" ? window.location.href : ""} size={180} />
                </div>

                {/* URL with Copy Button */}
                <div className="flex items-center space-x-2 bg-base-200 p-3 rounded-lg w-full max-w-md">
                  <span className="text-sm text-base-content/70 truncate flex-1">
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
          )}
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
