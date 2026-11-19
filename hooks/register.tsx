import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { AgentCard, Architect, Bucket, Check, Gate, Layout, Loop, Main, Roster, Turn, Usage, View } from '../types'
import {
  DEFAULT_ARCHITECT,
  addCard,
  resumeCard,
  DEFAULT_GATE,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TOKENS,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  EDIT_TOOLS,
  SCHEMA_VERSION,
  addCount,
  addTokens,
  countOf,
  bar,
  branchOf,
  tokensOf,
  afterCall,
  dayKey,
  fmtDay,
  fmtTok,
  greeting,
  historyDays,
  mergeDays,
  readDays,
  sumTokens,
  summary,
  applyStep,
  bucketOf,
  cellWidth,
  piecesThatFit,
  cardTitle,
  baselineMs,
  etaText,
  afterCompactHooked,
  afterCompactRead,
  afterFillRead,
  afterResponse,
  claimCompactRead,
  compactMark,
  contextFill,
  faultKey,
  forgetCompactRead,
  knowsMono,
  titleLines,
  consultTimeline,
  describeInput,
  redact,
  stripControl,
  endConsult,
  fitLegend,
  fmtClock,
  fmtDuration,
  fmtTimer,
  fmtUsd,
  plural,
  vi,
  gateSummary,
  gauge,
  isAdvising,
  isLoopActive,
  kTokens,
  lanes,
  cardsFit,
  limitLabel,
  limitOf,
  fmtResetIn,
  fmtSpeed,
  listOf,
  marksIn,
  momentOf,
  normalize,
  normalizeCard,
  normalizeGate,
  noteTool,
  PALETTES,
  SVG_COLORS,
  parseConfig,
  prettyModel,
  handbackOf,
  adviceLine,
  recordCheck,
  settleCheck,
  shorten,
  startConsult,
  stepSpeed,
  stepLoop,
} from './core'
import type { Config, Panel } from './core'

const PANE = 'flightdeck'
const TITLE = 'Flightdeck'


// ---------------------------------------------------------------- state

const meta = atom({ plugin: 'flightdeck-plus', key: 'meta' } as const, { schemaVersion: SCHEMA_VERSION })
const main = atom({ plugin: 'flightdeck-plus', key: 'main' } as const, DEFAULT_MAIN)
const usage = atom({ plugin: 'flightdeck-plus', key: 'usage' } as const, DEFAULT_USAGE)
const architect = atom({ plugin: 'flightdeck-plus', key: 'architect' } as const, DEFAULT_ARCHITECT)
const gate = atom({ plugin: 'flightdeck-plus', key: 'gate' } as const, DEFAULT_GATE)
const agents = atom({ plugin: 'flightdeck-plus', key: 'agents' } as const, [])
const loops = atom({ plugin: 'flightdeck-plus', key: 'loops' } as const, [])
const turn = atom({ plugin: 'flightdeck-plus', key: 'turn' } as const, DEFAULT_TURN)
const view = atom({ plugin: 'flightdeck-plus', key: 'view' } as const, DEFAULT_VIEW)
const roster = atom({ plugin: 'flightdeck-plus', key: 'roster' } as const, DEFAULT_ROSTER)
const tokens = atom({ plugin: 'flightdeck-plus', key: 'tokens' } as const, DEFAULT_TOKENS)

type ServerBlock = { type: string; id?: string; name?: string; tool_use_id?: string }

// Every read goes through these, so a value saved under an older shape still reads.
async function getMain($: EngineInterface): Promise<Main> {
  return normalize(DEFAULT_MAIN, await read($, main))
}
async function getUsage($: EngineInterface): Promise<Usage> {
  return normalize(DEFAULT_USAGE, await read($, usage))
}
/** Whether this engine's Text takes `mono`; false when it can't say, or has no `$.session.version` to ask. */
async function readMono($: EngineInterface): Promise<boolean> {
  try {
    return knowsMono(await $.session.version())
  } catch {
    return false
  }
}
async function getArchitect($: EngineInterface): Promise<Architect> {
  const a = normalize(DEFAULT_ARCHITECT, await read($, architect))
  return { ...a, consults: listOf(a.consults), ids: listOf(a.ids), seen: listOf(a.seen) }
}
async function getGate($: EngineInterface): Promise<Gate> {
  return normalizeGate(await read($, gate))
}
async function getCards($: EngineInterface): Promise<AgentCard[]> {
  return listOf<unknown>(await read($, agents)).map(normalizeCard)
}
async function getLoops($: EngineInterface): Promise<Loop[]> {
  return listOf<Loop>(await read($, loops))
}
async function getTurn($: EngineInterface): Promise<Turn> {
  return normalize(DEFAULT_TURN, await read($, turn))
}
async function getView($: EngineInterface): Promise<View> {
  return normalize(DEFAULT_VIEW, await read($, view))
}
async function getRoster($: EngineInterface): Promise<Roster> {
  const r = normalize(DEFAULT_ROSTER, await read($, roster))
  return { architectTypes: listOf(r.architectTypes) }
}

/** A stored shape older than this build's: drop what cannot be read, keep the rest. */
async function migrate($: EngineInterface) {
  const m = await read($, meta)
  if ((m?.schemaVersion ?? 0) >= SCHEMA_VERSION) return
  await update($, agents, list => listOf<unknown>(list).map(normalizeCard))
  await update($, gate, g => normalizeGate(g))
  await update($, meta, () => ({ schemaVersion: SCHEMA_VERSION }))
}

async function refreshStatus($: EngineInterface, cfg: Config) {
  if (!cfg.statusLine) return $.ui.status(undefined)
  const [u, a, g, cards] = await Promise.all([getUsage($), getArchitect($), getGate($), getCards($)])
  const running = cards.filter(c => c.status === 'running').length
  const s = gateSummary(g)
  const ctxFill = contextFill(u)
  const parts = [
    ctxFill.pct !== null ? `ctx ${Math.round(ctxFill.pct)}%` : null,
    cards.length > 0 ? `agents ${running}/${cards.length}` : null,
    a.consults.length > 0 || a.ids.length > 0 ? `${cfg.architectLabel.toLowerCase()} ${isAdvising(a) ? 'đang tư vấn' : a.consults.length}` : null,
    s.deny > 0 ? `từ chối ${s.deny}` : null,
  ]
  // Only fields with something to say; with none, no status entry at all.
  const shown = parts.filter(Boolean)
  $.ui.status(shown.length > 0 ? shown.join(' · ') : undefined)
}

async function consultStarted($: EngineInterface, cfg: Config, id: string, via: string) {
  const t = await getTurn($)
  const moment = momentOf(t)
  const at = await $.clock.now()
  await update($, architect, a => startConsult(normalize(DEFAULT_ARCHITECT, a), { id, at, moment, via }))
  if (moment === 'before done') await update($, turn, x => ({ ...normalize(DEFAULT_TURN, x), isReviewing: true }))
  await refreshStatus($, cfg)
}

