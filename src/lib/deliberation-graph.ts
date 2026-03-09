import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { CouncilMember } from "./council-members";
import { model, shortModel } from "./models";

function buildOtherAgentsContext(
  rounds: Record<number, Record<string, string>>,
  currentAgentId: string,
  upToRound: number,
  members: CouncilMember[]
): string {
  const parts: string[] = [];
  for (let r = 1; r <= upToRound; r++) {
    const roundData = rounds[r];
    if (!roundData) continue;
    for (const member of members) {
      if (member.id === currentAgentId) continue;
      if (roundData[member.id]) {
        parts.push(`[Round ${r}] ${member.name} (${member.title}):\n${roundData[member.id]}`);
      }
    }
  }
  return parts.join("\n\n---\n\n");
}

function buildAllRoundsContext(
  rounds: Record<number, Record<string, string>>,
  upToRound: number,
  members: CouncilMember[]
): string {
  const parts: string[] = [];
  for (let r = 1; r <= upToRound; r++) {
    const roundData = rounds[r];
    if (!roundData) continue;
    parts.push(`## Round ${r}`);
    for (const member of members) {
      if (roundData[member.id]) {
        parts.push(`### ${member.name} (${member.title})\n${roundData[member.id]}`);
      }
    }
  }
  return parts.join("\n\n");
}

export interface DeliberationEvent {
  type: "phase" | "agent_start" | "delta" | "agent_done" | "done" | "error";
  label?: string;
  agentId?: string;
  round?: number;
  text?: string;
  message?: string;
}

export async function* runDeliberation(
  problem: string,
  members: CouncilMember[],
  synthesizerPrompt: string
): AsyncGenerator<DeliberationEvent> {
  const rounds: Record<number, Record<string, string>> = {};

  // Round 1 -- Initial Perspectives
  yield { type: "phase", label: "Round 1 \u2014 Initial Perspectives" };
  rounds[1] = {};
  for (const member of members) {
    yield { type: "agent_start", agentId: member.id, round: 1 };
    try {
      let fullText = "";
      const stream = await model.stream([
        new SystemMessage(member.systemPrompt),
        new HumanMessage(`The problem or question before the council:\n\n${problem}`),
      ]);
      for await (const chunk of stream) {
        const token = typeof chunk.content === "string" ? chunk.content : "";
        if (token) {
          fullText += token;
          yield { type: "delta", agentId: member.id, round: 1, text: token };
        }
      }
      rounds[1][member.id] = fullText;
      yield { type: "agent_done", agentId: member.id, round: 1 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      yield { type: "error", agentId: member.id, round: 1, message: msg };
      rounds[1][member.id] = "(Error generating response)";
      yield { type: "agent_done", agentId: member.id, round: 1 };
    }
  }

  // Round 2 -- Cross-Examination
  yield { type: "phase", label: "Round 2 \u2014 Cross-Examination" };
  rounds[2] = {};
  for (const member of members) {
    yield { type: "agent_start", agentId: member.id, round: 2 };
    try {
      const otherContext = buildOtherAgentsContext(rounds, member.id, 1, members);
      const augmentedSystem = `${member.systemPrompt}\n\nYou are now in the Cross-Examination round. You have heard the other council members' initial perspectives below. Respond to their points directly -- agree, challenge, build on, or refine. Reference specific arguments by name. Do NOT repeat your initial position; instead react to what others said.`;
      let fullText = "";
      const stream = await model.stream([
        new SystemMessage(augmentedSystem),
        new HumanMessage(
          `**Original Problem:** ${problem}\n\n**Other Council Members' Initial Perspectives:**\n\n${otherContext}`
        ),
      ]);
      for await (const chunk of stream) {
        const token = typeof chunk.content === "string" ? chunk.content : "";
        if (token) {
          fullText += token;
          yield { type: "delta", agentId: member.id, round: 2, text: token };
        }
      }
      rounds[2][member.id] = fullText;
      yield { type: "agent_done", agentId: member.id, round: 2 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      yield { type: "error", agentId: member.id, round: 2, message: msg };
      rounds[2][member.id] = "(Error generating response)";
      yield { type: "agent_done", agentId: member.id, round: 2 };
    }
  }

  // Round 3 -- Final Refinements
  yield { type: "phase", label: "Round 3 \u2014 Final Refinements" };
  rounds[3] = {};
  for (const member of members) {
    yield { type: "agent_start", agentId: member.id, round: 3 };
    try {
      const otherContext = buildOtherAgentsContext(rounds, member.id, 2, members);
      const augmentedSystem = `${member.systemPrompt}\n\nThis is the Final Refinement round. You have now seen two rounds of discussion from all council members. Give a brief, sharp final statement: what is your refined position after hearing the full deliberation? What is the single most important insight or recommendation from your perspective? Be concise (2-3 paragraphs max).`;
      let fullText = "";
      const stream = await shortModel.stream([
        new SystemMessage(augmentedSystem),
        new HumanMessage(
          `**Original Problem:** ${problem}\n\n**Full Deliberation So Far:**\n\n${otherContext}`
        ),
      ]);
      for await (const chunk of stream) {
        const token = typeof chunk.content === "string" ? chunk.content : "";
        if (token) {
          fullText += token;
          yield { type: "delta", agentId: member.id, round: 3, text: token };
        }
      }
      rounds[3][member.id] = fullText;
      yield { type: "agent_done", agentId: member.id, round: 3 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      yield { type: "error", agentId: member.id, round: 3, message: msg };
      rounds[3][member.id] = "(Error generating response)";
      yield { type: "agent_done", agentId: member.id, round: 3 };
    }
  }

  // Synthesis
  yield { type: "phase", label: "Synthesis \u2014 Council Chair" };
  yield { type: "agent_start", agentId: "synthesis", round: 0 };
  try {
    const allContext = buildAllRoundsContext(rounds, 3, members);
    let fullText = "";
    const stream = await model.stream([
      new SystemMessage(synthesizerPrompt),
      new HumanMessage(
        `**Problem:** ${problem}\n\n**Full Council Deliberation (3 Rounds):**\n\n${allContext}`
      ),
    ]);
    for await (const chunk of stream) {
      const token = typeof chunk.content === "string" ? chunk.content : "";
      if (token) {
        fullText += token;
        yield { type: "delta", agentId: "synthesis", round: 0, text: token };
      }
    }
    yield { type: "agent_done", agentId: "synthesis", round: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    yield { type: "error", agentId: "synthesis", round: 0, message: msg };
  }

  yield { type: "done" };
}
