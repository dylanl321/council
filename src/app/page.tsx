"use client";

import { useState } from "react";

const COUNCIL_MEMBERS = [
  {
    id: "strategist",
    name: "The Strategist",
    sigil: "\u2B21",
    color: "#4A9EFF",
    accent: "rgba(74,158,255,0.15)",
    border: "rgba(74,158,255,0.4)",
    title: "Long-Range Thinker",
    systemPrompt: `You are The Strategist on an advisory council. You think in systems, frameworks, and long-range consequences. You identify leverage points, second-order effects, and strategic trade-offs. You speak with calm authority, use structured thinking, and often reframe problems at a higher level. Keep your response to 3-5 focused paragraphs. Be specific and actionable, not generic.`,
  },
  {
    id: "skeptic",
    name: "The Skeptic",
    sigil: "\u25C8",
    color: "#FF6B6B",
    accent: "rgba(255,107,107,0.15)",
    border: "rgba(255,107,107,0.4)",
    title: "Critical Analyst",
    systemPrompt: `You are The Skeptic on an advisory council. Your role is to stress-test ideas, identify hidden assumptions, expose failure modes, and challenge optimistic projections. You are not cynical\u2014you are rigorously honest. You surface what others overlook. You speak directly, sometimes bluntly. Keep your response to 3-5 focused paragraphs. Be specific about risks and weaknesses.`,
  },
  {
    id: "innovator",
    name: "The Innovator",
    sigil: "\u25EC",
    color: "#A8FF6B",
    accent: "rgba(168,255,107,0.15)",
    border: "rgba(168,255,107,0.4)",
    title: "Creative Disruptor",
    systemPrompt: `You are The Innovator on an advisory council. You think laterally, draw unexpected connections across domains, and propose unconventional solutions. You question constraints that others take as given. You speak with enthusiasm and specificity\u2014not vague idealism, but concrete creative proposals. Keep your response to 3-5 focused paragraphs. Offer genuinely novel angles.`,
  },
  {
    id: "pragmatist",
    name: "The Pragmatist",
    sigil: "\u25A3",
    color: "#FFB84A",
    accent: "rgba(255,184,74,0.15)",
    border: "rgba(255,184,74,0.4)",
    title: "Ground-Level Executor",
    systemPrompt: `You are The Pragmatist on an advisory council. You translate abstract ideas into concrete implementation plans. You think about resources, timelines, dependencies, and what it actually takes to execute. You push back on ideas that are theoretically elegant but practically unworkable. Speak plainly and specifically. Keep your response to 3-5 focused paragraphs. Focus on what can be done and how.`,
  },
];

const SYNTHESIZER_PROMPT = `You are the Council Chair synthesizing input from four advisors: The Strategist (systems/long-range thinking), The Skeptic (risks/blind spots), The Innovator (creative alternatives), and The Pragmatist (implementation/execution).

Your job is to:

1. Identify the key points of agreement across advisors
2. Highlight the most important tensions or disagreements
3. Produce a synthesized recommendation that integrates the strongest insights
4. Flag 2-3 concrete next steps

Be direct, structured, and decisive. Do not just summarize\u2014add synthesis value. Use clear sections: **Consensus**, **Key Tensions**, **Recommendation**, **Next Steps**.`;

function formatText(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const boldLine = line.replace(/\*\*(.*?)\*\*/g, (_, m) => `<strong>${m}</strong>`);
    return (
      <p
        key={i}
        className="council-line"
        dangerouslySetInnerHTML={{ __html: boldLine }}
        style={{ margin: "0 0 8px 0", lineHeight: 1.65 }}
      />
    );
  });
}

interface AgentResponse {
  id: string;
  name: string;
  title: string;
  color?: string;
  text: string;
  status: string;
}

