import { describe, expect, test } from "bun:test";

import { agentModels, claudeEffortsOf, listModels, parseClaudeCatalog, parsePiModels, parseTsvModels } from "./agent-models.ts";

const entry = (id: string, family: string, name: string, capabilities: string[]): string =>
  `{id:"${id}",family:"${family}",display_name:"${name}",provider_ids:{first_party:"${id}"},capabilities:[${capabilities.map((c) => `"${c}"`).join(",")}],advisor_rank:1}`;

describe("claudeEffortsOf", () => {
  test("a model without effort has no levels", () => expect(claudeEffortsOf(["adaptive_thinking"])).toEqual([]));
  test("xhigh and max come with their capabilities", () => {
    expect(claudeEffortsOf(["effort"])).toEqual(["low", "medium", "high"]);
    expect(claudeEffortsOf(["effort", "xhigh_effort", "max_effort"])).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
});

describe("parseClaudeCatalog", () => {
  const text = [
    entry("claude-3-5-haiku", "haiku", "Haiku 3.5", []),
    entry("claude-haiku-4-5", "haiku", "Haiku 4.5", ["context_management"]),
    entry("claude-sonnet-5", "sonnet", "Sonnet 5", ["effort", "max_effort"]),
    entry("claude-sonnet-5-5", "sonnet", "Sonnet 5.5", ["effort", "xhigh_effort", "max_effort"]),
    entry("claude-opus-5-5", "opus", "Opus 5.5", ["effort", "xhigh_effort", "max_effort"]),
  ].join(",");
  const models = parseClaudeCatalog(text);

  test("families lead in order, the newest first, and 3.x is left out", () => {
    expect(models.map((model) => model.id)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-4-5"]);
  });

  test("a model's levels are the ones its /effort card draws, ultracode left to the terminal", () => {
    expect(models.find((model) => model.id === "claude-sonnet-5-5")?.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(models.find((model) => model.id === "claude-haiku-4-5")?.efforts).toEqual([]);
  });
});

const PI_LIST = [
  "provider    model                     context  max-out  thinking  images",
  "qwencloud   qwen3.8-max               262.1K   131.1K   yes       yes   ",
  "tianhe      arex-2                    182.3K   32.8K    yes       yes   ",
  "local       tiny                      8.2K     2K       no        no    ",
].join("\n");

describe("parsePiModels", () => {
  test("a row is provider/model, with levels only where the thinking column says yes", () => {
    expect(parsePiModels(PI_LIST)).toEqual([
      { id: "qwencloud/qwen3.8-max", label: "qwen3.8-max", group: "qwencloud", efforts: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
      { id: "tianhe/arex-2", label: "arex-2", group: "tianhe", efforts: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
      { id: "local/tiny", label: "tiny", group: "local", efforts: [] },
    ]);
  });
  test("the header, blank lines and a warning line are not models", () => {
    expect(parsePiModels(`Warning: models.json provider x is invalid\n\n${PI_LIST}`)).toHaveLength(3);
    expect(parsePiModels("")).toEqual([]);
  });
});

describe("listModels for pi", () => {
  test("carries pi's own commands, and asks pi once a minute", async () => {
    let asked = 0;
    const run = async (): Promise<string> => { asked++; return PI_LIST; };
    const first = await listModels("pi", "/bin/pi", run, 1_000_000);
    expect(first).toMatchObject({ source: "cli", set_model: "/model {value}", set_effort: "/thinking {value}" });
    expect(first.effort_card).toBeUndefined();
    expect(first.models).toHaveLength(3);
    await listModels("pi", "/bin/pi", run, 1_030_000);
    expect(asked).toBe(1);
    await listModels("pi", "/bin/pi", run, 1_070_000);
    expect(asked).toBe(2);
  });
  test("no pi, or a pi that fails, offers nothing", async () => {
    expect((await listModels("pi", null)).models).toEqual([]);
    const failing = async (): Promise<string> => { throw new Error("boom"); };
    expect((await listModels("pi", "/bin/pi", failing, 9_000_000)).source).toBe("none");
  });
});

const AGY_LIST = [
  "Fetching available models...",
  "gemini-3.8-flash-high\tGemini 3.8 Flash (High)",
  "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)",
  "",
].join("\n");

describe("parseTsvModels", () => {
  test("a row is id and name; the note above the rows is not a model", () => {
    expect(parseTsvModels(AGY_LIST, ["low", "high"])).toEqual([
      { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)", efforts: ["low", "high"] },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Thinking)", efforts: ["low", "high"] },
    ]);
    expect(parseTsvModels("")).toEqual([]);
  });
});

describe("listModels for agy", () => {
  test("runs `agy models` and carries agy's own commands", async () => {
    let argv: string[] = [];
    const result = await listModels("agy", "/bin/agy", async (asked) => { argv = asked; return AGY_LIST; }, 2_000_000);
    expect(argv).toEqual(["/bin/agy", "models"]);
    expect(result).toMatchObject({ source: "cli", set_model: "/model {value}", set_effort: "/effort {value}" });
    expect(result.effort_card).toBeUndefined();
    expect(result.models[0]?.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
});

describe("listModels for a claude binary that cannot be read", () => {
  test("answers the descriptor's fallback with claude's commands", async () => {
    const result = await listModels("claude", "/nonexistent/claude");
    expect(result).toMatchObject({ source: "fallback", set_model: "/model {value}", set_effort: "/effort", effort_card: true });
    expect(result.models.map((model) => model.id)).toContain("claude-opus-5-5");
  });
});

describe("agentModels", () => {
  test("a modal-only agent offers nothing, like an agent with no descriptor", async () => {
    for (const agent of ["codex", "opencode", "mimo", "constructor"]) expect(await listModels(agent, "/bin/x", async () => "a\tb")).toEqual({ source: "none", models: [], set_model: null, set_effort: null });
  });
  test("an agent with no reader offers nothing", async () => {
    expect(await agentModels("codex")).toEqual({ source: "none", models: [], set_model: null, set_effort: null });
    expect(await agentModels(null)).toEqual({ source: "none", models: [], set_model: null, set_effort: null });
  });
});
