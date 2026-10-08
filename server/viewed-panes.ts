import type { SessionSnapshot } from "../shared/protocol.ts";

const RANK: Record<string, number> = { unknown: 0, idle: 1, done: 2, working: 3, blocked: 4 };

/** herdr's tab and workspace status is its roll-up of their panes: recompute it for those holding a changed pane */
export function rollUp(snapshot: SessionSnapshot, changedPaneIds: readonly string[]): SessionSnapshot {
  const touched = snapshot.panes.filter((pane) => changedPaneIds.includes(pane.pane_id));
  if (touched.length === 0) return snapshot;
  const tabIds = new Set(touched.map((pane) => pane.tab_id));
  const workspaceIds = new Set(touched.map((pane) => pane.workspace_id));
  const best = (panes: SessionSnapshot["panes"]): string =>
    panes.reduce((top, pane) => (RANK[pane.agent_status] ?? 0) > (RANK[top] ?? 0) ? pane.agent_status : top, "unknown");
  return {
    ...snapshot,
    tabs: snapshot.tabs.map((tab) => tabIds.has(tab.tab_id) ? { ...tab, agent_status: best(snapshot.panes.filter((pane) => pane.tab_id === tab.tab_id)) as typeof tab.agent_status } : tab),
    workspaces: snapshot.workspaces.map((workspace) => workspaceIds.has(workspace.workspace_id) ? { ...workspace, agent_status: best(snapshot.panes.filter((pane) => pane.workspace_id === workspace.workspace_id)) as typeof workspace.agent_status } : workspace),
  };
}

/**
 * herdr clears a pane's `done` only when its own terminal focuses the pane, which a browser
 * never moves. A finish in a pane that is open in a browser has been seen: it reads `idle`.
 */
export function withViewedPanes(snapshot: SessionSnapshot, viewed: (paneId: string) => boolean): SessionSnapshot {
  const seen = (paneId: string, status: string): boolean => status === "done" && viewed(paneId);
  if (!snapshot.panes.some((pane) => seen(pane.pane_id, pane.agent_status)) && !snapshot.agents.some((agent) => seen(agent.pane_id, agent.agent_status))) return snapshot;
  const seenIds = snapshot.panes.filter((pane) => seen(pane.pane_id, pane.agent_status)).map((pane) => pane.pane_id);
  return rollUp({
    ...snapshot,
    panes: snapshot.panes.map((pane) => seen(pane.pane_id, pane.agent_status) ? { ...pane, agent_status: "idle" } : pane),
    agents: snapshot.agents.map((agent) => seen(agent.pane_id, agent.agent_status) ? { ...agent, agent_status: "idle" } : agent),
  }, seenIds);
}
