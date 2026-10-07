/**
 * The models an agent offers and the effort levels each takes, for the composer's pickers.
 *
 * One descriptor per agent (shared/pill.ts) says where its list is kept and which command a pick
 * is sent as; one reader per listing format turns the list into models. The list is read from the
 * agent installed on this PC, never copied here, so it follows the version that runs: a copy would
 * go stale the day a model ships. An agent with no descriptor, or one that picks in its own modal,
 * answers an empty list and the pill stays as it is.
 *
 * - claude-binary: the model catalog the Claude Code binary carries (id, name, capabilities). The
 *   levels are the ones a model's capabilities name, as its `/effort` card draws them.
 * - pi-text: `pi --list-models`, one row per `provider/model` with a thinking column.
 * - tsv: `id<TAB>name` per line, as `agy models` prints.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";

import { PILL_DESCRIPTORS, hasPillPicker, type PillDescriptor, type PillParser } from "../shared/pill.ts";
import type { AgentModel, AgentModels } from "../shared/protocol.ts";

const FAMILY_ORDER = ["fable", "opus", "sonnet", "haiku"];
const STANDARD_EFFORTS = ["low", "medium", "high"];

/** The levels a Claude model's capabilities name: `effort` gives low to high, then xhigh and max where it has them. */
export function claudeEffortsOf(capabilities: readonly string[]): string[] {
  if (!capabilities.includes("effort")) return [];
  return [...STANDARD_EFFORTS, ...(capabilities.includes("xhigh_effort") ? ["xhigh"] : []), ...(capabilities.includes("max_effort") ? ["max"] : [])];
}

/** Every `{id:"claude-…",family:…}` entry in the binary's text, as far as the next entry. */
export function parseClaudeCatalog(text: string): AgentModel[] {
  const starts = [...text.matchAll(/\{id:"(claude-[a-z0-9-]+)",family:"([a-z]+)",display_name:"([^"]+)"/g)];
  const models = new Map<string, AgentModel & { family: string }>();
  starts.forEach((match, index) => {
    const id = match[1]!;
    // the old generations (3.x) are not what a session is started on now
    if (id.startsWith("claude-3-") || models.has(id)) return;
    const end = starts[index + 1]?.index ?? match.index! + 4000;
    const entry = text.slice(match.index!, Math.min(end, match.index! + 4000));
    const capabilities = /capabilities:\[([^\]]*)\]/.exec(entry)?.[1]?.match(/"([a-z_0-9]+)"/g)?.map((quoted) => quoted.slice(1, -1)) ?? [];
    models.set(id, { id, label: match[3]!, family: match[2]!, efforts: claudeEffortsOf(capabilities) });
  });
  const rank = (model: { family: string }): number => { const at = FAMILY_ORDER.indexOf(model.family); return at < 0 ? FAMILY_ORDER.length : at; };
  const version = (model: AgentModel): number[] => (/(\d+(?:-\d+)*)$/.exec(model.id)?.[1] ?? "0").split("-").map(Number);
  // the newer version first: 5-5 before 5, before 4-8
  const newer = (a: AgentModel, b: AgentModel): number => {
    const [x, y] = [version(a), version(b)];
    for (let at = 0; at < Math.max(x.length, y.length); at++) if ((x[at] ?? -1) !== (y[at] ?? -1)) return (y[at] ?? -1) - (x[at] ?? -1);
    return 0;
  };
  return [...models.values()].sort((a, b) => rank(a) - rank(b) || newer(a, b)).map(({ id, label, efforts }) => ({ id, label, efforts }));
}

/**
 * The rows of `pi --list-models`: `provider  model  context  max-out  thinking  images`. A model
 * is addressed as `provider/model`, which is what `/model` takes; the thinking column says
 * whether it has levels at all.
 */
export function parsePiModels(text: string, efforts: readonly string[] = PILL_DESCRIPTORS["pi"]!.efforts ?? []): AgentModel[] {
  const models: AgentModel[] = [];
  for (const line of text.split("\n")) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 6 || columns[0] === "provider") continue;
    const [provider, model, , , thinking] = columns as [string, string, string, string, string];
    if (thinking !== "yes" && thinking !== "no") continue;
    models.push({ id: `${provider}/${model}`, label: model, group: provider, efforts: thinking === "yes" ? [...efforts] : [] });
  }
  return models;
}

