export type Moment = 'before a plan' | 'error repeats' | 'before done'

export type Bucket = 'file' | 'shell' | 'other'

/** rule: settings allowed it. ask: put to the decider, outcome pending. cleared: asked, then ran. deny: refused. */
export type Verdict = 'rule' | 'ask' | 'cleared' | 'deny'

export type Main = {
  model: string
  effort: string
  mode: string
  steps: number
  isRunning: boolean
  /** The main loop's last answered request: time to its first piece of response. Null until one is
   *  measured, absent in older state; a `tokPerS` kept by 0.5.0 and earlier is ignored. */
  speed?: { ttftMs: number } | null
  /** The checked-out git branch, or a detached HEAD's short hash; empty outside a repository. Absent in older state. */
  branch?: string
}

export type Usage = {
  pct: number | null
  tokens: number | null
  window: number
  /** The compaction window (`autoCompactWindow`, or the host's own) the host measures context against, when auto-compaction
   *  is on and the window is smaller than the model's; null when none is set or none could be read. */
  compactWindow: number | null
  /** The model window `compactWindow` was read for, so a model switch reads it again; 0 = not read yet. */
  compactFor: number
  /** Reads for this model window that came back with no breakdown or failed; it stops asking at 3. */
  compactMisses: number
  costUsd: number | null
  /** `resetsAt`: when the window resets, in ms since the epoch; null when the API gave no time,
   *  absent in state saved before it was kept. */
  limits: { kind: string; pct: number; resetsAt?: number | null }[]
  compactions: number
  lastCompactAt: number | null
  /** `compactions` counts main-loop requests that found the context emptied (afterFillRead), not
   *  session.compact calls, which Claude Code's built-in guard keeps from user plugins. */
  isCompactEstimate: boolean
  /** session.compact has reached Flightdeck: from then on the count is that hook's alone. */
  isCompactHooked: boolean
  /** A main-loop response has come back since the context last started over (a new session, a /clear,
   *  a compaction), so `$.session.usage()` reports a fill until the next compaction. */
  hasFill: boolean
}

export type Consult = { id: string; at: number; endAt: number | null; moment: Moment; via: string }

export type Architect = { consults: Consult[]; ids: string[]; seen: string[]; lastAdvice: string }

export type Check = {
  id: string
  tool: string
  bucket: Bucket
  verdict: Verdict
  inSubagent: boolean
  detail: string
  at: number
}

export type Tally = { rule: number; ask: number; cleared: number; deny: number }

export type Gate = { recent: Check[]; totals: Record<Bucket, Tally> }

export type ToolNote = { tool: string; text: string; isError: boolean }

export type AgentCard = {
  id: string
  type: string
  model: string
  description: string
  status: string
  spawnedAt: number
  endedAt: number | null
  /** The agent's context now: input + cache read + cache write of its latest step. */
  ctx: number
  /** Output tokens summed over its steps. */
  out: number
  /** Every token its requests used, split as `Count` is: what the box under the cards adds up. Absent in older state. */
  used?: Count
  steps: number
  lastStop: string | null
  tools: ToolNote[]
  answer: string
}

/** A model loop whose id matches no card: a workflow agent, a compaction or a memory fork. */
export type Loop = { id: string; steps: number; firstAt: number; lastAt: number; isDone: boolean }

export type Turn = {
  edits: number
  errorStreak: number
  errors: number
  isReviewing: boolean
  startedAt: number
  /** When the turn finished; null while it runs. Absent in older state. */
  endedAt?: number | null
  /** What the main loop's requests used since this turn started. Absent in older state. */
  used?: Count
}

export type Layout = 'auto' | 'compact' | 'wide' | 'mini'

export type View = { expanded: string | null; gateOpen: Bucket | null; layout: Layout | null }

export type Roster = { architectTypes: string[] }

/** Tokens the API reported, split the way it bills them: new input (input + cache writes), output, cache reads. */
export type Count = { fresh: number; out: number; cache: number }

/** Tokens per local day (`2026-11-19`): this plugin's live counts and the history imported from the session logs, merged. */
export type Tokens = { days: Record<string, Count> }

declare module 'claude-code' {
  interface PluginState {
    'flightdeck-plus': {
      meta: { schemaVersion: number }
      main: Main
      usage: Usage
      architect: Architect
      gate: Gate
      agents: AgentCard[]
      loops: Loop[]
      turn: Turn
      view: View
      roster: Roster
      tokens: Tokens
    }
  }
}
