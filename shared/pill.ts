/**
 * One descriptor per agent for the composer pill's model and level menus. Plain data, so the
 * server (what to ask the agent) and the client (which pills are pickers) read the same table.
 * An agent with no entry keeps a pill that only shows.
 */

/** How the agent's own listing is read into models; the readers live in server/agent-models.ts. */
export type PillParser = "claude-binary" | "pi-text" | "tsv";

export interface PillDescriptor {
  /** where the models come from; `argv[0]` is the executable looked up on PATH */
  list?: { argv: string[]; parser: PillParser };
  /** the agent's own command for a model, with `{id}` written in */
  switchTemplate?: string;
  /** the agent's own command for a level, with `{level}` written in */
  effortTemplate?: string;
  /**
   * The command opens a card instead of taking the level, and the card's own answer keeps the pick
   * to this session; a level typed after the command would be saved as the default for new ones.
   */
  effortCard?: boolean;
  /** the levels a listed model takes, lowest first; the claude parser reads them off each model instead */
  efforts?: string[];
  /** what `{id}` takes: the listed id, or `provider/model` */
  idForm: "id" | "provider/model";
  /** models used when the listing cannot be read */
  fallback?: { id: string; label: string; efforts: string[] }[];
  /** the agent picks in its own modal, so there is no command to send and the pill only shows */
  modalOnly?: boolean;
}

// the levels the /effort card draws; its Ultracode toggle is left to the terminal
/** The question of the card the server reads off Claude Code's `/effort` slider; the pill finds the card by it. */
export const EFFORT_CARD_QUESTION = "Set effort for this session";

const CLAUDE_LEVELS = ["low", "medium", "high", "xhigh", "max"];

export const PILL_DESCRIPTORS: Record<string, PillDescriptor> = {
  claude: {
    list: { argv: ["claude"], parser: "claude-binary" },
    switchTemplate: "/model {id}",
    effortTemplate: "/effort",
    effortCard: true,
    idForm: "id",
    fallback: [
      { id: "claude-fable-5-1", label: "Fable 5.1", efforts: CLAUDE_LEVELS },
      { id: "claude-opus-5-5", label: "Opus 5.5", efforts: CLAUDE_LEVELS },
      { id: "claude-sonnet-5-5", label: "Sonnet 5.5", efforts: CLAUDE_LEVELS },
      { id: "claude-haiku-4-5", label: "Haiku 4.5", efforts: [] },
    ],
  },
  // a model that takes no level answers `/thinking` with its own error in the pane. `/model <id>` and
  // `/thinking <level>` are for this session; only Ctrl+S in their pickers saves a startup default
  pi: {
    list: { argv: ["pi", "--list-models"], parser: "pi-text" },
    switchTemplate: "/model {id}",
    effortTemplate: "/thinking {level}",
    efforts: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    idForm: "provider/model",
  },
  // `agy models` prints `id<TAB>name`; `/model <id>` and `/effort <level>` take an argument, an unknown one is refused in the pane.
  // agy documents no session-only form for either, so a pick may be saved as its default
  agy: {
    list: { argv: ["agy", "models"], parser: "tsv" },
    switchTemplate: "/model {id}",
    effortTemplate: "/effort {level}",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    idForm: "id",
  },
  codex: { idForm: "id", modalOnly: true },
  opencode: { idForm: "id", modalOnly: true },
  mimo: { idForm: "id", modalOnly: true },
};

/** Whether the agent's pill opens a menu: it has a listing and a command to send a pick. */
export const hasPillPicker = (agent: string | null | undefined): boolean => {
  const descriptor = agent ? PILL_DESCRIPTORS[agent] : undefined;
  return Boolean(descriptor && !descriptor.modalOnly && descriptor.list && descriptor.switchTemplate);
};
