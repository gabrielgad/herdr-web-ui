import type { SessionSnapshot } from "../shared/protocol.ts";

/**
 * herdr clears a pane's `done` only when its own terminal focuses the pane, which a browser
 * never moves. A finish in a pane that is open in a browser has been seen: it reads `idle`.
 */
export function withViewedPanes(snapshot: SessionSnapshot, viewed: (paneId: string) => boolean): SessionSnapshot {
  const seen = (paneId: string, status: string): boolean => status === "done" && viewed(paneId);
  if (!snapshot.panes.some((pane) => seen(pane.pane_id, pane.agent_status)) && !snapshot.agents.some((agent) => seen(agent.pane_id, agent.agent_status))) return snapshot;
  return {
    ...snapshot,
    panes: snapshot.panes.map((pane) => seen(pane.pane_id, pane.agent_status) ? { ...pane, agent_status: "idle" } : pane),
    agents: snapshot.agents.map((agent) => seen(agent.pane_id, agent.agent_status) ? { ...agent, agent_status: "idle" } : agent),
  };
}
