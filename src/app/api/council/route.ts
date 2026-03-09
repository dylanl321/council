import { NextRequest, NextResponse } from "next/server";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

const bedrock = new BedrockRuntimeClient({ region: "us-east-1" });

const MODEL_ID = "us.anthropic.claude-opus-4-6-v1";

interface AgentRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}

async function callBedrock({ systemPrompt, userMessage, maxTokens = 1000 }: AgentRequest): Promise<string> {
  const command = new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: systemPrompt }],
    messages: [
      {
        role: "user",
        content: [{ text: userMessage }],
      },
    ],
    inferenceConfig: {
      maxTokens,
    },
  });

  const response = await bedrock.send(command);
  const outputMessage = response.output?.message;
  if (outputMessage?.content?.[0] && "text" in outputMessage.content[0]) {
    return outputMessage.content[0].text ?? "No response.";
  }
  return "No response.";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agents, problem } = body as {
      agents: { id: string; name: string; title: string; systemPrompt: string }[];
      problem: string;
      synthesisPrompt?: string;
    };

    if (!problem || !agents?.length) {
      return NextResponse.json({ error: "Missing problem or agents" }, { status: 400 });
    }

    // Query all agents in parallel
    const results = await Promise.all(
      agents.map(async (agent) => {
        try {
          const text = await callBedrock({
            systemPrompt: agent.systemPrompt,
            userMessage: `The problem or question before the council:\n\n${problem}`,
          });
          return { id: agent.id, name: agent.name, title: agent.title, text, status: "done" as const };
        } catch (err) {
          console.error(`Agent ${agent.id} failed:`, err);
          return { id: agent.id, name: agent.name, title: agent.title, text: "Error generating response.", status: "error" as const };
        }
      })
    );

    // Synthesize
    let synthesis = "Synthesis unavailable.";
    if (body.synthesisPrompt) {
      const advisorInput = results
        .filter((r) => r.status === "done")
        .map((r) => `### ${r.name} (${r.title})\n${r.text}`)
        .join("\n\n---\n\n");

      try {
        synthesis = await callBedrock({
          systemPrompt: body.synthesisPrompt,
          userMessage: `**Problem:** ${problem}\n\n**Advisor Inputs:**\n\n${advisorInput}`,
        });
      } catch (err) {
        console.error("Synthesis failed:", err);
      }
    }

    return NextResponse.json({ results, synthesis });
  } catch (err) {
    console.error("Council API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
