"use client";

import { useCallback, useEffect, useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { Address } from "~~/components/scaffold-eth";

// Types for the game API responses
interface GameStatus {
  success: boolean;
  gameLoaded: boolean;
  mapSize: number;
  totalPlayers: number;
  players: string[];
  revealSeed: string;
  serverTime: string;
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
  legend: Record<string, string>;
}

interface PlayerInfo {
  address: string;
  position: { x: number; y: number };
  tile: number;
}

const API_BASE = "/api/game";

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();

  const [gameStatus, setGameStatus] = useState<GameStatus | null>(null);
  const [playerMap, setPlayerMap] = useState<MapResponse | null>(null);
  const [allPlayers, setAllPlayers] = useState<PlayerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPlayer = connectedAddress && gameStatus?.players.includes(connectedAddress);

  // Fetch game status
  const fetchGameStatus = async () => {
    try {
      const response = await fetch(`${API_BASE}/status`);
      const data = await response.json();
      setGameStatus(data);
    } catch (err) {
      console.error("Failed to fetch game status:", err);
      setError("Failed to connect to game server");
    }
  };

  // Fetch all players
  const fetchAllPlayers = async () => {
    try {
      const response = await fetch(`${API_BASE}/players`);
      const data = await response.json();
      if (data.success) {
        setAllPlayers(data.players);
      }
    } catch (err) {
      console.error("Failed to fetch players:", err);
    }
  };

  // Fetch player's map view - using useCallback to prevent infinite re-renders
  const fetchPlayerMap = useCallback(async () => {
    if (!connectedAddress || !isPlayer) return;

    try {
      const response = await fetch(`${API_BASE}/map/${connectedAddress}`);
      const data = await response.json();
      if (data.success) {
        setPlayerMap(data);
      }
    } catch (err) {
      console.error("Failed to fetch player map:", err);
    }
  }, [connectedAddress, isPlayer]);

  // Move player
  const movePlayer = async (direction: string) => {
    if (!connectedAddress || !isPlayer) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/move/${connectedAddress}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ direction }),
      });

      const data = await response.json();

      if (data.success) {
        // Update the map with new position
        setPlayerMap(prevMap =>
          prevMap
            ? {
                ...prevMap,
                localView: data.localView,
                position: data.newPosition,
              }
            : null,
        );
        // Refresh all players to see updated positions
        fetchAllPlayers();
      } else {
        setError(data.error || "Move failed");
      }
    } catch (err) {
      console.error("Failed to move player:", err);
      setError("Failed to move player");
    } finally {
      setLoading(false);
    }
  };

  // Poll for updates every 2 seconds
  useEffect(() => {
    fetchGameStatus();
    fetchAllPlayers();

    const interval = setInterval(() => {
      fetchGameStatus();
      fetchAllPlayers();
      if (isPlayer) {
        fetchPlayerMap();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [connectedAddress, isPlayer, fetchPlayerMap]);

  // Fetch player map when becoming a player
  useEffect(() => {
    if (isPlayer) {
      fetchPlayerMap();
    }
  }, [isPlayer, connectedAddress, fetchPlayerMap]);

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
      <div className="flex items-center flex-col grow pt-10">
        <div className="px-5 w-full max-w-4xl">
          <h1 className="text-center mb-8">
            <span className="block text-2xl mb-2">Welcome to</span>
            <span className="block text-4xl font-bold">Grid Exploration Game</span>
          </h1>

          {/* Connection Status */}
          <div className="flex justify-center items-center space-x-2 flex-col mb-6">
            <p className="my-2 font-medium">Connected Address:</p>
            <Address address={connectedAddress} />
          </div>

          {/* Error Display */}
          {error && (
            <div className="alert alert-error mb-4">
              <span>{error}</span>
              <button className="btn btn-sm" onClick={() => setError(null)}>
                ×
              </button>
            </div>
          )}

          {/* Game Status */}
          {gameStatus && (
            <div className="bg-base-100 rounded-lg p-6 mb-6 shadow-lg">
              <h2 className="text-xl font-bold mb-4">Game Status</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="font-semibold">Game Loaded:</p>
                  <p className={gameStatus.gameLoaded ? "text-green-600" : "text-red-600"}>
                    {gameStatus.gameLoaded ? "Yes" : "No"}
                  </p>
                </div>
                <div>
                  <p className="font-semibold">Map Size:</p>
                  <p>
                    {gameStatus.mapSize}x{gameStatus.mapSize}
                  </p>
                </div>
                <div>
                  <p className="font-semibold">Total Players:</p>
                  <p>{gameStatus.totalPlayers}</p>
                </div>
                <div>
                  <p className="font-semibold">You are a player:</p>
                  <p className={isPlayer ? "text-green-600" : "text-red-600"}>{isPlayer ? "Yes" : "No"}</p>
                </div>
              </div>
            </div>
          )}

          {/* All Players List */}
          {allPlayers.length > 0 && (
            <div className="bg-base-100 rounded-lg p-6 mb-6 shadow-lg">
              <h2 className="text-xl font-bold mb-4">All Players ({allPlayers.length})</h2>
              <div className="space-y-2">
                {allPlayers.map(player => (
                  <div key={player.address} className="flex justify-between items-center p-3 bg-base-200 rounded">
                    <Address address={player.address} />
                    <div className="text-sm">
                      <span className="mr-4">
                        Position: ({player.position.x}, {player.position.y})
                      </span>
                      <span className={`px-2 py-1 rounded ${getTileColor(player.tile)}`}>
                        {getTileName(player.tile)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Player's Game Interface */}
          {isPlayer && playerMap && (
            <div className="bg-base-100 rounded-lg p-6 shadow-lg">
              <h2 className="text-xl font-bold mb-4">Your Game View</h2>

              {/* Current Position */}
              <div className="mb-6 text-center">
                <p className="font-semibold">
                  Current Position: ({playerMap.position.x}, {playerMap.position.y})
                </p>
              </div>

              {/* Interactive 3x3 Map Grid */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3 text-center">Local View (Click to Move)</h3>
                <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
                  {playerMap.localView.map((row, rowIndex) =>
                    row.map((cell, colIndex) => {
                      const direction = getDirectionFromPosition(rowIndex, colIndex);
                      const isClickable = cell && !cell.player && direction;

                      return (
                        <div
                          key={`${rowIndex}-${colIndex}`}
                          className={`
                            w-20 h-20 border-2 border-gray-400 flex items-center justify-center text-sm font-semibold
                            relative transition-all duration-200
                            ${cell ? getTileColor(cell.tile) : "bg-gray-100"}
                            ${cell?.player ? "ring-4 ring-yellow-400" : ""}
                            ${isClickable ? "cursor-pointer hover:brightness-110 hover:scale-105 hover:border-blue-500 hover:shadow-lg" : ""}
                            ${loading ? "opacity-50" : ""}
                          `}
                          onClick={() => isClickable && !loading && movePlayer(direction)}
                          title={
                            isClickable ? `Move ${direction}` : cell?.player ? "Your position" : "Cannot move here"
                          }
                        >
                          {cell ? (
                            <div className="text-center">
                              <div>{cell.tile}</div>
                              {cell.player && <div className="text-yellow-600">👤</div>}
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
                        </div>
                      );
                    }),
                  )}
                </div>
                <p className="text-center text-sm text-gray-600 mt-2">
                  Click on adjacent tiles to move in that direction
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

          {/* Instructions for non-players */}
          {!isPlayer && connectedAddress && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm text-yellow-700">
                    Your wallet address is not registered as a player in this game. Contact the game administrator to be
                    added as a player.
                  </p>
                </div>
              </div>
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
        </div>
      </div>
    </>
  );
};

export default Home;
