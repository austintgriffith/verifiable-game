import { NextResponse } from "next/server";

const GAME_SERVER_URL = "http://localhost:8000";

export async function POST(request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    const body = await request.json();

    const response = await fetch(`${GAME_SERVER_URL}/move/${address}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to move player:", error);
    return NextResponse.json({ error: "Failed to connect to game server" }, { status: 500 });
  }
}
