/**
 * What the composer's model and level menus list, from the catalog the server read off the agent.
 * Pure, so what each pane's menu offers is tested without a browser.
 */
import { EFFORT_CARD_QUESTION } from "../../shared/pill.ts";
import type { AgentModel, AgentModels, InteractivePrompt } from "../../shared/protocol.ts";

/** the two parts of the composer pill that open a menu */
export type PillPart = "model" | "effort";

export interface PillChoice {
  /** what the agent's own command takes */
  value: string;
  label: string;
  /** the heading it is listed under: pi's provider */
  group?: string;
  /** what the pane runs now */
  current: boolean;
}

/** The catalog's model a pane's recorded id names: the id itself, or the model part of `provider/model`. */
export function currentModel(catalog: AgentModels, recorded: string | null | undefined): AgentModel | null {
  if (!recorded) return null;
  return catalog.models.find((model) => model.id === recorded)
    ?? catalog.models.find((model) => model.id.endsWith(`/${recorded}`))
    ?? null;
}

/** "ultracode" is the agent's word; the menu writes it with its first letter up, as the pill does. */
export const effortLabel = (level: string): string => `${level.charAt(0).toUpperCase()}${level.slice(1)}`;

/**
 * The choices for one part, or null when the catalog has none to offer (no command for it, no
 * models, or a model that takes no levels), so the pill falls back to the agent's own picker.
 */
export function pillChoices(catalog: AgentModels | null, part: PillPart, recordedModel: string | null | undefined, recordedEffort: string | null | undefined): PillChoice[] | null {
  if (!catalog || catalog.models.length === 0) return null;
  if (part === "model") {
    if (!catalog.set_model) return null;
    const now = currentModel(catalog, recordedModel);
    return catalog.models.map((model) => ({ value: model.id, label: model.label, ...(model.group ? { group: model.group } : {}), current: model === now }));
  }
  if (!catalog.set_effort) return null;
  const levels = currentModel(catalog, recordedModel)?.efforts ?? [];
  if (levels.length === 0) return null;
  const now = recordedEffort?.toLowerCase();
  // the levels the pane's /effort card draws; the toggle it carries beyond them stays in the terminal
  return levels.filter((level) => level !== "ultracode" || !catalog.effort_card).map((level) => ({ value: level, label: effortLabel(level), current: level === now }));
}

/** The message that makes the pick: the agent's command with the value written in. */
export const pickCommand = (template: string, value: string): string => template.replace("{value}", value);

/**
 * Where a level sits on the card a bare `/effort` opens (Claude Code's slider): answering with this
 * index moves the slider and keeps the pick to this session. Null when the prompt is not that card
 * or does not draw the level.
 */
export function effortCardIndex(prompt: InteractivePrompt | null, level: string): number | null {
  if (!prompt || prompt.agent !== "claude" || prompt.kind !== "question" || prompt.question !== EFFORT_CARD_QUESTION) return null;
  const index = prompt.options.findIndex((option) => option.label === level);
  return index < 0 ? null : index;
}
