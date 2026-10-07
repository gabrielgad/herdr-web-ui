import { describe, expect, test } from "bun:test";
import type { AgentModels, InteractivePrompt } from "../../shared/protocol.ts";
import { currentModel, effortCardIndex, effortLabel, pickCommand, pillChoices } from "./pillMenu.ts";

const claude: AgentModels = {
  source: "binary", set_model: "/model {value}", set_effort: "/effort", effort_card: true,
  models: [
    { id: "claude-opus-5-5", label: "Opus 5.5", efforts: ["low", "high", "max"] },
    { id: "claude-haiku-4-5", label: "Haiku 4.5", efforts: [] },
  ],
};
const pi: AgentModels = {
  source: "cli", set_model: "/model {value}", set_effort: "/thinking {value}",
  models: [{ id: "tianhe/arex-2", label: "arex-2", group: "tianhe", efforts: ["off", "low", "high"] }],
};

describe("pillChoices", () => {
  test("models: every model, the one the pane runs marked", () => {
    expect(pillChoices(claude, "model", "claude-opus-5-5", "high")?.map((c) => [c.value, c.current])).toEqual([["claude-opus-5-5", true], ["claude-haiku-4-5", false]]);
  });
  test("levels: those of the model the pane runs, the current one marked", () => {
    const choices = pillChoices(claude, "effort", "claude-opus-5-5", "High")!;
    expect(choices.map((c) => c.label)).toEqual(["Low", "High", "Max"]);
    expect(choices.find((c) => c.current)?.value).toBe("high");
  });
  test("a card-answered command leaves ultracode to the terminal", () => {
    const withUltracode: AgentModels = { ...claude, models: [{ id: "claude-opus-5-5", label: "Opus 5.5", efforts: ["low", "max", "ultracode"] }] };
    expect(pillChoices(withUltracode, "effort", "claude-opus-5-5", null)?.map((c) => c.value)).toEqual(["low", "max"]);
  });
  test("pi records the model without its provider, and lists under it", () => {
    expect(currentModel(pi, "arex-2")?.id).toBe("tianhe/arex-2");
    expect(pillChoices(pi, "model", "arex-2", null)?.[0]).toMatchObject({ value: "tianhe/arex-2", group: "tianhe", current: true });
    expect(pillChoices(pi, "effort", "arex-2", "low")?.map((c) => c.value)).toEqual(["off", "low", "high"]);
  });
  test("nothing to offer falls back: no catalog, a model without levels, an unknown model, no command", () => {
    expect(pillChoices(null, "model", "x", null)).toBeNull();
    expect(pillChoices({ ...claude, models: [] }, "model", "x", null)).toBeNull();
    expect(pillChoices(claude, "effort", "claude-haiku-4-5", null)).toBeNull();
    expect(pillChoices(claude, "effort", "mystery", null)).toBeNull();
    expect(pillChoices({ ...claude, set_effort: null }, "effort", "claude-opus-5-5", null)).toBeNull();
  });
});

describe("pickCommand", () => {
  test("writes the value into the agent's command", () => {
    expect(pickCommand("/thinking {value}", "high")).toBe("/thinking high");
    expect(pickCommand(claude.set_model!, "claude-opus-5-5")).toBe("/model claude-opus-5-5");
    expect(effortLabel("xhigh")).toBe("Xhigh");
  });
});

describe("effortCardIndex", () => {
  const card = (patch: Partial<InteractivePrompt> = {}): InteractivePrompt => ({
    id: "p1", agent: "claude", kind: "question", title: "", question: "Set effort for this session", body: null,
    options: ["low", "medium", "high"].map((label) => ({ label, description: null })), multi_select: false, custom_option_index: null, ...patch,
  });
  test("finds the level on the card Claude's /effort slider gives", () => {
    expect(effortCardIndex(card(), "high")).toBe(2);
    expect(effortCardIndex(card(), "low")).toBe(0);
  });
  test("is null for a level the card does not draw, another prompt, another agent, or no prompt", () => {
    expect(effortCardIndex(card(), "max")).toBeNull();
    expect(effortCardIndex(card({ question: "Set model for this session" }), "high")).toBeNull();
    expect(effortCardIndex(card({ agent: "pi" }), "high")).toBeNull();
    expect(effortCardIndex(null, "high")).toBeNull();
  });
});