async function consultEnded($: EngineInterface, cfg: Config, advice: string | null, id?: string) {
  const at = await $.clock.now()
  const first = advice ? (redact(advice).split('\n').find(l => l.trim()) ?? null) : null
  const text = first ? shorten(first.replace(/^[#>*\s-]+/, ''), 160) : null
  await update($, architect, a => endConsult(normalize(DEFAULT_ARCHITECT, a), at, text, id))
  await update($, turn, t => ({ ...normalize(DEFAULT_TURN, t), isReviewing: false }))
  await refreshStatus($, cfg)
}

async function noteAdvice($: EngineInterface, cfg: Config, advice: string) {
  await update($, architect, x => ({ ...normalize(DEFAULT_ARCHITECT, x), lastAdvice: advice }))
}

async function isArchitectType($: EngineInterface, cfg: Config, type: string) {
  return cfg.architect.test(type) || (await getRoster($)).architectTypes.includes(type)
}

async function openPane($: EngineInterface, cfg: Config) {
  // columns apply when docked beside the transcript, rows when seated inline above the prompt.
  return $.ui.open({ id: PANE, title: TITLE, columns: cfg.paneColumns, rows: 8 })
}

async function resetAll($: EngineInterface) {
  await update($, main, m => ({ ...DEFAULT_MAIN, model: normalize(DEFAULT_MAIN, m).model, mode: normalize(DEFAULT_MAIN, m).mode, branch: normalize(DEFAULT_MAIN, m).branch }))
  await update($, architect, () => DEFAULT_ARCHITECT)
  await update($, gate, () => DEFAULT_GATE)
  await update($, agents, () => [])
  await update($, loops, () => [])
  await update($, turn, () => DEFAULT_TURN)
  await update($, view, () => DEFAULT_VIEW)
  // The context gauge waits for the next measurement rather than showing the pre-clear fill.
  await update($, usage, x => ({ ...normalize(DEFAULT_USAGE, x), pct: null, tokens: null }))
}

/**
 * Stores the compaction window for the model window `window`. A `summary` breakdown estimates locally
 * and sends no request; until the host gives one, the gauge stays on the model's window (afterCompactRead).
 */
async function readCompactWindow($: EngineInterface, window: number) {
  const r = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  await update($, usage, x => afterCompactRead(normalize(DEFAULT_USAGE, x), window, r?.context.breakdown))
}

/**
 * The checked-out branch, read from `.git/HEAD` up from the session's directory: '' outside a repository, or
 * where the file system will not say. A worktree's `.git` is a file naming its own git directory. Run at the
 * session's start and around each turn, where a checkout would show.
 */
async function readBranch($: EngineInterface): Promise<string> {
  try {
    let dir = (await $.session.cwd()).replace(/[\\/]+$/, '')
    for (let depth = 0; depth < 12 && dir !== ''; depth++) {
      let head = await $.fs.read(`${dir}/.git/HEAD`).catch(() => null)
      if (head === null) {
        const pointer = await $.fs.read(`${dir}/.git`).catch(() => null)
        const target = pointer === null ? null : /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim()
        if (target) head = await $.fs.read(`${/^([\\/]|[A-Za-z]:)/.test(target) ? target : `${dir}/${target}`}/HEAD`).catch(() => null)
      }
      if (head !== null) return branchOf(head)
      dir = dir.replace(/[\\/][^\\/]*$/, '')
    }
  } catch {
    // No session directory, or no file system to ask: no branch shown.
  }
  return ''
}

async function noteBranch($: EngineInterface) {
  const branch = await readBranch($)
  await update($, main, m => (normalize(DEFAULT_MAIN, m).branch === branch ? normalize(DEFAULT_MAIN, m) : { ...normalize(DEFAULT_MAIN, m), branch }))
}

async function noteMode($: EngineInterface, mode: string | undefined) {
  if (mode) await update($, main, m => (normalize(DEFAULT_MAIN, m).mode === mode ? normalize(DEFAULT_MAIN, m) : { ...normalize(DEFAULT_MAIN, m), mode }))
}

/** Per-day counts: this plugin's live counts and the history imported from the session logs ($.store keys `days` and `history`). */
async function loadDays($: EngineInterface) {
  const [live, history] = await Promise.all([$.store.get('days'), $.store.get('history')])
  return { live: readDays(live), all: mergeDays(readDays(live), historyDays(history)) }
}

/**
 * Adds one response's usage to today's live count ($.store, kept between sessions) and mirrors the merged
 * table into the atom the pane draws from. Read-modify-write of one key, so callers run it one at a time (see `tally`).
 * ponytail: two sessions stepping in the same instant can lose one add; a file lock if exactness ever matters.
 */
async function countTokens($: EngineInterface, usage: Parameters<typeof addTokens>[1]) {
  const day = dayKey(await $.clock.now())
  await $.store.set('days', addTokens((await loadDays($)).live, usage, day))
  const { all } = await loadDays($)
  await update($, tokens, () => ({ days: all }))
}

// Every model request, the main loop's, a subagent's and a fork's alike, counts. One at a time: two
// agents finishing a step together would otherwise read the same counter and each write over the other.
let counting: Promise<unknown> = Promise.resolve()
function tally($: EngineInterface, usage: Parameters<typeof countTokens>[1] | null) {
  if (usage) counting = counting.then(() => countTokens($, usage)).catch(() => undefined)
}

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)
  const C = PALETTES[cfg.palette]
  // tool.check carries no loop id; the tool.call around it does, keyed by the call's id.
  const callLoop = new Map<string, string | null>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'flightdeck',
      description: 'Flightdeck, bảng điều khiển agent trực tiếp: mở, đóng, đặt lại hoặc chọn bố cục',
      argumentHint: '[open|close|reset|layout auto|compact|wide|mini]',
    })
    await migrate($)
    await noteBranch($)
    // The counts outlive sessions. `liveFrom` marks where this plugin's own counting began: the history
    // imported from the session logs ends there, so no response is in both.
    const now0 = await $.clock.now()
    if ((await $.store.get('liveFrom').catch(() => undefined)) === undefined) await $.store.set('liveFrom', new Date(now0).toISOString()).catch(() => undefined)
    const loaded = await loadDays($).catch(() => null)
    if (loaded) await update($, tokens, () => ({ days: loaded.all }))
    // A greeting that cannot be shown is no reason to fail the start.
    if (e.isInteractive) {
      try {
        $.ui.toast(`${greeting(new Date(now0).getHours(), cfg.userName)} Flightdeck sẵn sàng.`)
      } catch {
        // No surface to show it on.
      }
    }
    // A host without usage (headless, an SDK host, a session not yet bound) just starts without it.
    const u = await $.session.usage().catch(() => null)
    // A resumed session has a fill to draw already: its compaction window is read now, not at its first
    // measurement. Any other start forgets the last reading (the setting may have changed) for that one to read.
    const resumedWindow = u && u.context.tokens !== undefined && u.context.window > 0 ? u.context.window : 0
    if (u) {
      await update($, usage, x => ({
        ...normalize(DEFAULT_USAGE, x),
        pct: u.context.percent ?? null,
        tokens: u.context.tokens ?? null,
        window: u.context.window,
        compactFor: resumedWindow,
        compactMisses: 0,
        hasFill: u.context.tokens !== undefined,
        costUsd: u.cost?.usd ?? null,
        limits: u.rateLimits.map(limitOf),
      }))
    }
    if (cfg.openOnStart) void openPane($, cfg).catch(() => undefined)
    await refreshStatus($, cfg)
    const done = await next(e)
    if (resumedWindow > 0) {
      await readCompactWindow($, resumedWindow)
      await refreshStatus($, cfg)
    }
    return done
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await resetAll($)
      await refreshStatus($, cfg)
    }
    // The process goes on in another conversation, whose first request may find no fill: no compaction.
    if (e.reason === 'clear' || e.reason === 'resume') await update($, usage, x => ({ ...normalize(DEFAULT_USAGE, x), hasFill: false }))
    return next(e)
  })

  on('command.run', { command: 'flightdeck' }, async ($, e) => {
    const [verb = 'open', arg = ''] = e.args.trim().split(/\s+/)
    if (verb === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Đã đóng Flightdeck.' }
    }
    if (verb === 'reset') {
      await resetAll($)
      await refreshStatus($, cfg)
      return { text: 'Đã đặt lại Flightdeck.' }
    }
    if (verb === 'layout') {
      const layout: Layout | null = arg === 'compact' || arg === 'wide' || arg === 'auto' || arg === 'mini' ? arg : null
      if (!layout) return { text: 'Cách dùng: /flightdeck layout auto|compact|wide|mini' }
      await update($, view, v => ({ ...normalize(DEFAULT_VIEW, v), layout }))
      const opened = await openPane($, cfg)
      return { text: opened.isPlaced ? `Flightdeck layout: ${layout}.` : `Layout set to ${layout}; the pane is not shown yet: ${opened.reason}` }
    }
    const opened = await openPane($, cfg)
    if (!opened.isPlaced) return { text: `Flightdeck is not shown yet: ${opened.reason}` }
    return { text: 'Đã mở Flightdeck. Focus bằng ctrl+x tab; 1-6 mở rộng thẻ, f/s/o mở các dòng gate.' }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteMode($, e.permission_mode)
    return next(e)
  })

  on('agent.offer', async ($, e, next) => {
    const offered = await next(e)
    if (cfg.architect.test(e.agent) || (cfg.matchDescriptions && cfg.architect.test(e.description))) {
      await update($, roster, r => {
        const x = normalize(DEFAULT_ROSTER, r)
        return x.architectTypes.includes(e.agent) ? x : { architectTypes: [...listOf<string>(x.architectTypes), e.agent].slice(-20) }
      })
    }
    return offered
  })

  on('turn.start', async ($, e, next) => {
    // A subagent's turn (its spawn, or a resume by SendMessage) is its card's, not the main turn's.
    if (e.agentId !== undefined) return next(e)
    const now = await $.clock.now()
    await update($, turn, () => ({ ...DEFAULT_TURN, startedAt: now }))
    await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: true }))
    await noteBranch($)
    // A background architect's report reaches the main loop as the text opening this turn. The
    // SubagentHandback tool call (in tool.call) normally carries it first; this is the fallback.
    const back = e.text ? handbackOf(e.text) : null
    const a = back ? await getArchitect($) : null
    if (back && a && a.ids.includes(back.from)) {
      const advice = adviceLine(back.body)
      if (advice && advice !== a.lastAdvice) await noteAdvice($, cfg, advice)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // The main loop's model is known when its request starts; a long first request shouldn't read "—".
    if (!e.agentId) {
      let isNewModel = false
      await update($, main, m => {
        const x = normalize(DEFAULT_MAIN, m)
        isNewModel = x.model !== '' && x.model !== e.model
        return { ...x, model: e.model, effort: String(e.effort ?? x.effort), steps: x.steps + 1 }
      })
      if (isNewModel) await update($, usage, x => forgetCompactRead(normalize(DEFAULT_USAGE, x)))
      // Under the built-in guard session.compact never runs here. A request that finds the context
      // emptied after a response came back follows a compaction: counted as an estimate (afterFillRead).
      const [u0, live, at] = await Promise.all([getUsage($), $.session.usage().catch(() => null), $.clock.now()])
      let hasFill = u0.hasFill
      if (live) {
        const read = afterFillRead(u0, live.context.tokens !== undefined, at)
        hasFill = read.usage.hasFill
        if (read.usage !== u0) await update($, usage, x => afterFillRead(normalize(DEFAULT_USAGE, x), live.context.tokens !== undefined, at).usage)
      }
      // Time the response as it passes: its first piece that is neither the engine's envelope nor the
      // stop. One clock read in the stream and nothing stored until it has ended.
      const sentAt = await $.clock.now()
      let firstAt: number | null = null
      const s = next(e)
      for await (const c of s) {
        if (firstAt === null && c.kind !== 'engine' && c.kind !== 'stop') firstAt = await $.clock.now()
        yield c
      }
      const result = await s.result
      tally($, result.usage)
      if (result.usage) await update($, turn, t => ({ ...normalize(DEFAULT_TURN, t), used: addCount(normalize(DEFAULT_TURN, t).used, tokensOf(result.usage)) }))
      const speed = result.usage ? stepSpeed(sentAt, firstAt) : null
      if (speed) await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), speed }))
      // Marked here, not at the next request: two compactions can come with one response between them.
      if (result.usage && !hasFill) await update($, usage, x => afterResponse(normalize(DEFAULT_USAGE, x)))
      return result
    }
    const id = e.agentId
    // A step from an agent whose card finished means it was resumed (SendMessage): it runs again.
    const before = (await getCards($)).find(c => c.id === id)
    if (before && before.status !== 'running') {
      // Flipped in the write: a resume its agent.spawn already logged is not logged again.
      let isResumed = false
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => {
            if (c.id !== id || c.status === 'running') return c
            isResumed = true
            return resumeCard(c)
          }),
      )
      if (isResumed) await refreshStatus($, cfg)
    }
    const result = yield* next(e)
    tally($, result.usage)
    const [cards, a] = await Promise.all([getCards($), getArchitect($)])
    if (cards.some(c => c.id === id)) {
      const step = { model: e.model, usage: result.usage, stopReason: result.stopReason }
      await update($, agents, list => listOf<unknown>(list).map(normalizeCard).map(c => (c.id === id ? applyStep(c, step) : c)))
    } else if (!a.ids.includes(id)) {
      const now = await $.clock.now()
      await update($, loops, l => stepLoop(listOf<Loop>(l), id, now))
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    // The compaction window is read once per model window, not on every measurement (a breakdown
    // estimates every category each time): claimed here, in the same write, so no two reads overlap.
    let isStale = false
    await update($, usage, x => {
      const claim = claimCompactRead(normalize(DEFAULT_USAGE, x), e.context.window)
      isStale = claim.isClaimed
      return {
        ...claim.usage,
        pct: e.context.percent ?? null,
        tokens: e.context.tokens ?? null,
        window: e.context.window,
        costUsd: e.cost?.usd ?? null,
        limits: e.rateLimits.map(limitOf),
      }
    })
    if (e.changed.includes('context')) await refreshStatus($, cfg)
    const done = await next(e)
    if (isStale) {
      await readCompactWindow($, e.context.window)
      await refreshStatus($, cfg)
    }
    return done
  })

  on('session.compact', async ($, e, next) => {
    // Any compaction reaching this hook, a subagent's or a precompute too, means the guard isn't in the way.
    if (!(await getUsage($)).isCompactHooked) await update($, usage, x => afterCompactHooked(normalize(DEFAULT_USAGE, x)))
    const done = await next(e)
    // A skip is a veto, by a plugin or a blocking PreCompact hook: the conversation stays as it was.
    if (!done.skip && !e.agentId && e.trigger !== 'precompute') {
      const now = await $.clock.now()
      await update($, usage, x => {
        const u = normalize(DEFAULT_USAGE, x)
        return { ...u, compactions: u.compactions + 1, lastCompactAt: now }
      })
    }
    return done
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (e.tool_use_id) {
      const check: Check = {
        id: e.tool_use_id,
        tool: e.tool,
        bucket: bucketOf(e.tool),
        verdict: verdict.decision === 'allow' ? 'rule' : verdict.decision,
        inSubagent: Boolean(callLoop.get(e.tool_use_id)),
        detail: shorten(describeInput(e.tool, e.input), 90),
        at: await $.clock.now(),
      }
      await update($, gate, g => recordCheck(normalizeGate(g), check))
      // The status line updates when the call settles; only a refusal ends here.
      if (verdict.decision === 'deny') {
        await refreshStatus($, cfg)
      }
    }
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    callLoop.set(e.tool_use_id, e.agentId ?? null)
    const ran = await next(e).finally(() => callLoop.delete(e.tool_use_id))
    const didRun = ran.deny === undefined
    // Settle this call's pending ask, if it had one; skip the write (and the redraw) otherwise.
    const g0 = await getGate($)
    const isSettled = settleCheck(g0, e.tool_use_id, didRun) !== g0
    if (isSettled) await update($, gate, g => settleCheck(normalizeGate(g), e.tool_use_id, didRun))
    // A background agent hands its report back through this tool; an architect's report is its advice.
    if (String(e.tool) === 'SubagentHandback') {
      const message = (e as unknown as { message?: unknown }).message
      const a = e.agentId ? await getArchitect($) : null
      if (a && e.agentId && a.ids.includes(e.agentId) && typeof message === 'string') {
        const advice = adviceLine(message)
        if (advice && advice !== a.lastAdvice) await noteAdvice($, cfg, advice)
      }
      return ran
    }
    if (e.tool === 'Agent') {
      if (isSettled) await refreshStatus($, cfg)
      return ran
    }
    const hasFailed = didRun && ran.isError === true
    const isEdit = !hasFailed && didRun && EDIT_TOOLS.has(e.tool)
    const t0 = await getTurn($)
    if (isEdit || hasFailed || (!e.agentId && t0.errorStreak > 0)) {
      await update($, turn, t => afterCall(normalize(DEFAULT_TURN, t), { inSubagent: Boolean(e.agentId), hasFailed, isEdit }))
    }
    const text = shorten(describeInput(e.tool, e), 64)
    if (e.agentId) {
      const id = e.agentId
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => (c.id === id ? noteTool(c, { tool: e.tool, text, isError: hasFailed || ran.deny !== undefined }) : c)),
      )
    }
    if (isSettled || !didRun) await refreshStatus($, cfg)
    return ran
  })

  // A server-side review tool never reaches tool.call: it shows only in the assistant's rows.
  // Only response rows carry them. A managed plugin may pass user plugins over on other doors.
  on('session.append', { door: 'response' }, async ($, e, next) => {
    if (!e.agentId && e.message.type === 'assistant') {
      const a = await getArchitect($)
      // Consults this row opened: their result may be in the same row, after the stale read above.
      const opened = new Set<string>()
      for (const block of e.message.content as unknown as readonly ServerBlock[]) {
        if (block.type === 'server_tool_use' && block.name && block.id && cfg.architect.test(block.name)) {
          if (a.seen.includes(block.id)) continue
          const id = block.id
          await update($, architect, x => {
            const y = normalize(DEFAULT_ARCHITECT, x)
            return { ...y, seen: [...listOf<string>(y.seen), id].slice(-60) }
          })
          opened.add(id)
          await consultStarted($, cfg, id, `${block.name} tool`)
        } else if (block.type.endsWith('_tool_result') && block.tool_use_id) {
          const id = block.tool_use_id
          const isOpen = opened.has(id) || (await getArchitect($)).consults.some(c => c.id === id && c.endAt === null)
          if (isOpen) await consultEnded($, cfg, null, id)
        }
      }
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (!e.parentAgentId) await noteMode($, e.permissionMode)
    if (started.deny !== undefined || !started.agentId) return started
    const id = started.agentId
    if (await isArchitectType($, cfg, e.subagentType)) {
      await update($, architect, a => {
        const x = normalize(DEFAULT_ARCHITECT, a)
        return { ...x, ids: [...listOf<string>(x.ids), id].slice(-40) }
      })
      await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id))
      await consultStarted($, cfg, id, e.subagentType.split(':').pop() ?? 'agent')
      return started
    }
    const card: AgentCard = {
      ...normalizeCard({}),
      id,
      type: e.name ?? e.subagentType,
      model: started.model,
      // Kept whole for the expanded card, so masked and cleaned here rather than by a cut.
      description: stripControl(redact(e.description ?? '')),
      spawnedAt: await $.clock.now(),
    }
    await update($, agents, list => addCard(listOf<unknown>(list).map(normalizeCard), card))
    await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id))
    await refreshStatus($, cfg)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const id = e.agentId
    const now = await $.clock.now()
    if (!id) {
      await update($, turn, t => ({ ...normalize(DEFAULT_TURN, t), endedAt: now }))
      await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: false }))
      await noteBranch($)
      await refreshStatus($, cfg)
      return done
    }
    if ((await getArchitect($)).ids.includes(id)) {
      await consultEnded($, cfg, e.answer, id)
      return done
    }
    const cards = await getCards($)
    if (cards.some(c => c.id === id)) {
      const status = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => (c.id === id ? { ...c, status, endedAt: now, answer: shorten(redact(e.answer), 400) } : c)),
      )
    } else {
      await update($, loops, l => listOf<Loop>(l).map(x => (x.id === id ? { ...x, isDone: true, lastAt: now } : x)))
    }
    await refreshStatus($, cfg)
    return done
  })

  // ---------------------------------------------------------------- drawing

  // After a surface module faults on a surface, this load draws it there as plain text; the other
  // module, and other surfaces, keep theirs. Keyed by faultKey: `desktop:rail.tsx`. `ui.fault` came in
  // Claude Code 2.1.289, and an older engine refuses to load a module that hooks it: the floor the README
  // states and CI's oldest leg tests.
  const faulted = new Set<string>()
  on('ui.fault', async ($, e, next) => {
    const key = faultKey(e.surface, e.module)
    if (e.requestId === PANE && !faulted.has(key)) {
      faulted.add(key)
      $.ui.log(`flightdeck: ${e.module} faulted on ${e.surface} (${e.phase}: ${e.reason}); drawing it without animation`)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // Text's `mono` came in Claude Code 2.1.299, after the 2.1.289 Flightdeck supports. An older engine refuses
  // the prop ("Text prop "mono" is not allowed"): a connector drawn with it unmounts the pane, from the first
  // prompt on, when the first connector appears (#28). So the connectors ask for the face only where the
  // engine says it is that new, read once per load.
  let monoRead: Promise<boolean> | null = null

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button } = els
    const hasClient = 'Client' in els
    const hasRail = hasClient && !faulted.has(faultKey(e.surface, 'rail.tsx'))
    const hasClock = hasClient && !faulted.has(faultKey(e.surface, 'elapsed.tsx'))
    const hasMascot = hasClient && !faulted.has(faultKey(e.surface, 'mascot.tsx'))
    const hasEta = hasClient && !faulted.has(faultKey(e.surface, 'eta.tsx'))
    const [m, u, a, g, cards, lp, t, v, now, mono, tkRaw] = await Promise.all([
      getMain($),
      getUsage($),
      getArchitect($),
      getGate($),
      getCards($),
      getLoops($),
      getTurn($),
      getView($),
      $.clock.now(),
      (monoRead ??= readMono($)),
      read($, tokens),
    ])
    // A day that has turned reads as zero today, before any step writes it.
    const tk = summary(readDays(tkRaw?.days), dayKey(now))
    // A graphical surface (desktop, VS Code) draws Text in a proportional face, where a glyph is not one cell:
    // the layout, sized in cells, drifts (box edges, the centred header, gauges, columns). Its monospaced face
    // makes a glyph one cell there, as in a terminal, which is monospaced already. Engines before 2.1.299
    // refuse the prop, so only where `mono` says it is known. To go back to the surface's own face, make the condition `false`.
    const baseText = els.Text
    const Text = (mono && e.surface !== 'terminal' ? (p: Parameters<typeof baseText>[0]) => baseText({ ...p, mono: true }) : baseText) as typeof baseText
    // The body's own width, down to the narrowest dock Claude Code seats (24): a wider drawing is cut off at the frame.
    const W = Math.max(24, e.props.bodyColumns)
    const layout = v.layout ?? cfg.layout
    const isWide = layout === 'wide' || (layout === 'auto' && W >= 110)
    const colW = isWide ? Math.floor((W - 2) / 2) : W
    const modelName = prettyModel(m.model)
    const viewed = e.props.view?.agentId ?? null
    const advising = isAdvising(a)
    const running = cards.filter(c => c.status === 'running')
    // The turn's work: the main loop's tokens, and every agent that started in it.
    const workCards = cards.filter(c => c.spawnedAt >= t.startedAt)
    const mainUsed = countOf(t.used)
    const agentsUsed = workCards.reduce((n, c) => n + sumTokens(countOf(c.used)), 0)
    const workTotal = sumTokens(mainUsed) + agentsUsed
    const showArchitect = a.consults.length > 0 || a.ids.length > 0
    const motion = cfg.motion && hasRail
    // A panel with nothing to show yet takes no room: most sessions never spawn an agent.
    const isEmpty: Record<Panel, boolean> = {
      main: false,
      tokens: false,
      architect: !showArchitect,
      gate: g.recent.length === 0 && gateSummary(g).total === 0,
      agents: cards.length === 0,
      loops: lp.length === 0,
      // The mock clock of a test starts at 0, so "a turn has started" is running or a start time, not the time alone.
      work: !m.isRunning && t.startedAt <= 0,
    }
    const panels = cfg.panels.filter(p => !isEmpty[p])
    const decider = m.mode === 'auto' ? 'phân loại' : 'bạn'

    // A connector between panels: animated while its flow is live, a dim line otherwise.
    const rail = (key: string, active: boolean, color: string, width: number, marks: number[] = [], isMerge = false) =>
      motion ? (
        <els.Client
          key={key}
          module="./rail.tsx"
          width={width}
          height={1}
          props={{ active, width, color, dim: C.faint, marks, isMerge, mono }}
        />
      ) : e.surface !== 'terminal' ? (
        // Without a Client (VS Code) a dashed line would sit flush against the borders above and below it and
        // read as one more border; a blank row keeps the boxes apart.
        <Box height={1} />
      ) : (
        <Text color={C.faint} {...(mono ? { mono: true } : {})}>
          {'─'.repeat(Math.max(1, width))}
        </Text>
      )

    // A start time of 0 is unknown (state saved before it was recorded): no clock, not decades.
    const clock = (key: string, since: number, endAt: number | null, color: string) =>
      since <= 0 ? (
        <Text color={color}>—</Text>
      ) : hasClock ? (
        <els.Client key={key} module="./elapsed.tsx" props={{ since, now, endAt, color }} />
      ) : (
        <Text color={color}>{fmtTimer((endAt ?? now) - since)}</Text>
      )

    // What a running agent is doing now: its latest tool call.
    const lastTool = (c: AgentCard) => c.tools[c.tools.length - 1]?.text
    // Its estimated progress and time left, counting down by itself. Null while no agent has finished (no
    // yardstick yet) or its start is unknown; each caller says what it draws instead.
    const eta = (c: AgentCard, key: string, w: number) => {
      const base = c.status === 'running' && c.spawnedAt > 0 ? baselineMs(c, cards) : null
      if (base === null) return null
      return hasEta ? (
        <els.Client key={key} module="./eta.tsx" width={w} height={1} props={{ since: c.spawnedAt, now, baseMs: base, color: C.agent, dim: C.faint }} />
      ) : (
        <Text color={C.dim} wrap="truncate">
          {etaText(now - c.spawnedAt, base).text}
        </Text>
      )
    }

    const isTerminal = e.surface === 'terminal'
    // A row of marks (gate checks, loop dots), sized by `marksIn`. Should a surface draw them wider
    // still, the row is cut at its box rather than running past it.
    const markRow = (marks: RenderChildren, lead = 0) => (
      <Box overflow="hidden" {...(lead ? { marginLeft: lead } : {})}>
        <Text wrap="truncate-start">{marks}</Text>
      </Box>
    )
    // A terminal's border row stands apart from the text above it; a graphical surface draws the
    // border flush against it, so the legend keeps one row of air there.
    const legendGap = isTerminal ? 0 : 1

    // A line of coloured pieces, drawn as a row of boxes the way the log draws its lines. A Text nesting
    // coloured Texts truncates as one line in a terminal, but the desktop app wraps each nested piece on its
    // own, lays truncating ones out as blocks of their own, and collapses runs of spaces. So pieces sit `gap`
    // cells apart (a piece's `lead` adds more), each keeps its width, and pieces that don't fit in `room` are
    // left out from the end; or a piece marked `fill` (one span) truncates to what the others leave.
    type Span = { text: string; color?: string; dim?: boolean; bold?: boolean }
    type Piece = { spans: Span[]; lead?: number; fill?: boolean }
    const styleOf = (s: Span) => ({ ...(s.color ? { color: s.color } : {}), ...(s.dim ? { dimColor: true } : {}), ...(s.bold ? { bold: true } : {}) })
    const widthOf = (p: Piece) => p.spans.reduce((n, s) => n + cellWidth(s.text), 0)
    const line = (pieces: (Piece | null)[], room: number, gap = 1, justify?: 'center') => {
      const all = pieces.filter((p): p is Piece => p !== null)
      const shown = all.some(p => p.fill) ? all : all.slice(0, piecesThatFit(all.map(p => ({ width: widthOf(p), lead: p.lead })), room, gap))
      return (
        <Box width={room} columnGap={gap} overflow="hidden" {...(justify ? { justifyContent: justify } : {})}>
          {shown.map(p => {
            const lead = p.lead ? { marginLeft: p.lead } : {}
            if (p.fill && p.spans[0]) {
              return (
                <Text {...styleOf(p.spans[0])} wrap="truncate">
                  {p.spans[0].text}
                </Text>
              )
            }
            return (
              <Box flexShrink={0} {...lead}>
                {p.spans.length === 1 && p.spans[0] ? <Text {...styleOf(p.spans[0])}>{p.spans[0].text}</Text> : <Text>{p.spans.map(s => <Text {...styleOf(s)}>{s.text}</Text>)}</Text>}
              </Box>
            )
          })}
        </Box>
      )
    }

    // ---- main: the model, its branch and the meters that matter, drawn large
    const effortN = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }[m.effort] ?? 0
    const ctxFill = contextFill(u)
    // A meter stays in the main colour while there is room, goes amber from 60% and red from 85%.
    const level = (pct: number) => (pct >= 85 ? C.warn : pct >= 60 ? C.amber : C.main)
    const mainPanel = (w: number) => {
      const iw = w - 4
      const LABEL = 9
      // A wide pane has room for what each meter adds (the window's tokens, the time to its reset); a narrow
      // one keeps the bar and the percentage. The bar takes whatever the other columns leave.
      const tailW = iw >= 50 ? 18 : iw >= 34 ? 10 : 0
      const gw = Math.max(4, Math.min(30, iw - LABEL - 4 - 2 - (tailW > 0 ? tailW + 1 : 0)))
      const meter = (key: string, label: string, pct: number | null, tail: string) => {
        const lg = bar(pct ?? 0, gw)
        const c = pct === null ? C.faint : level(pct)
        return (
          <Box key={key} width={iw} columnGap={1} overflow="hidden">
            <Box width={LABEL} flexShrink={0}>
              <Text dimColor bold>
                {label}
              </Text>
            </Box>
            <Box width={gw} flexShrink={0}>
              <Text color={c}>{lg.on}</Text>
              <Text color={C.faint}>{lg.off}</Text>
            </Box>
            <Box width={4} flexShrink={0} justifyContent="flex-end">
              <Text bold color={c}>
                {pct === null ? '—' : `${Math.round(pct)}%`}
              </Text>
            </Box>
            {tailW > 0 ? (
              <Box width={tailW} flexShrink={0}>
                <Text dimColor wrap="truncate">
                  {tail}
                </Text>
              </Box>
            ) : null}
          </Box>
        )
      }
      return (
        <Box flexDirection="column" borderStyle="double" borderColor={C.main} paddingX={1} width={w}>
          <Box width={iw} justifyContent="space-between">
            <Text color={C.main} bold wrap="truncate">
              {`✦ ${modelName.toUpperCase()}`}
            </Text>
            <Box flexShrink={0}>
              <Text color={m.isRunning ? C.main : C.dim} bold>
                {m.isRunning ? '● ĐANG LÀM VIỆC' : '○ RẢNH'}
              </Text>
            </Box>
          </Box>
          {line(
            [
              m.branch ? { spans: [{ text: `⎇ ${shorten(m.branch, 26)}`, color: C.arch, bold: true }] } : null,
              {
                spans: [
                  { text: 'effort ', dim: true },
                  { text: `${'▮'.repeat(effortN) + '▯'.repeat(4 - effortN)} `, color: C.main },
                  { text: m.effort || '—', color: C.main, bold: true },
                ],
              },
              m.mode ? { spans: [{ text: `chế độ `, dim: true }, { text: m.mode, bold: true }] } : null,
            ],
            iw,
            3,
          )}
          <Text color={C.faint} wrap="truncate">
            {'╌'.repeat(iw)}
          </Text>
          {meter('ctx', 'NGỮ CẢNH', ctxFill.pct, u.tokens !== null ? `${kTokens(u.tokens)}/${kTokens(ctxFill.window)}${u.compactions > 0 ? ` ${compactMark(u)}` : ''}` : '')}
          {u.limits.slice(0, 2).map((l, i) => meter(`limit-${i}`, limitLabel(l.kind).toUpperCase(), l.pct, fmtResetIn(l.resetsAt, now) ? `↻ ${fmtResetIn(l.resetsAt, now)}` : ''))}
          <Box width={iw} columnGap={1} overflow="hidden">
            <Box width={LABEL} flexShrink={0}>
              <Text dimColor bold>
                CHI PHÍ
              </Text>
            </Box>
            <Box flexShrink={0}>
              <Text bold color={C.text}>
                {u.costUsd !== null ? fmtUsd(u.costUsd) : '—'}
              </Text>
            </Box>
            <Text dimColor wrap="truncate">
              {`· ${m.steps} yêu cầu${m.speed ? ` · ${fmtSpeed(m.speed)}` : ''}`}
            </Text>
          </Box>
        </Box>
      )
    }

    // ---- tokens: what the API reported, kept between sessions; today's count starts over at midnight
    const tokensPanel = (w: number) => {
      const tokRow = (label: string, c: typeof tk.total, lead = '') => (
        <Box width={w - 4} columnGap={1} overflow="hidden">
          <Box width={8} flexShrink={0}>
            <Text dimColor>{label}</Text>
          </Box>
          <Box width={6} flexShrink={0}>
            <Text color={C.main} bold>
              {fmtTok(sumTokens(c))}
            </Text>
          </Box>
          <Text dimColor wrap="truncate">{`${lead}vào ${fmtTok(c.fresh)} · ra ${fmtTok(c.out)} · cache ${fmtTok(c.cache)}`}</Text>
        </Box>
      )
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.cleared} paddingX={1} width={w}>
          <Box justifyContent="space-between">
            <Text color={C.cleared} bold wrap="truncate">
              TOKEN · đã dùng
            </Text>
            <Box flexShrink={0}>
              <Text dimColor>{`từ ${fmtDay(tk.since)}`}</Text>
            </Box>
          </Box>
          {tokRow('hôm nay', tk.today)}
          {tokRow('tổng', tk.total)}
          {tk.best ? tokRow('cao nhất', tk.best.count, `${fmtDay(tk.best.day)} · `) : null}
        </Box>
      )
    }

    // ---- architect
    const lastConsult = a.consults[a.consults.length - 1]
    const architectPanel = (w: number) => {
      // Both ends are anchors (the first consult, now): should it run past its box, it asks to lose the middle.
      const tl = consultTimeline(a, now, Math.max(8, w - 4))
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.arch} paddingX={1} width={w}>
          <Box justifyContent="space-between">
            <Text color={C.arch} bold wrap="truncate">
              {cfg.architectLabel} · {advising ? 'đang tư vấn' : 'sẵn sàng'}
            </Text>
            <Box flexShrink={0}>
              <Text>
                <Text dimColor>tham vấn </Text>
                <Text color={C.arch} bold>
                  {a.consults.length}
                </Text>
              </Text>
            </Box>
          </Box>
          <Text color={C.arch} wrap="truncate-middle">
            {tl}
          </Text>
          {lastConsult ? (
            <Text dimColor wrap="truncate">
              {advising
                ? `đang tham vấn từ ${fmtClock(lastConsult.at)}`
                : `gần nhất ${fmtDuration(now - (lastConsult.endAt ?? lastConsult.at))} trước · mất ${fmtDuration((lastConsult.endAt ?? now) - lastConsult.at)}`}
            </Text>
          ) : (
            <Text dimColor>chưa tham vấn</Text>
          )}
          {cfg.moments ? (
            <Box flexWrap="wrap" columnGap={2}>
              {(['before a plan', 'error repeats', 'before done'] as const).map(mo => {
                const isOn = lastConsult?.moment === mo
                return (
                  <Text color={isOn ? C.arch : C.dim} bold={isOn}>
                    {isOn ? '◆' : '◇'} {vi(mo)}
                  </Text>
                )
              })}
              <Text color={C.faint}>(suy đoán)</Text>
            </Box>
          ) : null}
          {a.lastAdvice ? (
            <Text color={C.arch} wrap="truncate">
              » {a.lastAdvice}
            </Text>
          ) : null}
        </Box>
      )
    }

    // ---- gate
    const s = gateSummary(g)
    const verdictColor = (c: Check) =>
      c.verdict === 'rule' ? C.gate : c.verdict === 'cleared' ? C.cleared : c.verdict === 'ask' ? C.amber : C.warn
    const checkMark = (c: Check) => (
      <Text color={verdictColor(c)} dimColor={c.inSubagent}>
        {c.verdict === 'deny' ? '✗' : '■'}
      </Text>
    )
    const gatePanel = (w: number) => {
      const strip = g.recent.slice(-Math.max(8, marksIn(w - 4, isTerminal)))
      const open = v.gateOpen
      // The totals in words where they all fit, in numbers alone where they don't: the colours say which is which.
      const totalsOf = (isShort: boolean): Piece[] => [
        { spans: [{ text: '■', color: C.gate }, { text: isShort ? ` ${s.rule}` : ` ${s.rule} cho phép`, dim: true }] },
        { spans: [{ text: '■', color: C.cleared }, { text: isShort ? ` ${s.cleared}` : ` ${s.cleared} ${decider}`, dim: true }] },
        ...(s.ask > 0 ? [{ spans: [{ text: isShort ? `■ ${s.ask}` : `■ ${s.ask} chờ duyệt`, color: C.amber }] }] : []),
        { spans: [{ text: isShort ? `✗ ${s.deny}` : `✗ ${s.deny} từ chối`, color: s.deny > 0 ? C.warn : C.dim }] },
      ]
      const words = totalsOf(false)
      const isShort = piecesThatFit(words.map(p => ({ width: widthOf(p) })), w - 4, 2) < words.length
      const totals = isShort ? totalsOf(true) : words
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.gate} paddingX={1} width={w}>
          <Box justifyContent="space-between">
            <Text color={C.gate} bold wrap="truncate">
              {cfg.gateLabel} · quyền
            </Text>
            <Box flexShrink={0}>
              <Text dimColor>{`${s.total} lượt kiểm tra`}</Text>
            </Box>
          </Box>
          {strip.length === 0 ? <Text color={C.faint}>chưa có kiểm tra</Text> : markRow(strip.map(checkMark))}
          {line([...totals, !isShort && w >= 80 && g.recent.some(c => c.inSubagent) ? { spans: [{ text: 'mờ: trong subagent', color: C.faint }] } : null], w - 4, 2)}
          {/* Below about 44 columns the three rows' buttons take two lines rather than run past the box. */}
          <Box columnGap={2} flexWrap="wrap">
            {(['file', 'shell', 'other'] as const).map((b: Bucket) => {
              const tl = g.totals[b]
              const n = tl.rule + tl.ask + tl.cleared + tl.deny
              return (
                <Button
                  key={`gate-${b}`}
                  plain
                  hotkey={b[0]}
                  label={`${b} ${n}${open === b ? ' ▾' : ''}`}
                  dimColor={n === 0}
                  onPress={() => update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), gateOpen: normalize(DEFAULT_VIEW, x).gateOpen === b ? null : b }))}
                />
              )
            })}
          </Box>
          {open
            ? g.recent
                .filter(c => c.bucket === open)
                .slice(-5)
                .map(c => (
                  // The verdict sits in a box of its own width, not padded with spaces, which a graphical surface collapses.
                  <Box width={w - 4} columnGap={1} overflow="hidden">
                    <Box width={12} flexShrink={0}>
                      <Text>
                        <Text color={verdictColor(c)}>{c.verdict === 'deny' ? '✗ ' : '■ '}</Text>
                        <Text color={C.dim}>{c.verdict === 'rule' ? 'cho phép' : c.verdict === 'cleared' ? decider : c.verdict === 'ask' ? 'chờ duyệt' : 'từ chối'}</Text>
                      </Text>
                    </Box>
                    <Text dimColor={c.inSubagent} wrap="truncate">
                      {shorten(c.detail, Math.max(10, w - 18))}
                    </Text>
                  </Box>
                ))
            : null}
        </Box>
      )
    }

    // ---- agents: cards up to the limit, swimlanes beyond it
    const statusColor = (c: AgentCard) => (c.status === 'failed' ? C.warn : c.status === 'done' ? C.gate : C.agent)
    const glyph = (c: AgentCard) => (c.status === 'running' ? '◐' : c.status === 'done' ? '✓' : c.status === 'failed' ? '✗' : '■')
    const expandOnPress = (id: string) => () =>
      update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), expanded: normalize(DEFAULT_VIEW, x).expanded === id ? null : id }))

    const agentsBody = (w: number) => {
      // Cards need 20 columns each; when the pane can't hold the limit, lanes take over.
      const fit = cardsFit(w, cfg.maxCards)
      const useLanes = cards.length > fit
      const isNarrow = w < 40
      // The bar here is overall progress. An agent has no known total: its own ~% and time left are an
      // estimate from the agents already done (baselineMs), shown only once one has finished.
      const finished = cards.length - running.length
      const failedN = cards.filter(c => c.status === 'failed').length
      const bar = gauge(cards.length > 0 ? (finished / cards.length) * 100 : 0, isNarrow ? 6 : 10)
      const header = (
        <Box flexDirection="column" width={w}>
          <Box justifyContent="space-between" width={w}>
            <Text bold wrap="truncate">
              {isNarrow ? `agent · ${running.length}/${cards.length}` : `agent · ${running.length} đang chạy · ${cards.length} tổng`}
            </Text>
            {cards.length > 0 ? (
              <Box flexShrink={0}>
                <Text color={C.faint}>{`1-${Math.min(cards.length, useLanes ? 6 : fit)}${isNarrow ? '' : ' mở rộng'}`}</Text>
              </Box>
            ) : null}
          </Box>
          {cards.length > 0
            ? line(
                [
                  { spans: [{ text: bar.on, color: failedN > 0 ? C.warn : C.agent }, { text: bar.off, color: C.faint }] },
                  { spans: [{ text: `${finished}/${cards.length} xong${failedN > 0 ? ` · ${failedN} lỗi` : ''}`, dim: true }] },
                ],
                w,
              )
            : null}
        </Box>
      )
      if (cards.length === 0) {
        return (
          <Box flexDirection="column" width={w}>
            {header}
            <Text color={C.faint}>chưa có subagent</Text>
          </Box>
        )
      }
      if (useLanes) {
        const shown = cards.slice(-6)
        // A lane is its glyph, a label, the bar and a clock: below 34 columns the label narrows, below
        // 36 the bar, so a 24-column pane still holds it. From 40 they are as they always were.
        const labelW = Math.min(17, Math.max(7, w - 17))
        const barW = Math.max(4, w - 11 - labelW)
        const geo = lanes(shown, now, barW)
        return (
          <Box flexDirection="column" width={w}>
            {header}
            {cards.length > shown.length ? <Text color={C.faint}>{`+${cards.length - shown.length} trước đó`}</Text> : null}
            {shown.map((c, i) => {
              const gm = geo[i]
              const isViewed = viewed === c.id
              return (
                <Box flexDirection="column">
                <Box columnGap={1}>
                  <Text color={statusColor(c)} bold={isViewed}>
                    {isViewed ? '▶' : glyph(c)}
                  </Text>
                  <Box width={labelW} flexShrink={0}>
                    <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={shorten(cardTitle(c), labelW - 3)} onPress={expandOnPress(c.id)} />
                  </Box>
                  <Box flexShrink={0}>
                    <Text>
                      <Text color={C.faint}>{'·'.repeat(gm?.before ?? 0)}</Text>
                      <Text color={statusColor(c)}>{'━'.repeat(gm?.bar ?? 1)}</Text>
                      <Text color={C.faint}>{'·'.repeat(gm?.after ?? 0)}</Text>
                    </Text>
                  </Box>
                  {clock(`lane-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
                </Box>
                {c.status === 'running' ? (
                  <Box paddingLeft={2} columnGap={1}>
                    <Text color={C.dim} wrap="truncate">{`↳ ${lastTool(c) ?? '…'}`}</Text>
                    {w >= 44 ? <Box flexShrink={0}>{eta(c, `lane-eta-${c.id}`, 22)}</Box> : null}
                  </Box>
                ) : null}
                </Box>
              )
            })}
          </Box>
        )
      }
      const shown = cards.slice(-fit)
      const cardW = Math.max(20, Math.floor((w - (shown.length - 1)) / shown.length))
      const centers = shown.map((_, i) => i * (cardW + 1) + Math.floor(cardW / 2))
      return (
        <Box flexDirection="column" width={w}>
          {header}
          {rail('fan-out', running.length > 0, C.agent, w, centers)}
          <Box columnGap={1}>
            {shown.map((c, i) => {
              const isViewed = viewed === c.id
              const sameModel = !c.model || prettyModel(c.model) === modelName
              return (
                <Box
                  flexDirection="column"
                  borderStyle={isViewed ? 'double' : 'round'}
                  borderColor={c.lastStop === 'max_tokens' ? C.warn : C.agent}
                  borderDimColor={c.status !== 'running' && !isViewed}
                  width={cardW}
                  paddingX={1}
                >
                  <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={titleLines(cardTitle(c), cardW - 7, cardW - 4)[0]} onPress={expandOnPress(c.id)} />
                  <Text bold wrap="truncate">
                    {titleLines(cardTitle(c), cardW - 7, cardW - 4)[1]}
                  </Text>
                  <Text color={C.dim} wrap="truncate">
                    {sameModel ? c.type : `${c.type} · ${prettyModel(c.model)}`}
                  </Text>
                  <Text dimColor wrap="truncate">
                    {c.steps > 0 ? `ctx ${kTokens(c.ctx)} · out ${kTokens(c.out)} · ${c.steps} bước` : 'đang khởi động…'}
                  </Text>
                  <Text color={c.status === 'running' ? C.text : C.faint} wrap="truncate">
                    {`${c.status === 'running' ? '▸' : '·'} ${lastTool(c) ?? '…'}`}
                  </Text>
                  {c.status === 'running' ? (eta(c, `card-eta-${c.id}`, cardW - 4) ?? <Text color={C.faint} wrap="truncate">chưa có ước tính</Text>) : null}
                  <Box columnGap={1}>
                    <Text color={c.lastStop === 'max_tokens' ? C.warn : statusColor(c)}>
                      {cardW >= 26 ? `${glyph(c)} ${c.lastStop === 'max_tokens' ? 'max_tokens' : vi(c.status)}` : glyph(c)}
                    </Text>
                    <Box flexShrink={0}>{clock(`card-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}</Box>
                  </Box>
                </Box>
              )
            })}
          </Box>
        </Box>
      )
    }

    const agentsPanel = (w: number) => (
      <Box flexDirection="column" borderStyle="round" borderColor={C.agent} borderDimColor={running.length === 0} paddingX={1} width={w}>
        {agentsBody(w - 4)}
      </Box>
    )

    const expandedCard = cards.find(c => c.id === v.expanded)
    const expandedPanel = (w: number) =>
      expandedCard ? (
        <Box flexDirection="column" borderStyle="single" borderColor={C.agent} paddingX={1} width={w}>
          <Text bold wrap="wrap">
            {expandedCard.description || expandedCard.type}
          </Text>
          <Text dimColor wrap="truncate">{`${expandedCard.type} · ${prettyModel(expandedCard.model)} · ${vi(expandedCard.status)} · ${expandedCard.steps} bước`}</Text>
          {expandedCard.tools.length === 0 ? <Text color={C.faint}>chưa gọi tool nào</Text> : null}
          {expandedCard.tools.map(n => (
            <Text color={n.isError ? C.warn : C.text} wrap="truncate">
              {`${n.isError ? '✗' : '·'} ${n.text}`}
            </Text>
          ))}
          {expandedCard.answer ? (
            <Text dimColor wrap="wrap">
              {`» ${shorten(expandedCard.answer, 240)}`}
            </Text>
          ) : null}
        </Box>
      ) : null

    // ---- other loops (workflow agents, forks): ids that match no card
    const loopsPanel = (w: number) => {
      if (lp.length === 0) return null
      const active = lp.filter(l => isLoopActive(l, now)).length
      const dots = lp.slice(-Math.max(4, marksIn(w - 38, isTerminal)))
      const isNarrow = w < 40
      return (
        <Box width={w} columnGap={1}>
          <Text bold>{isNarrow ? 'vòng lặp' : 'vòng lặp khác'}</Text>
          <Text dimColor>{isNarrow ? `${lp.length} · ${active} đang chạy` : `${lp.length} đã thấy · ${active} đang chạy`}</Text>
          {markRow(
            dots.map(l => (
              <Text color={isLoopActive(l, now) ? C.agent : l.isDone ? C.dim : C.faint}>{isLoopActive(l, now) ? '●' : l.isDone ? '✓' : '○'}</Text>
            )),
            1,
          )}
        </Box>
      )
    }

    // ---- work: what the turn now (or the last one) cost in tokens, the main loop's and each agent's that ran in it
    const work = (() => {
      const rows = [
        { key: 'main', label: 'main', c: mainUsed, mark: m.isRunning ? '◐' : '✓', color: C.main },
        ...workCards.map(c => ({ key: c.id, label: cardTitle(c), c: countOf(c.used), mark: glyph(c), color: statusColor(c) })),
      ]
      return { rows, total: workTotal }
    })()
    const workPanel = (w: number) => {
      const iw = w - 4
      const showBar = iw >= 30
      const showTail = iw >= 54
      const lw = showTail ? 14 : Math.max(6, iw - 9 - (showBar ? 7 : 0))
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.amber} paddingX={1} width={w}>
          <Box width={iw} justifyContent="space-between" columnGap={1}>
            <Text color={C.amber} bold wrap="truncate">
              {iw >= 30 ? 'LẦN LÀM VIỆC · token' : 'TOKEN LẦN NÀY'}
            </Text>
            <Box flexShrink={0} columnGap={1}>
              <Text color={m.isRunning ? C.main : C.gate}>{m.isRunning ? '● đang chạy' : '✓ xong'}</Text>
              {clock('work-clock', t.startedAt, m.isRunning ? null : (t.endedAt ?? now), C.dim)}
            </Box>
          </Box>
          {work.rows.map(r => {
            const sum = sumTokens(r.c)
            const share = work.total > 0 ? bar((sum / work.total) * 100, 6) : bar(0, 6)
            return (
              <Box key={`work-${r.key}`} width={iw} columnGap={1} overflow="hidden">
                <Box width={1} flexShrink={0}>
                  <Text color={r.color}>{r.mark}</Text>
                </Box>
                <Box width={lw} flexShrink={0}>
                  <Text color={r.key === 'main' ? C.main : C.text} bold={r.key === 'main'} wrap="truncate">
                    {shorten(r.label, lw)}
                  </Text>
                </Box>
                <Box width={6} flexShrink={0} justifyContent="flex-end">
                  <Text bold>{fmtTok(sum)}</Text>
                </Box>
                {showBar ? (
                  <Box width={6} flexShrink={0}>
                    <Text color={r.color}>{share.on}</Text>
                    <Text color={C.faint}>{share.off}</Text>
                  </Box>
                ) : null}
                {showTail ? (
                  <Text dimColor wrap="truncate">{`vào ${fmtTok(r.c.fresh)} · ra ${fmtTok(r.c.out)} · cache ${fmtTok(r.c.cache)}`}</Text>
                ) : null}
              </Box>
            )
          })}
          {workCards.length === 0 ? (
            <Text color={C.faint} wrap="truncate">
              chưa chạy agent nào trong lần này
            </Text>
          ) : null}
          <Box width={iw} columnGap={1} overflow="hidden">
            <Box width={1 + 1 + lw} flexShrink={0}>
              <Text dimColor bold>
                tổng
              </Text>
            </Box>
            <Box width={6} flexShrink={0} justifyContent="flex-end">
              <Text bold color={C.amber}>
                {fmtTok(work.total)}
              </Text>
            </Box>
            {showBar ? <Text dimColor wrap="truncate">{`main ${fmtTok(sumTokens(mainUsed))} · ${plural(workCards.length, 'agent')} ${fmtTok(agentsUsed)}`}</Text> : null}
          </Box>
        </Box>
      )
    }

    const draw = (p: Panel, w: number) =>
      p === 'main'
        ? mainPanel(w)
        : p === 'tokens'
          ? tokensPanel(w)
          : p === 'architect'
            ? architectPanel(w)
            : p === 'gate'
              ? gatePanel(w)
              : p === 'agents'
                ? agentsPanel(w)
                : p === 'loops'
                  ? loopsPanel(w)
                  : workPanel(w)

    // Panels with the flow between them; the agents panel draws its own rails.
    const column = (ps: Panel[], w: number) => {
      // The agents panel is a box like the rest, so the panel after it gets the usual connector.
      return (
        <Box flexDirection="column" width={w}>
          {ps.map((p, i) => {
            const prev = ps[i - 1]
            const link =
              i === 0 || p === 'tokens' || p === 'agents' || p === 'loops' || prev === 'loops'
                ? null
                : rail(`link-${p}`, p === 'architect' ? advising : m.isRunning, p === 'architect' ? C.arch : C.main, w)
            return (
              <Box flexDirection="column">
                {link}
                {draw(p, w)}
                {p === 'agents' ? expandedPanel(w) : null}
              </Box>
            )
          })}
        </Box>
      )
    }

    // Desktop draws the agents' time axis as SVG under the panels.
    const svgLanes =
      e.surface !== 'terminal' && cards.length > 0
        ? (() => {
            const { Svg } = $.ui.resolve(e)
            const rowH = 18
            const pxW = 520
            const geo = lanes(cards.slice(-10), now, 100)
            const rects = cards
              .slice(-10)
              .map((c, i) => {
                const gm = geo[i]
                const x = 150 + ((gm?.before ?? 0) / 100) * (pxW - 160)
                const wpx = Math.max(3, ((gm?.bar ?? 1) / 100) * (pxW - 160))
                const fill = c.status === 'running' ? SVG_COLORS.running : c.status === 'done' ? SVG_COLORS.done : c.status === 'failed' ? SVG_COLORS.failed : SVG_COLORS.other
                const label = shorten(cardTitle(c), 22).replace(/[<&>]/g, '')
                return `<text x="4" y="${i * rowH + 13}" font-size="11" fill="${SVG_COLORS.label}">${label}</text><rect x="${x}" y="${i * rowH + 4}" width="${wpx}" height="10" rx="3" fill="${fill}"/>`
              })
              .join('')
            const svgH = Math.min(10, cards.length) * rowH + 4
            // No width or height on the element: it takes the markup's own width up to the pane's and
            // scales down to fit a narrow one, rather than running past it at 520 pixels.
            return (
              <Svg
                source={`<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${svgH}" viewBox="0 0 ${pxW} ${svgH}">${rects}</svg>`}
                alt={`${cards.length} agent trên trục thời gian`}
              />
            )
          })()
        : null

    // Inline above the prompt (the terminal's main screen), the pane is a summary of at most 8 rows.
    const isMini = layout === 'mini' || (layout === 'auto' && e.props.placement === 'inline')
    if (isMini) {
      // A running agent takes two rows here (itself, what it is doing): 2 agents once the "+N" row is needed, so the pane stays within 8.
      const live = [...cards.filter(c => c.status === 'running'), ...cards.filter(c => c.status !== 'running').reverse()].slice(0, cards.length > 3 ? 2 : 3)
      const counts = `${s.rule} cho phép · ${s.cleared} ${decider}${s.ask > 0 ? ` · ${s.ask} chờ duyệt` : ''} · ${s.deny} từ chối`
      const strip = g.recent.slice(-Math.max(4, marksIn(W - cfg.gateLabel.length - 2 - counts.length, isTerminal)))
      const mg = ctxFill.pct !== null ? gauge(ctxFill.pct, 6) : null
      return (
        <Box flexDirection="column" width={W}>
          {line(
            [
              {
                spans: [
                  { text: modelName, color: C.main, bold: true },
                  { text: m.isRunning ? ' ● đang làm' : ' ○ rảnh', color: m.isRunning ? C.main : C.dim },
                ],
              },
              mg
                ? {
                    spans: [
                      { text: '· ctx ', dim: true },
                      { text: mg.on, color: (ctxFill.pct ?? 0) >= 80 ? C.warn : C.main },
                      { text: mg.off, color: C.faint },
                      { text: ` ${Math.round(ctxFill.pct ?? 0)}%` },
                      ...(u.compactions > 0 ? [{ text: ` ${compactMark(u)}`, color: C.amber }] : []),
                    ],
                  }
                : u.compactions > 0
                  ? { spans: [{ text: compactMark(u), color: C.amber }] }
                  : null,
              u.costUsd !== null ? { spans: [{ text: `· ${fmtUsd(u.costUsd)}`, dim: true }] } : null,
              { spans: [{ text: `· hôm nay ${fmtTok(sumTokens(tk.today))}`, dim: true }] },
              showArchitect ? { spans: [{ text: `· ${cfg.architectLabel.toLowerCase()} ${advising ? 'đang tư vấn' : a.consults.length}`, color: C.arch }] } : null,
            ],
            W,
          )}
          {strip.length > 0 ? (
            <Box columnGap={1}>
              <Text dimColor>{cfg.gateLabel.toLowerCase()}</Text>
              {markRow(strip.map(checkMark))}
              <Text color={s.deny > 0 ? C.warn : s.ask > 0 ? C.amber : C.dim} wrap="truncate">
                {counts}
              </Text>
            </Box>
          ) : null}
          {live.map(c => (
            <Box flexDirection="column">
              <Box columnGap={1}>
                <Text color={statusColor(c)}>{glyph(c)}</Text>
                <Box width={Math.max(6, W - 30)} flexShrink={0}>
                  <Text wrap="truncate">{cardTitle(c)}</Text>
                </Box>
                {/* The estimate takes ctx's place (20 cells against ctx's 8: the title column was sized for it) until no yardstick exists. */}
                {eta(c, `mini-eta-${c.id}`, 20) ?? (c.steps > 0 ? <Text dimColor>{`ctx ${kTokens(c.ctx)}`}</Text> : null)}
                {clock(`mini-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
              </Box>
              {c.status === 'running' ? (
                <Box paddingLeft={2}>
                  <Text color={C.dim} wrap="truncate">{`↳ ${lastTool(c) ?? 'đang khởi động…'}`}</Text>
                </Box>
              ) : null}
            </Box>
          ))}
          {cards.length > live.length ? (
            <Text color={C.faint} wrap="truncate">{`+${cards.length - live.length} agent nữa · /flightdeck layout compact để xem tất cả`}</Text>
          ) : null}
          {lp.length > 0 ? <Text dimColor wrap="truncate">{`vòng lặp khác ${lp.length} · ${lp.filter(l => isLoopActive(l, now)).length} đang chạy`}</Text> : null}
          {t.startedAt > 0 ? (
            <Text dimColor wrap="truncate">
              {`lần này ${fmtTok(workTotal)} token · main ${fmtTok(sumTokens(mainUsed))} · ${plural(workCards.length, 'agent')} ${fmtTok(agentsUsed)}`}
            </Text>
          ) : null}
        </Box>
      )
    }

    const legend = fitLegend(
      [
        { label: 'chính', color: C.main },
        { label: 'agents', color: C.agent },
        { label: cfg.gateLabel.toLowerCase(), color: C.gate },
        ...(showArchitect ? [{ label: cfg.architectLabel.toLowerCase(), color: C.arch }] : []),
      ],
      W,
    )

    const body = isWide ? (
      <Box flexDirection="column">
        <Box columnGap={2}>
          {column(panels.filter(p => p === 'main' || p === 'tokens' || p === 'architect' || p === 'gate'), colW)}
          {column(panels.filter(p => p === 'agents' || p === 'loops' || p === 'work'), colW)}
        </Box>
      </Box>
    ) : (
      column(panels, W)
    )

    // Under the mascot: who is working while something is, the hello while nothing is. A subagent running
    // in the background counts as work even when the main model is waiting.
    const isWorking = m.isRunning || running.length > 0
    const caption = line(
      isWorking
        ? [
            { spans: [{ text: '● Claude đang code', color: C.main, bold: true }] },
            running.length > 0 ? { spans: [{ text: '· agent', dim: true }] } : null,
            ...running.slice(0, 3).map((c): Piece => ({ spans: [{ text: `◐ ${shorten(cardTitle(c), 14)}`, color: C.agent }] })),
            running.length > 3 ? { spans: [{ text: `+${running.length - 3}`, dim: true }] } : null,
          ]
        : [
            { spans: [{ text: greeting(new Date(now).getHours(), cfg.userName), color: C.main, bold: true }] },
            { spans: [{ text: '○ đang rảnh', dim: true }] },
          ],
      W,
      1,
      'center',
    )

    return (
      <Box flexDirection="column" width={W}>
        {/* The main box below names the model and what it is doing; the header only names the pane (below 40 columns the frame's own title does) and the architect. */}
        {W >= 40 || showArchitect
          ? line(
              [
                W >= 40 ? { spans: [{ text: 'FLIGHTDECK', bold: true }] } : null,
                showArchitect
                  ? {
                      spans: [
                        { text: W >= 40 ? '· ' : '', color: C.dim, bold: true },
                        { text: cfg.architectLabel, color: C.arch, bold: true },
                        { text: advising ? ' ĐANG TƯ VẤN' : ' SẴN SÀNG', bold: true },
                      ],
                    }
                  : null,
              ],
              W,
              1,
              'center',
            )
          : null}
        <Box key="legend" justifyContent="center" columnGap={2} marginBottom={legendGap}>
          {legend.map(l => (
            <Box flexShrink={0}>
              <Text>
                <Text color={l.color}>■</Text>
                <Text dimColor>{` ${l.label}`}</Text>
              </Text>
            </Box>
          ))}
        </Box>
        {hasMascot && cfg.motion && W >= 28 ? (
          <els.Client
            key="mascot"
            module="./mascot.tsx"
            width={W}
            height={5}
            props={{ active: isWorking, width: W, colors: { c: C.main, s: C.amber, d: C.faint, k: C.gate, l: C.agent }, mono }}
          />
        ) : null}
        <Box marginBottom={1}>{caption}</Box>
        {body}
        {svgLanes}
      </Box>
    )
  }).catch(($, e, next) => {
    // Without this a failed draw leaves the engine's empty pane.
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" width={Math.max(20, e.props.bodyColumns)}>
        <Text bold>FLIGHTDECK</Text>
        <Text color={C.warn} wrap="wrap">{`vẽ lỗi (${next.error.kind}): ${next.error.message ?? 'không có thông báo'}`}</Text>
      </Box>
    )
  })
}
