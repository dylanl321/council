import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { shortModel } from "./models";
import { EXPERT_GROUPS } from "./expert-groups";

export interface TriageResult {
  action: "proceed" | "clarify";
  groupId: string;
  confidence: number;
  reasoning: string;
  refinedProblem?: string;
  questions?: string[];
}

const TRIAGE_SYSTEM_PROMPT = `You are a triage system for an AI advisory council. Your job is to classify problems and route them to the best expert group.

Available expert groups:
${EXPERT_GROUPS.map((g) => `- id: "${g.id}" | name: "${g.name}" | description: ${g.description} | keywords: ${g.keywords.join(", ")}`).join("\n")}

You must return valid JSON with this exact structure:
{
  "action": "proceed" or "clarify",
  "groupId": "<group id from list above>",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation of why this group was chosen>",
  "refinedProblem": "<cleaned-up version of the prompt that adds structure without changing intent>",
  "questions": ["<question 1>", "<question 2>"] // only when action is "clarify", max 3 questions
}

Guidelines:
- Only set action to "clarify" if the prompt is genuinely too vague to give useful advice (missing domain, scale, constraints, or core intent)
- If the problem is reasonably clear, always set action to "proceed" even if it could be more detailed
- Limit clarifying questions to 2-3 max, each should be specific and actionable
- Always suggest a groupId even when clarifying
- The refinedProblem should add structure (e.g., bullet points, clearer framing) without changing the user's intent
- If no specialized group fits well, use "general"

Return ONLY the JSON object, no markdown formatting or extra text.`;

export async function triageProblem(problem: string): Promise<TriageResult> {
  try {
    const response = await shortModel.invoke([
      new SystemMessage(TRIAGE_SYSTEM_PROMPT),
      new HumanMessage(problem),
    ]);

    const text =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .filter((b): b is { type: "text"; text: string } => typeof b === "object" && "type" in b && b.type === "text")
              .map((b) => b.text)
              .join("")
          : "";

    const parsed = JSON.parse(text.trim());

    return {
      action: parsed.action === "clarify" ? "clarify" : "proceed",
      groupId: parsed.groupId || "general",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      reasoning: parsed.reasoning || "",
      refinedProblem: parsed.refinedProblem || undefined,
      questions:
        parsed.action === "clarify" && Array.isArray(parsed.questions)
          ? parsed.questions.slice(0, 3)
          : undefined,
    };
  } catch {
    return {
      action: "proceed",
      groupId: "general",
      confidence: 0.5,
      reasoning: "Could not classify the problem; defaulting to general advisory.",
    };
  }
}
