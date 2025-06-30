import { NextResponse } from "next/server";

const GAME_SERVER_URL = "http://localhost:8000";

export async function GET() {
  try {
    const response = await fetch(`${GAME_SERVER_URL}/players`);
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch players:", error);
    return NextResponse.json({ error: "Failed to connect to game server" }, { status: 500 });
  }
}
