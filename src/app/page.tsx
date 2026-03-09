"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { CouncilMember } from "@/lib/council-members";
import {
  EXPERT_GROUPS,
  EXPERT_GROUPS_MAP,
  DEFAULT_GROUP_ID,
} from "@/lib/expert-groups";
import type { TriageResult } from "@/lib/triage";

interface Message {
  agentId: string;
  round: number;
  text: string;
  isStreaming: boolean;
  isDone: boolean;
}

interface PhaseHeader {
  type: "phase";
  label: string;
}

type TimelineEntry = (Message & { type: "message" }) | PhaseHeader;

type Phase = "idle" | "triaging" | "clarifying" | "deliberating" | "done";

function formatText(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const boldLine = line.replace(
      /\*\*(.*?)\*\*/g,
      (_, m) => `<strong>${m}</strong>`
    );
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

export default function AICouncil() {
  const [problem, setProblem] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [currentPhaseLabel, setCurrentPhaseLabel] = useState("");
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [collapsedRounds, setCollapsedRounds] = useState<Set<string>>(
    new Set()
  );
  const [viewMode, setViewMode] = useState<"timeline" | "agent">("timeline");
  const [activeAgentTab, setActiveAgentTab] = useState<string>("strategist");
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(DEFAULT_GROUP_ID);
  const [clarifyAnswers, setClarifyAnswers] = useState<string[]>([]);
  const [groupBanner, setGroupBanner] = useState<string | null>(null);
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const currentMembers = useMemo(
    () => EXPERT_GROUPS_MAP[selectedGroupId]?.members ?? EXPERT_GROUPS_MAP[DEFAULT_GROUP_ID].members,
    [selectedGroupId]
  );

  const MEMBER_MAP = useMemo(() => {
    const map: Record<string, CouncilMember> = {};
    currentMembers.forEach((m) => (map[m.id] = m));
    return map;
  }, [currentMembers]);

  // Batched update refs
  const pendingDeltasRef = useRef<Map<string, string>>(new Map());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (phase === "deliberating") {
      scrollToBottom();
    }
  }, [timeline, phase, scrollToBottom]);

  const flushDeltas = useCallback(() => {
    const deltas = pendingDeltasRef.current;
    if (deltas.size === 0) return;
    const batch = new Map(deltas);
    deltas.clear();

    setTimeline((prev) => {
      const next = [...prev];
      for (const [key, text] of batch) {
        for (let i = next.length - 1; i >= 0; i--) {
          const entry = next[i];
          if (
            entry.type === "message" &&
            `${entry.agentId}-${entry.round}` === key
          ) {
            next[i] = { ...entry, text: entry.text + text };
            break;
          }
        }
      }
      return next;
    });
  }, []);

  const handleConvene = async () => {
    if (!problem.trim()) return;

    // If user has manually selected a non-default group, skip triage
    const manualOverride = selectedGroupId !== DEFAULT_GROUP_ID;
    if (manualOverride) {
      handleStartDeliberation(selectedGroupId, problem);
      return;
    }

    setPhase("triaging");
    setTriageResult(null);

    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem }),
      });

      if (!res.ok) {
        // Fallback: proceed with general
        handleStartDeliberation("general", problem);
        return;
      }

      const result: TriageResult = await res.json();
      setTriageResult(result);

      if (result.action === "clarify" && result.questions?.length) {
        setSelectedGroupId(result.groupId);
        setClarifyAnswers(new Array(result.questions.length).fill(""));
        setPhase("clarifying");
      } else {
        setSelectedGroupId(result.groupId);
        handleStartDeliberation(
          result.groupId,
          result.refinedProblem || problem
        );
      }
    } catch {
      // Fallback: proceed with general
      handleStartDeliberation("general", problem);
    }
  };

  const handleClarifySubmit = async () => {
    if (!triageResult?.questions) return;

    const qa = triageResult.questions
      .map((q, i) => `Q: ${q}\nA: ${clarifyAnswers[i] || "(no answer)"}`)
      .join("\n\n");
    const augmentedProblem = `${problem}\n\nAdditional context:\n${qa}`;

    setPhase("triaging");

    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem: augmentedProblem }),
      });

      if (!res.ok) {
        handleStartDeliberation(selectedGroupId, augmentedProblem);
        return;
      }

      const result: TriageResult = await res.json();
      setTriageResult(result);
      setSelectedGroupId(result.groupId);
      handleStartDeliberation(
        result.groupId,
        result.refinedProblem || augmentedProblem
      );
    } catch {
      handleStartDeliberation(selectedGroupId, augmentedProblem);
    }
  };

  const handleClarifySkip = () => {
    handleStartDeliberation(
      triageResult?.groupId || selectedGroupId,
      triageResult?.refinedProblem || problem
    );
  };

  const handleStartDeliberation = async (groupId: string, deliberationProblem: string) => {
    const group = EXPERT_GROUPS_MAP[groupId];
    if (group) {
      setSelectedGroupId(groupId);
      setActiveAgentTab(group.members[0].id);
      setGroupBanner(group.name);
      setTimeout(() => setGroupBanner(null), 3000);
    }

    setPhase("deliberating");
    setTimeline([]);
    setCollapsedRounds(new Set());
    setCurrentPhaseLabel("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/council", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem: deliberationProblem, groupId }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setPhase("done");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);
          let event;
          try {
            event = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          switch (event.type) {
            case "phase":
              // Flush any pending deltas first
              if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
              }
              flushDeltas();
              setCurrentPhaseLabel(event.label);
              setTimeline((prev) => [
                ...prev,
                { type: "phase", label: event.label },
              ]);
              break;

            case "agent_start":
              if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
              }
              flushDeltas();
              setTimeline((prev) => [
                ...prev,
                {
                  type: "message",
                  agentId: event.agentId,
                  round: event.round,
                  text: "",
                  isStreaming: true,
                  isDone: false,
                },
              ]);
              break;

            case "delta": {
              const key = `${event.agentId}-${event.round}`;
              const existing = pendingDeltasRef.current.get(key) || "";
              pendingDeltasRef.current.set(key, existing + event.text);

              if (!flushTimerRef.current) {
                flushTimerRef.current = setTimeout(() => {
                  flushTimerRef.current = null;
                  flushDeltas();
                }, 50);
              }
              break;
            }

            case "agent_done":
              if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
              }
              flushDeltas();
              setTimeline((prev) => {
                const next = [...prev];
                for (let i = next.length - 1; i >= 0; i--) {
                  const entry = next[i];
                  if (
                    entry.type === "message" &&
                    entry.agentId === event.agentId &&
                    entry.round === event.round
                  ) {
                    next[i] = { ...entry, isStreaming: false, isDone: true };
                    break;
                  }
                }
                return next;
              });
              break;

            case "done":
              setPhase("done");
              break;

            case "error":
              console.error("SSE error:", event.message);
              break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("Fetch error:", err);
      }
    } finally {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      flushDeltas();
      setPhase("done");
    }
  };

  const toggleRoundCollapse = (label: string) => {
    setCollapsedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const busy = phase === "triaging" || phase === "clarifying" || phase === "deliberating";

  // Build per-agent data for Agent View
  const agentMessages = timeline.filter(
    (e): e is Message & { type: "message" } => e.type === "message"
  );

  // Determine which phase header each message belongs to for collapse
  let currentCollapseLabel = "";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0f",
        color: "#e8e4d8",
        fontFamily: "'Georgia', 'Times New Roman', serif",
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
        {/* Header */}
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
          <p
            style={{
              color: "#888",
              fontSize: 15,
              fontStyle: "italic",
              margin: 0,
            }}
          >
            Three rounds of deliberation. Four perspectives. One synthesis.
          </p>
        </div>

        {/* Expert group selector */}
        {(phase === "idle" || phase === "done") && (
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "center",
              flexWrap: "wrap",
              marginBottom: 24,
            }}
          >
            {EXPERT_GROUPS.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  setSelectedGroupId(g.id);
                  setActiveAgentTab(EXPERT_GROUPS_MAP[g.id].members[0].id);
                }}
                title={g.description}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  letterSpacing: "0.05em",
                  background:
                    selectedGroupId === g.id
                      ? "rgba(255,255,255,0.1)"
                      : "rgba(255,255,255,0.02)",
                  border:
                    selectedGroupId === g.id
                      ? "1px solid rgba(255,255,255,0.3)"
                      : "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 4,
                  color: selectedGroupId === g.id ? "#e8e4d8" : "#777",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.2s",
                }}
              >
                {g.icon} {g.name}
              </button>
            ))}
          </div>
        )}

        {/* Council member badges */}
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
            marginBottom: 40,
          }}
        >
          {currentMembers.map((m) => {
            const isActive =
              busy &&
              timeline.some(
                (e) =>
                  e.type === "message" &&
                  e.agentId === m.id &&
                  e.isStreaming
              );
            const isDone =
              phase === "done" ||
              timeline.some(
                (e) =>
                  e.type === "message" &&
                  e.agentId === m.id &&
                  e.isDone
              );
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
                    isActive || isDone ? m.border : "rgba(255,255,255,0.08)"
                  }`,
                  background: isDone ? m.accent : "rgba(255,255,255,0.02)",
                  transition: "all 0.4s ease",
                }}
              >
                <span style={{ color: m.color, fontSize: 16 }}>{m.sigil}</span>
                <span
                  style={{
                    fontSize: 13,
                    color: isDone ? "#ddd" : "#777",
                  }}
                >
                  {m.name}
                </span>
                {isActive && (
                  <span
                    style={{
                      fontSize: 10,
                      color: m.color,
                      animation: "pulse 1s infinite",
                    }}
                  >
                    &#9679;
                  </span>
                )}
                {isDone && !isActive && (
                  <span style={{ fontSize: 10, color: m.color }}>&#10003;</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Input */}
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
            {phase === "triaging"
              ? "Analyzing..."
              : phase === "deliberating"
                ? "Council deliberating..."
                : "Convene the Council"}
          </button>
        </div>

        {/* Triage spinner */}
        {phase === "triaging" && (
          <div
            style={{
              textAlign: "center",
              marginBottom: 24,
              fontSize: 13,
              color: "#888",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              animation: "pulse 2s infinite",
            }}
          >
            Analyzing your problem...
          </div>
        )}

        {/* Group routing banner */}
        {groupBanner && phase === "deliberating" && (
          <div
            className="fade-in"
            style={{
              textAlign: "center",
              marginBottom: 16,
              padding: "8px 16px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              fontSize: 12,
              letterSpacing: "0.1em",
              color: "#aaa",
            }}
          >
            Routing to <strong style={{ color: "#e8e4d8" }}>{groupBanner}</strong>
          </div>
        )}

        {/* Clarification panel */}
        {phase === "clarifying" && triageResult && (
          <div
            className="fade-in"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              padding: 24,
              marginBottom: 32,
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "#888",
                marginBottom: 12,
              }}
            >
              Clarification Needed
            </div>
            {triageResult.reasoning && (
              <p
                style={{
                  fontSize: 14,
                  color: "#aaa",
                  fontStyle: "italic",
                  marginBottom: 20,
                  lineHeight: 1.6,
                }}
              >
                {triageResult.reasoning}
              </p>
            )}
            {triageResult.questions?.map((q, i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    color: "#ccc",
                    marginBottom: 6,
                  }}
                >
                  {q}
                </label>
                <input
                  type="text"
                  value={clarifyAnswers[i] || ""}
                  onChange={(e) => {
                    const next = [...clarifyAnswers];
                    next[i] = e.target.value;
                    setClarifyAnswers(next);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 4,
                    color: "#e8e4d8",
                    fontFamily: "inherit",
                    fontSize: 14,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            ))}
            <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
              <button
                onClick={handleClarifySubmit}
                style={{
                  padding: "10px 24px",
                  fontSize: 12,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.3)",
                  color: "#e8e4d8",
                  borderRadius: 3,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Submit & Re-analyze
              </button>
              <button
                onClick={handleClarifySkip}
                style={{
                  padding: "10px 24px",
                  fontSize: 12,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "#888",
                  borderRadius: 3,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Skip - Proceed Anyway
              </button>
            </div>
          </div>
        )}

        {/* Current phase indicator */}
        {phase === "deliberating" && currentPhaseLabel && (
          <div
            style={{
              textAlign: "center",
              marginBottom: 24,
              fontSize: 13,
              color: "#888",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              animation: "pulse 2s infinite",
            }}
          >
            {currentPhaseLabel}
          </div>
        )}

        {/* View toggle */}
        {timeline.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 4,
              marginBottom: 24,
              justifyContent: "center",
            }}
          >
            <button
              onClick={() => setViewMode("timeline")}
              style={{
                padding: "8px 20px",
                fontSize: 12,
                letterSpacing: "0.1em",
                background:
                  viewMode === "timeline"
                    ? "rgba(255,255,255,0.08)"
                    : "transparent",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "3px 0 0 3px",
                color: viewMode === "timeline" ? "#e8e4d8" : "#666",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Timeline View
            </button>
            <button
              onClick={() => setViewMode("agent")}
              style={{
                padding: "8px 20px",
                fontSize: 12,
                letterSpacing: "0.1em",
                background:
                  viewMode === "agent"
                    ? "rgba(255,255,255,0.08)"
                    : "transparent",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "0 3px 3px 0",
                color: viewMode === "agent" ? "#e8e4d8" : "#666",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Agent View
            </button>
          </div>
        )}

        {/* Timeline View */}
        {viewMode === "timeline" && timeline.length > 0 && (
          <div className="timeline-container">
            {(() => {
              currentCollapseLabel = "";
              return timeline.map((entry, idx) => {
                if (entry.type === "phase") {
                  currentCollapseLabel = entry.label;
                  const isCollapsed = collapsedRounds.has(entry.label);
                  const canCollapse = phase === "done";
                  return (
                    <div
                      key={`phase-${idx}`}
                      onClick={
                        canCollapse
                          ? () => toggleRoundCollapse(entry.label)
                          : undefined
                      }
                      style={{
                        margin: "32px 0 20px",
                        padding: "12px 20px",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 4,
                        fontSize: 12,
                        letterSpacing: "0.2em",
                        textTransform: "uppercase",
                        color: "#aaa",
                        cursor: canCollapse ? "pointer" : "default",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        userSelect: "none",
                      }}
                    >
                      <span>{entry.label}</span>
                      {canCollapse && (
                        <span style={{ fontSize: 10, color: "#666" }}>
                          {isCollapsed ? "\u25B6" : "\u25BC"}
                        </span>
                      )}
                    </div>
                  );
                }

                // Message entry
                const isCollapsed = collapsedRounds.has(currentCollapseLabel);
                if (isCollapsed) return null;

                const isSynthesis = entry.agentId === "synthesis";
                const member = MEMBER_MAP[entry.agentId];
                const borderColor = isSynthesis
                  ? "#d4a843"
                  : member?.color || "#666";
                const bgColor = isSynthesis
                  ? "rgba(212,168,67,0.08)"
                  : member?.accent || "rgba(255,255,255,0.03)";
                const name = isSynthesis
                  ? "Council Chair"
                  : member?.name || entry.agentId;
                const sigil = isSynthesis ? "\u2B21" : member?.sigil || "?";
                const title = isSynthesis
                  ? "Synthesis"
                  : member?.title || "";
                const roundLabel =
                  entry.round > 0 ? `Round ${entry.round}` : "";

                return (
                  <div
                    key={`msg-${idx}`}
                    className="fade-in"
                    style={{
                      borderLeft: `3px solid ${borderColor}`,
                      background: bgColor,
                      borderRadius: "0 6px 6px 0",
                      padding: "20px 24px",
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 10,
                        marginBottom: 12,
                      }}
                    >
                      <span style={{ fontSize: 20, color: borderColor }}>
                        {sigil}
                      </span>
                      <span
                        style={{
                          fontSize: 16,
                          color: borderColor,
                          fontWeight: 400,
                        }}
                      >
                        {name}
                      </span>
                      {title && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "#777",
                            letterSpacing: "0.1em",
                          }}
                        >
                          {title}
                        </span>
                      )}
                      {roundLabel && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: "2px 8px",
                            borderRadius: 3,
                            background: "rgba(255,255,255,0.06)",
                            color: "#999",
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            marginLeft: "auto",
                          }}
                        >
                          {roundLabel}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        lineHeight: 1.7,
                        color: "#d8d4c8",
                      }}
                    >
                      {formatText(entry.text)}
                      {entry.isStreaming && (
                        <span className="streaming-cursor">|</span>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
            <div ref={timelineEndRef} />
          </div>
        )}

        {/* Agent View */}
        {viewMode === "agent" && timeline.length > 0 && (
          <div>
            <div
              style={{
                display: "flex",
                gap: 4,
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                marginBottom: 24,
                overflowX: "auto",
              }}
            >
              {[
                ...currentMembers.map((m) => ({
                  id: m.id,
                  label: m.name,
                  sigil: m.sigil,
                  color: m.color,
                })),
                {
                  id: "synthesis",
                  label: "Synthesis",
                  sigil: "\u2B21",
                  color: "#d4a843",
                },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveAgentTab(tab.id)}
                  style={{
                    padding: "10px 20px",
                    fontSize: 12,
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    background: "transparent",
                    border: "none",
                    borderBottom:
                      activeAgentTab === tab.id
                        ? `2px solid ${tab.color}`
                        : "2px solid transparent",
                    color: activeAgentTab === tab.id ? tab.color : "#666",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tab.sigil} {tab.label}
                </button>
              ))}
            </div>

            {agentMessages
              .filter((m) => m.agentId === activeAgentTab)
              .map((entry, idx) => {
                const isSynthesis = entry.agentId === "synthesis";
                const member = MEMBER_MAP[entry.agentId];
                const borderColor = isSynthesis
                  ? "#d4a843"
                  : member?.color || "#666";
                const bgColor = isSynthesis
                  ? "rgba(212,168,67,0.08)"
                  : member?.accent || "rgba(255,255,255,0.03)";
                const roundLabel =
                  entry.round > 0 ? `Round ${entry.round}` : "Synthesis";

                return (
                  <div
                    key={idx}
                    style={{
                      borderLeft: `3px solid ${borderColor}`,
                      background: bgColor,
                      borderRadius: "0 6px 6px 0",
                      padding: "20px 24px",
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: "#888",
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        marginBottom: 12,
                      }}
                    >
                      {roundLabel}
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        lineHeight: 1.7,
                        color: "#d8d4c8",
                      }}
                    >
                      {formatText(entry.text)}
                      {entry.isStreaming && (
                        <span className="streaming-cursor">|</span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .fade-in { animation: fadeIn 0.3s ease-out; }
        .streaming-cursor {
          display: inline-block;
          color: #888;
          animation: pulse 0.8s infinite;
          margin-left: 2px;
          font-weight: bold;
        }
        .timeline-container { scroll-behavior: smooth; }
        textarea::placeholder { color: #444; }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>
    </div>
  );
}
