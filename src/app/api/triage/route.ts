import { NextRequest } from "next/server";
import { triageProblem } from "@/lib/triage";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { problem } = body as { problem: string };

    if (!problem?.trim()) {
      return new Response(JSON.stringify({ error: "Missing problem" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await triageProblem(problem);

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Triage API error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
