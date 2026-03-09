import { NextRequest } from "next/server";
import { runDeliberation, DeliberationEvent } from "@/lib/deliberation-graph";
import { EXPERT_GROUPS_MAP } from "@/lib/expert-groups";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { problem, groupId } = body as { problem: string; groupId: string };

    if (!problem?.trim()) {
      return new Response(JSON.stringify({ error: "Missing problem" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const group = EXPERT_GROUPS_MAP[groupId];
    if (!group) {
      return new Response(JSON.stringify({ error: `Unknown group: ${groupId}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const encoder = new TextEncoder();
    let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        function send(event: DeliberationEvent) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        }

        keepaliveInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch {
            // stream already closed
          }
        }, 15000);

        try {
          for await (const event of runDeliberation(problem, group.members, group.synthesizerPrompt)) {
            send(event);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          send({ type: "error", message: msg });
        } finally {
          if (keepaliveInterval) clearInterval(keepaliveInterval);
          controller.close();
        }
      },
      cancel() {
        if (keepaliveInterval) clearInterval(keepaliveInterval);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Council API error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
