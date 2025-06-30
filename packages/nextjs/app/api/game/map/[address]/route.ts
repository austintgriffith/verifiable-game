import { NextResponse } from "next/server";

const GAME_SERVER_URL = "http://localhost:8000";

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    const response = await fetch(`${GAME_SERVER_URL}/map/${address}`);
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch player map:", error);
    return NextResponse.json({ error: "Failed to connect to game server" }, { status: 500 });
  }
}