export default function AICouncil() {
  const [problem, setProblem] = useState("");
  const [phase, setPhase] = useState<"idle" | "deliberating" | "done">("idle");
  const [responses, setResponses] = useState<AgentResponse[]>([]);
  const [synthesis, setSynthesis] = useState("");
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, string>>({});

  const handleConvene = async () => {
    if (!problem.trim()) return;
    setPhase("deliberating");
    setResponses([]);
    setSynthesis("");

    const initProgress: Record<string, string> = {};
    COUNCIL_MEMBERS.forEach((m) => (initProgress[m.id] = "thinking"));
    setProgress({ ...initProgress });

    try {
      const res = await fetch("/api/council", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents: COUNCIL_MEMBERS.map((m) => ({
            id: m.id,
            name: m.name,
            title: m.title,
            systemPrompt: m.systemPrompt,
          })),
          problem,
          synthesisPrompt: SYNTHESIZER_PROMPT,
        }),
      });

      const data = await res.json();

      const agentResponses: AgentResponse[] = data.results.map((r: AgentResponse) => {
        const member = COUNCIL_MEMBERS.find((m) => m.id === r.id);
        return { ...r, color: member?.color };
      });

      setResponses(agentResponses);
      setSynthesis(data.synthesis);

      const doneProgress: Record<string, string> = {};
      agentResponses.forEach((r) => (doneProgress[r.id] = r.status === "error" ? "error" : "done"));
      setProgress(doneProgress);
      setActiveTab("synthesis");
    } catch {
      const errorProgress: Record<string, string> = {};
      COUNCIL_MEMBERS.forEach((m) => (errorProgress[m.id] = "error"));
      setProgress(errorProgress);
    }

    setPhase("done");
  };

  const busy = phase === "deliberating";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0f",
        color: "#e8e4d8",
        fontFamily: "'Georgia', 'Times New Roman', serif",
        padding: "0",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          backgroundImage: `radial-gradient(ellipse 60% 40% at 20% 10%, rgba(74,158,255,0.06) 0%, transparent 70%), radial-gradient(ellipse 50% 50% at 80% 90%, rgba(255,107,107,0.05) 0%, transparent 70%), radial-gradient(ellipse 40% 60% at 70% 20%, rgba(168,255,107,0.04) 0%, transparent 70%)`,
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 900,
          margin: "0 auto",
          padding: "48px 24px 80px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.3em",
              color: "#666",
              textTransform: "uppercase",
              marginBottom: 16,
            }}
          >
            Multi-Agent Advisory System
          </div>
          <h1
            style={{
              fontSize: "clamp(32px, 5vw, 52px)",
              fontWeight: 400,
              letterSpacing: "-0.02em",
              color: "#f0ece0",
              margin: "0 0 12px",
              textShadow: "0 0 60px rgba(255,255,255,0.05)",
            }}
          >
            The Council
          </h1>
          <p style={{ color: "#888", fontSize: 15, fontStyle: "italic", margin: 0 }}>
            Four perspectives. One synthesis. Powered by Claude Opus via AWS Bedrock.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
            marginBottom: 40,
          }}
        >
          {COUNCIL_MEMBERS.map((m) => {
            const state = progress[m.id];
            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  borderRadius: 4,
                  border: `1px solid ${
                    state === "thinking" || state === "done"
                      ? m.border
                      : "rgba(255,255,255,0.08)"
                  }`,
                  background: state === "done" ? m.accent : "rgba(255,255,255,0.02)",
                  transition: "all 0.4s ease",
                }}
              >
                <span style={{ color: m.color, fontSize: 16 }}>{m.sigil}</span>
                <span style={{ fontSize: 13, color: state === "done" ? "#ddd" : "#777" }}>
                  {m.name}
                </span>
                {state === "thinking" && (
                  <span style={{ fontSize: 10, color: m.color, animation: "pulse 1s infinite" }}>
                    &#9679;
                  </span>
                )}
                {state === "done" && (
                  <span style={{ fontSize: 10, color: m.color }}>&#10003;</span>
                )}
                {state === "error" && (
                  <span style={{ fontSize: 10, color: "#ff4444" }}>&#10007;</span>
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            padding: 24,
            marginBottom: 24,
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: 11,
              letterSpacing: "0.2em",
              color: "#888",
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            Present your problem
          </label>
          <textarea
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            disabled={busy}
            placeholder="Describe the problem, decision, or question you want the council to deliberate on..."
            style={{
              width: "100%",
              minHeight: 100,
              background: "transparent",
              border: "none",
              color: "#e8e4d8",
              fontFamily: "inherit",
              fontSize: 16,
              lineHeight: 1.6,
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <button
            onClick={handleConvene}
            disabled={busy || !problem.trim()}
            style={{
              padding: "14px 40px",
              fontSize: 13,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              background: "transparent",
              border: busy
                ? "1px solid rgba(255,255,255,0.15)"
                : "1px solid rgba(255,255,255,0.4)",
              color: busy ? "#555" : "#e8e4d8",
              borderRadius: 3,
              cursor: busy ? "not-allowed" : "pointer",
              transition: "all 0.3s",
              fontFamily: "inherit",
            }}
          >
            {busy ? "Council deliberating..." : "Convene the Council"}
          </button>
        </div>

        {(responses.length > 0 || synthesis) && (
          <div>
            <div
              style={{
                display: "flex",
                gap: 4,
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                marginBottom: 32,
                overflowX: "auto",
              }}
            >
              {synthesis && (
                <button
                  onClick={() => setActiveTab("synthesis")}
                  style={{
                    padding: "10px 20px",
                    fontSize: 12,
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    background: "transparent",
                    border: "none",
                    borderBottom:
                      activeTab === "synthesis"
                        ? "2px solid #e8e4d8"
                        : "2px solid transparent",
                    color: activeTab === "synthesis" ? "#e8e4d8" : "#666",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  &#x2B21; Synthesis
                </button>
              )}
              {responses.map((r) => {
                const m = COUNCIL_MEMBERS.find((c) => c.id === r.id);
                if (!m) return null;
                return (
                  <button
                    key={r.id}
                    onClick={() => setActiveTab(r.id)}
                    style={{
                      padding: "10px 20px",
                      fontSize: 12,
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      background: "transparent",
                      border: "none",
                      borderBottom:
                        activeTab === r.id
                          ? `2px solid ${m.color}`
                          : "2px solid transparent",
                      color: activeTab === r.id ? m.color : "#666",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.sigil} {r.name}
                  </button>
                );
              })}
            </div>

            {activeTab === "synthesis" && synthesis && (
              <div
                style={{
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  padding: 32,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.25em",
                    color: "#888",
                    textTransform: "uppercase",
                    marginBottom: 20,
                  }}
                >
                  Council Synthesis
                </div>
                <div style={{ fontSize: 15.5, lineHeight: 1.7, color: "#d8d4c8" }}>
                  {formatText(synthesis)}
                </div>
              </div>
            )}

            {COUNCIL_MEMBERS.map((m) => {
              const resp = responses.find((r) => r.id === m.id);
              if (activeTab !== m.id || !resp) return null;
              return (
                <div
                  key={m.id}
                  style={{
                    background: m.accent,
                    border: `1px solid ${m.border}`,
                    borderRadius: 6,
                    padding: 32,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 12,
                      marginBottom: 20,
                    }}
                  >
                    <span style={{ fontSize: 24, color: m.color }}>{m.sigil}</span>
                    <div>
                      <div style={{ fontSize: 18, color: m.color, fontWeight: 400 }}>
                        {m.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#888",
                          letterSpacing: "0.15em",
                          textTransform: "uppercase",
                        }}
                      >
                        {m.title}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 15.5, lineHeight: 1.7, color: "#d8d4c8" }}>
                    {formatText(resp.text)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        textarea::placeholder { color: #444; }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>
    </div>
  );
}
