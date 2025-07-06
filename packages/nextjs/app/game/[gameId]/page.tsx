"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

const API_BASE = "https://slop.computer:8000";
//const API_BASE = "http://localhost:8000";

// Heavy debug flag - set to true to log all server communications
const heavyDebug = true;

// Types for the game API responses
interface GameStatus {
  success: boolean;
  gameId: string;
  activeGames: string[];
  gameLoaded: boolean;
  mapSize: number;
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
  mapSize: number;
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

  // Radar/Map state - track discovered tiles
  const [discoveredTiles, setDiscoveredTiles] = useState<Map<string, number | string>>(new Map());

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

  // Read abandonment state
  const { data: abandonmentInfo } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "isGameAbandoned",
    args: [BigInt(gameId)],
  });

  // Read withdrawal info
  const { data: withdrawalInfo } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "getWithdrawalInfo",
    args: [BigInt(gameId)],
  });

  // Check if current player has already withdrawn
  const { data: hasWithdrawn } = useScaffoldReadContract({
    contractName: "YourContract",
    functionName: "hasPlayerWithdrawn",
    args: [BigInt(gameId), connectedAddress || "0x0000000000000000000000000000000000000000"],
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
  const winners = useMemo(() => payoutInfo?.[0] || [], [payoutInfo]);
  const payoutAmount = payoutInfo?.[1] || 0n;
  const hasPaidOut = payoutInfo?.[2] || false;

  // Commit-reveal state derived from contract data
  const committedHash = commitRevealState?.[0];
  const commitBlockNumber = commitRevealState?.[1];
  const randomHash = commitRevealState?.[3];
  const hasCommitted = commitRevealState?.[4] || false;
  const hasRevealed = commitRevealState?.[5] || false;

  // Abandonment state derived from contract data
  const isAbandoned = abandonmentInfo?.[0] || false;
  const timeUntilAbandonmentTimeout = abandonmentInfo?.[1] || 0n;

  // Withdrawal state derived from contract data
  const canWithdrawNow = withdrawalInfo?.[2] || false;
  const timeUntilWithdrawal = withdrawalInfo?.[3] || 0n;

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
        const tokenKey = `gameJwtToken_${API_BASE}_${gameId}`;
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(tokenKey);
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
        const tokenKey = `gameJwtToken_${API_BASE}_${gameId}`;
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(tokenKey);
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
    if (heavyDebug) {
      console.log("🔥 [HEAVY DEBUG] fetchPlayerMap() called");
      console.log("🔥 [HEAVY DEBUG] Expected Game ID:", gameId);
      console.log("🔥 [HEAVY DEBUG] Can play:", canPlay);
      console.log("🔥 [HEAVY DEBUG] Has JWT token:", !!jwtToken);
      console.log("🔥 [HEAVY DEBUG] recentMoveTimestamp:", recentMoveTimestamp);
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
    if (recentMoveTimestamp && Date.now() - recentMoveTimestamp < 5000) {
      console.log("⏸️ Skipping map fetch - recent move detected");
      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] Skipping map fetch due to recent move:", {
          recentMoveTimestamp,
          timeSinceMove: Date.now() - recentMoveTimestamp,
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
        const tokenKey = `gameJwtToken_${API_BASE}_${gameId}`;
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(tokenKey);
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
  }, [canPlay, jwtToken, gameId, recentMoveTimestamp]); // Removed playerMap dependency

  // Helper functions
  const getTileColor = (tileType: number | string) => {
    if (typeof tileType === "string") {
      switch (tileType) {
        case "X":
          return "bg-yellow-300"; // Special tile (bright gold)
        case "0":
          return "bg-gray-300"; // Depleted
        case "1":
          return "bg-green-200"; // Common
        case "2":
          return "bg-blue-200"; // Uncommon
        case "3":
          return "bg-purple-200"; // Rare
        default:
          return "bg-gray-200";
      }
    }

    switch (tileType) {
      case 0:
        return "bg-gray-300"; // Depleted (already mined)
      case 1:
        return "bg-green-200"; // Common (1 point)
      case 2:
        return "bg-blue-200"; // Uncommon (5 points)
      case 3:
        return "bg-purple-200"; // Rare (10 points)
      default:
        return "bg-gray-200";
    }
  };

  // Get radar tile color (without bg- prefix for direct color application)
  const getRadarTileColor = (tileType: number | string) => {
    if (typeof tileType === "string") {
      switch (tileType) {
        case "X":
          return "#fcd34d"; // Yellow-300 (bright gold)
        case "0":
          return "#d1d5db"; // Gray-300
        case "1":
          return "#bbf7d0"; // Green-200
        case "2":
          return "#bfdbfe"; // Blue-200
        case "3":
          return "#e9d5ff"; // Purple-200
        default:
          return "#e5e7eb"; // Gray-200
      }
    }

    switch (tileType) {
      case 0:
        return "#d1d5db"; // Gray-300 (depleted)
      case 1:
        return "#bbf7d0"; // Green-200 (common)
      case 2:
        return "#bfdbfe"; // Blue-200 (uncommon)
      case 3:
        return "#e9d5ff"; // Purple-200 (rare)
      default:
        return "#e5e7eb"; // Gray-200
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

  // Poll for updates - only when game is closed but not finished
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

    // Initial fetch
    fetchGameStatus();
    fetchAllPlayers();

    // Set up interval with longer delay to reduce server load
    const interval = setInterval(() => {
      if (heavyDebug) {
        console.log("🔥 [HEAVY DEBUG] ===== POLLING INTERVAL TRIGGERED =====");
        console.log("🔥 [HEAVY DEBUG] Current time:", new Date().toLocaleTimeString());
        console.log("🔥 [HEAVY DEBUG] About to call fetchGameStatus(), fetchAllPlayers()");
        console.log("🔥 [HEAVY DEBUG] Will fetch player map?", isAuthenticated && jwtToken && isPlayer);
        console.log("🔥 [HEAVY DEBUG] Current player state before polling:");
        console.log("🔥 [HEAVY DEBUG]   - Position:", playerMap?.position);
        console.log("🔥 [HEAVY DEBUG]   - Score:", playerMap?.score);
        console.log("🔥 [HEAVY DEBUG]   - Moves remaining:", playerMap?.movesRemaining);
        console.log("🔥 [HEAVY DEBUG]   - Mines remaining:", playerMap?.minesRemaining);
        console.log("🔥 [HEAVY DEBUG]   - Time remaining:", timeRemaining);
        console.log("🔥 [HEAVY DEBUG] ===== STARTING POLLING REQUESTS =====");
      }

      console.log("🔄 Polling update...");
      fetchGameStatus();
      fetchAllPlayers();

      // Only fetch player map if user is authenticated and a player
      if (isAuthenticated && jwtToken && isPlayer) {
        fetchPlayerMap();
      }
    }, 10000); // Slowed down to 10 seconds to reduce server load and debug issues

    console.log("✅ Polling interval created with ID:", interval);

    return () => {
      console.log("🛑 Clearing polling interval:", interval);
      clearInterval(interval);
    };
  }, [hasClosed, hasPaidOut, isAuthenticated, jwtToken, isPlayer, fetchPlayerMap, fetchGameStatus, fetchAllPlayers]);

  // Fetch player map when authentication and player status change
  useEffect(() => {
    console.log("🗺️ Map fetch trigger - canPlay:", canPlay, "hasJwtToken:", !!jwtToken);
    if (canPlay && jwtToken) {
      console.log("🔄 Triggering initial map fetch...");
      fetchPlayerMap();
    }
  }, [canPlay, jwtToken, fetchPlayerMap]); // Added fetchPlayerMap back with useCallback

  // Memoize radar calculations to prevent re-renders
  const radarConfig = useMemo(() => {
    if (!canPlay || !playerMap) return null;

    const numPlayers = Number(playerCount || 0);
    const tileSize = numPlayers > 100 ? 1 : numPlayers > 25 ? 2 : numPlayers > 10 ? 3 : numPlayers > 5 ? 4 : 5;
    const mapSize = gameStatus?.mapSize || playerMap.mapSize;

    return {
      tileSize,
      mapSize,
      dimensions: `${mapSize * tileSize + 8}px`,
    };
  }, [canPlay, playerMap, playerCount, gameStatus?.mapSize]);

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
        console.log("🔥 [HEAVY DEBUG]   - Map size:", playerMap.mapSize);
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

    if (heavyDebug) {
      console.log("🔥 [HEAVY DEBUG] ✅ STATE RESET COMPLETE");
      console.log("🔥 [HEAVY DEBUG] All state variables reset to initial values");
      console.log("🔥 [HEAVY DEBUG] ===== END COMPONENT MOUNT / GAME ID CHANGE =====");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

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
                    backgroundColor: tileType !== undefined ? getRadarTileColor(tileType) : "#f3f4f6", // Gray-100 for unknown
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
                    className={`btn btn-primary btn-lg ${startGameLoading ? "loading" : ""}`}
                    onClick={closeGame}
                    disabled={startGameLoading || !playerCount || playerCount === 0n}
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
                <h2 className="text-xl font-bold">Your Game View</h2>
                <div className="text-right">
                  <p className="text-sm text-gray-600">Total Pot</p>
                  <p className="text-lg font-bold text-green-600">
                    {formatEther((stakeAmount || 0n) * (playerCount || 0n))} ETH
                  </p>
                </div>
              </div>

              {/* Interactive 3x3 Map Grid */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3 text-center">
                  Score: {playerMap.score} | Moves: {playerMap.movesRemaining} | Mines: {playerMap.minesRemaining}
                  {playerMap.timeRemaining !== undefined && <> | Time: {playerMap.timeRemaining}s</>}
                </h3>
                <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
                  {playerMap.localView.map((row, rowIndex) =>
                    row.map((cell, colIndex) => {
                      const direction = getDirectionFromPosition(rowIndex, colIndex);
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
                        (typeof cell.tile === "number" ? cell.tile > 0 : cell.tile !== "0"); // Handle both numbers and strings

                      return (
                        <div
                          key={`${rowIndex}-${colIndex}`}
                          className={`
                            w-20 h-20 border-2 border-gray-400 flex items-center justify-center text-sm font-semibold
                            relative transition-all duration-200
                            ${getTileColor(cell.tile)}
                            ${cell.player ? "ring-4 ring-yellow-400" : ""}
                            ${isClickable ? "cursor-pointer hover:brightness-110 hover:scale-105 hover:border-blue-500 hover:shadow-lg" : ""}
                            ${canMine ? "cursor-pointer hover:brightness-110 hover:scale-105 hover:border-green-500 hover:shadow-lg" : ""}
                            ${loading ? "opacity-50" : ""}
                            ${timeRemaining !== null && timeRemaining <= 0 ? "opacity-25 cursor-not-allowed" : ""}
                          `}
                          onClick={() => {
                            console.log("🖱️ Tile clicked:", {
                              rowIndex,
                              colIndex,
                              direction,
                              isClickable,
                              canMine,
                              loading,
                              canPlay,
                              timeRemaining,
                              cellTile: cell.tile,
                              isPlayerTile: cell.player,
                            });

                            if (loading || !canPlay) {
                              console.log("❌ Click blocked - loading or can't play:", { loading, canPlay });
                              return;
                            }
                            if (timeRemaining !== null && timeRemaining <= 0) {
                              console.log("❌ Click blocked - time expired:", timeRemaining);
                              return;
                            }
                            if (isClickable) {
                              console.log("➡️ Triggering movement:", direction);
                              movePlayer(direction);
                            } else if (canMine) {
                              console.log("⛏️ Triggering mining");
                              minePlayer();
                            } else {
                              console.log("❌ Click not actionable");
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
                    }),
                  )}
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
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                          <div>
                            <span className="text-gray-600">Score:</span>
                            <span className="ml-1 font-semibold text-green-600">{player.score}</span>
                          </div>
                          <div>
                            <span className="text-gray-600">Moves:</span>
                            <span className="ml-1 font-semibold text-blue-600">{player.movesRemaining}</span>
                          </div>
                          <div>
                            <span className="text-gray-600">Mines:</span>
                            <span className="ml-1 font-semibold text-orange-600">{player.minesRemaining}</span>
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
                <p className="text-sm text-gray-600 mb-1">Map Size</p>
                <p className="text-xl font-bold text-orange-600">
                  {gameStatus?.mapSize
                    ? `${gameStatus.mapSize}×${gameStatus.mapSize}`
                    : playerMap?.mapSize
                      ? `${playerMap.mapSize}×${playerMap.mapSize}`
                      : "Loading..."}
                </p>
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
              {hasOpened && !hasClosed && timeUntilAbandonmentTimeout > 0n && (
                <div>
                  <p className="text-sm text-gray-600 mb-1">Abandonment Timeout</p>
                  <p className="text-sm text-orange-600">
                    {Math.floor(Number(timeUntilAbandonmentTimeout))} seconds until anyone can start the game
                  </p>
                </div>
              )}
              {hasClosed && timeUntilWithdrawal > 0n && !hasPaidOut && (
                <div>
                  <p className="text-sm text-gray-600 mb-1">Withdrawal Timeout</p>
                  <p className="text-sm text-red-600">
                    {Math.floor(Number(timeUntilWithdrawal))} seconds until players can withdraw
                  </p>
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