/** The rows of `id<TAB>name`; a line without a tab (a "Fetching…" note, a blank) is not a model. */
export function parseTsvModels(text: string, efforts: readonly string[] = []): AgentModel[] {
  const models: AgentModel[] = [];
  for (const line of text.split("\n")) {
    const [id, label] = line.split("\t").map((column) => column.trim());
    if (!id || !label || /\s/.test(id)) continue;
    models.push({ id, label, efforts: [...efforts] });
  }
  return models;
}

const NONE: AgentModels = { source: "none", models: [], set_model: null, set_effort: null };

/** Each format: whether its listing is a file read or a command's output, and how it becomes models. */
const READERS: Record<PillParser, { input: "file" | "stdout"; source: "binary" | "cli"; parse: (text: string, descriptor: PillDescriptor) => AgentModel[] }> = {
  "claude-binary": { input: "file", source: "binary", parse: (text) => parseClaudeCatalog(text) },
  "pi-text": { input: "stdout", source: "cli", parse: (text, descriptor) => parsePiModels(text, descriptor.efforts) },
  tsv: { input: "stdout", source: "cli", parse: (text, descriptor) => parseTsvModels(text, descriptor.efforts) },
};

/** The wire carries `{value}` in the command; a descriptor names what goes there. */
const commandOf = (template: string | undefined, name: "id" | "level"): string | null => template ? template.replace(`{${name}}`, "{value}") : null;
const commandsOf = (descriptor: PillDescriptor) => ({ set_model: commandOf(descriptor.switchTemplate, "id"), set_effort: commandOf(descriptor.effortTemplate, "level"), ...(descriptor.effortCard ? { effort_card: true } : {}) });

const FILE_CACHE = new Map<string, { key: string; value: AgentModels }>();
const RUN_CACHE = new Map<string, { at: number; value: AgentModels }>();
const RUN_TTL_MS = 60_000;

async function runListing(argv: string[]): Promise<string> {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const timer = setTimeout(() => child.kill(), 10_000);
  try {
    return await new Response(child.stdout).text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The models of one described agent. A file listing (Claude's binary, 250 MB) is scanned once per
 * binary and falls back to the descriptor's own list when it cannot be read; a command's listing
 * is asked for at most once a minute, since it can read the user's config and refresh over the
 * network, and an agent that fails or lists nothing offers none.
 */
export async function listModels(agent: string, executable: string | null, run: (argv: string[]) => Promise<string> = runListing, now = Date.now()): Promise<AgentModels> {
  const descriptor = Object.hasOwn(PILL_DESCRIPTORS, agent) ? PILL_DESCRIPTORS[agent]! : null;
  if (!descriptor || !hasPillPicker(agent)) return NONE;
  const { list } = descriptor;
  const reader = READERS[list!.parser];
  const commands = commandsOf(descriptor);
  const fallback = (): AgentModels => descriptor.fallback ? { ...commands, source: "fallback", models: descriptor.fallback.map((model) => ({ ...model })) } : NONE;
  if (reader.input === "file") {
    try {
      if (!executable) throw new Error(`no ${agent}`);
      const path = realpathSync(executable);
      const key = `${path}:${statSync(path).mtimeMs}`;
      const cached = FILE_CACHE.get(agent);
      if (cached?.key === key) return cached.value;
      const models = reader.parse(readFileSync(path, "latin1"), descriptor);
      const value: AgentModels = models.length > 0 ? { ...commands, source: reader.source, models } : fallback();
      FILE_CACHE.set(agent, { key, value });
      return value;
    } catch {
      return fallback();
    }
  }
  if (!executable) return NONE;
  const cached = RUN_CACHE.get(agent);
  if (cached && now - cached.at < RUN_TTL_MS) return cached.value;
  try {
    const models = reader.parse(await run([executable, ...list!.argv.slice(1)]), descriptor);
    const value: AgentModels = models.length > 0 ? { ...commands, source: reader.source, models } : NONE;
    RUN_CACHE.set(agent, { at: now, value });
    return value;
  } catch {
    return NONE;
  }
}

/** The catalog for a pane's agent; an agent without a descriptor, or one that picks in a modal, answers no models. */
export async function agentModels(agent: string | null | undefined): Promise<AgentModels> {
  if (!agent || !hasPillPicker(agent)) return NONE;
  return listModels(agent, Bun.which(PILL_DESCRIPTORS[agent]!.list!.argv[0]!));
}
