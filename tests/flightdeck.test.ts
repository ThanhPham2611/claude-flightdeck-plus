import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Plugin, TestBody } from 'claude-code/testing'

import {
  DEFAULT_ARCHITECT,
  DEFAULT_GATE,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  COMPACT_TRIES,
  addCard,
  addCount,
  addTokens,
  bar,
  branchOf,
  countOf,
  tokensOf,
  dayKey,
  fmtDay,
  fmtTok,
  greeting,
  historyDays,
  mergeDays,
  readDays,
  sumTokens,
  summary,
  cardsFit,
  baselineMs,
  etaText,
  cellWidth,
  piecesThatFit,
  afterCompactRead,
  claimCompactRead,
  faultKey,
  forgetCompactRead,
  knowsMono,
  resumeCard,
  afterCall,
  applyStep,
  compactWindowOf,
  consultTimeline,
  contextFill,
  describeInput,
  endConsult,
  fitLegend,
  fmtResetIn,
  fmtSpeed,
  gateSummary,
  lanes,
  limitLabel,
  limitOf,
  marksIn,
  momentOf,
  normalizeCard,
  normalizeGate,
  titleLines,
  parseConfig,
  prettyModel,
  handbackOf,
  adviceLine,
  recordCheck,
  redact,
  settleCheck,
  shorten,
  stripControl,
  trimRecent,
  startConsult,
  stepSpeed,
} from '../hooks/core'
import type { Check } from '../types'
import { HEIGHT, WIDTH, frame } from '../hooks/mascot'

// ---------------------------------------------------------------- pure behaviour

test('redaction masks credentials before anything is stored', () => {
  expect(redact('curl -H "Authorization: Bearer abc.def.ghi123" x')).not.toContain('abc.def')
  expect(redact('export OPENAI_API_KEY=sk-proj-1234567890abcdef')).not.toContain('1234567890')
  expect(redact('gh auth --token ghp_abcdefghijklmnop')).not.toContain('abcdefghijklmnop')
  expect(redact('psql postgres://bob:hunter2@db/x')).not.toContain('hunter2')
  expect(redact('password=hunter2 ls')).not.toContain('hunter2')
  expect(redact('ls -la src/')).toBe('ls -la src/')
  expect(describeInput('Read', { file_path: 'C:\\Users\\me\\proj\\src\\main.ts' })).toBe('Read → src/main.ts')
})

// From #35, thanks @ai94iq.
test('redaction masks quoted values, JSON keys, PEM keys and more token shapes', () => {
  expect(redact('login --password "two words" next')).toBe('login --password ••• next')
  expect(redact("login --token 'a b' next")).not.toContain(' b')
  expect(redact(`curl -d '{"password":"hunter2"}' x`)).not.toContain('hunter2')
  expect(redact(`{"api_key": "abc123def456ghi", "n": 1}`)).toBe(`{"api_key": •••, "n": 1}`)
  expect(redact(`{'token':'s3cr3tvalue'}`)).not.toContain('s3cr3tvalue')
  // An unquoted value is masked up to the next space, commas and braces with it.
  expect(redact('password=ab,cd next')).toBe('password=••• next')
  expect(redact('secret: p,ss}w0rd')).toBe('secret: •••')
  expect(redact('echo "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAsecret\n-----END RSA PRIVATE KEY-----" > k')).toBe('echo "•••" > k')
  expect(redact('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk cut off here')).toBe('•••')
  expect(redact('id AKIAIOSFODNN7EXAMPLE x')).toBe('id ••• x')
  expect(redact('id ASIAIOSFODNN7EXAMPLE x')).not.toContain('IOSFODNN7')
  expect(redact('url?k=AIzaSyA1234567890abcdefghijklmnopqrstuv')).not.toContain('1234567890')
  expect(redact('t eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl x')).toBe('t ••• x')
  expect(redact('gh ghu_abcdefghijklmnop ghr_abcdefghijklmnop')).toBe('gh ••• •••')
  expect(redact('gh github_pat_11ABCDEFG0123456789_abcdefXYZ')).not.toContain('0123456789')
  expect(redact('slack xoxb-1234-5678-abcdEFGH')).not.toContain('abcdEFGH')
  expect(redact('jira ATATT3xFfGF0abcdefghijklmnop12345=AB12CD34')).not.toContain('abcdefghij')
  // A URL's password, whatever the scheme; a URL with no password in it is left alone.
  expect(redact('git clone https://bob:p:a$s@host/r.git')).toBe('git clone https://bob:•••@host/r.git')
  expect(redact('s3://reader:wJalrXUtnFEMI/K7MDENG/bPxRfiCY@bucket/x')).toBe('s3://reader:•••@bucket/x')
  expect(redact('two https://u:p1@a and ftp://v:p2@b')).toBe('two https://u:•••@a and ftp://v:•••@b')
  const plain = 'see https://example.com/a:b@c and git+ssh://git@host:repo'
  expect(redact(plain)).toBe(plain)
})

// Each of these took seconds once, from a pattern that started at every `.`, `-` or `://` of a run and scanned
// to its end: the URL pattern on main, and the first forms of the JWT and URL patterns in #35.
test('redaction stays fast on long runs that would make a pattern quadratic', () => {
  for (const s of ['a.'.repeat(200_000), 'eyJ-'.repeat(100_000), 'a://a:'.repeat(70_000), `x://u:${'p/'.repeat(200_000)}`, 'password="'.repeat(40_000), 'sk-'.repeat(130_000)]) {
    const t0 = Date.now()
    redact(s)
    expect(Date.now() - t0).toBeLessThan(500)
  }
})

test('text drawn from tools and agents loses its control bytes, and advice its credentials', () => {
  expect(shorten('a\u001b[2Jb\u009bc\u0007d', 20)).toBe('a[2Jbcd')
  expect(shorten('one\ttwo\r\nthree', 20)).toBe('one two three')
  expect(stripControl('x\u001b]0;title\u0007y\nz')).toBe('x]0;titley\nz')
  expect(stripControl('a\r\nb\rc\u000bd\u000ce\tf')).toBe('a\nb\nc d e\tf')
  expect(adviceLine('Use password=hunter2 for the db')).toBe('Use password=••• for the db')
})

const check = (id: string, verdict: Check['verdict'], bucket: Check['bucket'] = 'shell'): Check => ({
  id,
  tool: 'Bash',
  bucket,
  verdict,
  inSubagent: false,
  detail: 'Bash → ls',
  at: 1,
})

test('an ask is settled by the call that follows: cleared if it ran, deny if refused', () => {
  let g = recordCheck(DEFAULT_GATE, check('a', 'ask'))
  g = recordCheck(g, check('b', 'ask'))
  g = recordCheck(g, check('c', 'rule', 'file'))
  g = settleCheck(g, 'a', true)
  g = settleCheck(g, 'b', false)
  g = settleCheck(g, 'zzz', true) // not an ask: unchanged
  const s = gateSummary(g)
  expect([s.rule, s.ask, s.cleared, s.deny, s.total]).toEqual([1, 0, 1, 1, 3])
  expect(g.recent.map(c => c.verdict)).toEqual(['cleared', 'deny', 'rule'])
})

test('the gate tallies a mixed run of verdicts per family', () => {
  let g = DEFAULT_GATE
  g = recordCheck(g, check('r1', 'rule', 'file'))
  g = recordCheck(g, check('a1', 'ask', 'shell'))
  g = recordCheck(g, check('a2', 'ask', 'shell'))
  g = recordCheck(g, check('d1', 'deny', 'other'))
  g = settleCheck(g, 'a1', true)
  g = settleCheck(g, 'a2', false)
  expect(g.totals.file).toEqual({ rule: 1, ask: 0, cleared: 0, deny: 0 })
  expect(g.totals.shell).toEqual({ rule: 0, ask: 0, cleared: 1, deny: 1 })
  expect(g.totals.other.deny).toBe(1)
  expect(gateSummary(g)).toEqual({ rule: 1, ask: 0, cleared: 1, deny: 2, total: 4 })
  expect(gateSummary(DEFAULT_GATE).total).toBe(0)
})

test('a v1-shaped gate reads as empty, then records normally', () => {
  const g = normalizeGate({ file: { allow: 3, ask: 1, deny: 0, cleared: 2 }, shell: null })
  expect(gateSummary(g).total).toBe(0)
  const next = recordCheck(g, check('n1', 'rule', 'file'))
  expect(next.totals.file.rule).toBe(1)
  expect(next.recent.length).toBe(1)
})

test('a pending ask is never trimmed out before it settles', () => {
  let g = recordCheck(DEFAULT_GATE, check('old-ask', 'ask'))
  for (let i = 0; i < 120; i += 1) g = recordCheck(g, check(`r${i}`, 'rule', 'file'))
  expect(g.recent.length).toBe(80)
  expect(g.recent.some(c => c.id === 'old-ask')).toBe(true)
  g = settleCheck(g, 'old-ask', true)
  expect(gateSummary(g).ask).toBe(0)
  expect(trimRecent([check('a', 'rule'), check('b', 'rule')], 5).length).toBe(2)
})

test('edits count from every loop; errors only from the main loop', () => {
  const t = { ...DEFAULT_TURN, errorStreak: 1 }
  expect(afterCall(t, { inSubagent: true, hasFailed: false, isEdit: true }).edits).toBe(1)
  expect(afterCall(t, { inSubagent: true, hasFailed: true, isEdit: false }).errorStreak).toBe(1)
  expect(afterCall(t, { inSubagent: false, hasFailed: true, isEdit: false })).toEqual({ ...t, errorStreak: 2, errors: 1 })
  expect(momentOf(afterCall(DEFAULT_TURN, { inSubagent: true, hasFailed: false, isEdit: true }))).toBe('before done')
  expect(momentOf({ edits: 0, errorStreak: 2 })).toBe('error repeats')
})

test("a card's context is its latest step's whole input; output adds up", () => {
  let c = normalizeCard({ id: 'x' })
  c = applyStep(c, { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 2_000, output_tokens: 500 }, stopReason: 'tool_use' })
  c = applyStep(c, { model: 'claude-sonnet-5-5', usage: { input_tokens: 5, cache_read_input_tokens: 40_000, output_tokens: 700 }, stopReason: 'max_tokens' })
  expect([c.ctx, c.out, c.steps, c.lastStop, c.model]).toEqual([40_005, 1200, 2, 'max_tokens', 'claude-sonnet-5-5'])
})

test('a resumed agent runs again on its own card instead of adding a second', () => {
  const a = { ...normalizeCard({ id: 'a', description: 'first', spawnedAt: 5, model: 'claude-sonnet-5-5' }), status: 'done' as const, endedAt: 100, steps: 4, out: 900 }
  const b = normalizeCard({ id: 'b' })
  const cards = addCard(addCard(addCard([], a), b), { ...normalizeCard({ id: 'a', description: 'again', spawnedAt: 200 }) })
  expect(cards.map(c => `${c.id}:${c.description}`)).toEqual(['a:again', 'b:'])
  expect(cards[0] && [cards[0].status, cards[0].endedAt, cards[0].steps, cards[0].out, cards[0].spawnedAt]).toEqual(['running', null, 4, 900, 5])
  expect([resumeCard(a).status, resumeCard(a).endedAt]).toEqual(['running', null])
  // Spawned again on another model, the card names it; a spawn that names none keeps the card's.
  expect(addCard([a], normalizeCard({ id: 'a', model: 'claude-opus-5-5' }))[0]?.model).toBe('claude-opus-5-5')
  expect(addCard([a], normalizeCard({ id: 'a' }))[0]?.model).toBe('claude-sonnet-5-5')
})

test('consults open, close by id, and draw on a shared timeline', () => {
  let a = startConsult(DEFAULT_ARCHITECT, { id: 's1', at: 0, moment: 'before a plan', via: 'advisor tool' })
  a = startConsult(a, { id: 's1', at: 5, moment: 'before a plan', via: 'again' }) // same id: ignored
  a = endConsult(a, 10, null, 's1')
  a = startConsult(a, { id: 's2', at: 90, moment: 'before done', via: 'advisor tool' })
  expect(a.consults.length).toBe(2)
  expect(a.consults[0]?.endAt).toBe(10)
  const tl = consultTimeline(a, 100, 11)
  expect(tl.length).toBe(11)
  expect(tl.startsWith('◆━')).toBe(true)
  expect(tl.split('◆').length - 1).toBe(2)
})

test('config is read leniently: bad values fall back to defaults', () => {
  const d = parseConfig({})
  expect([d.maxCards, d.paneColumns, d.layout, d.motion, d.moments, d.panels.length]).toEqual([3, 66, 'auto', true, true, 7])
  expect(d.architect.test('fable-advisor:fable-advisor')).toBe(true)
  const c = parseConfig({ architectPattern: '([', maxCards: 99, layout: 'diagonal', panels: 'work, gate ,nope,gate', motion: 'off' })
  expect(c.architect.test('advisor')).toBe(true) // invalid regex → default
  expect([c.maxCards, c.layout, c.motion]).toEqual([6, 'auto', false])
  expect([46.4, 12, Number.NaN, '90'].map(n => parseConfig({ paneColumns: n }).paneColumns)).toEqual([46, 40, 66, 66])
  expect(c.panels).toEqual(['work', 'gate'])
})

test('state saved under an older shape still reads', () => {
  const g = normalizeGate({ file: { allow: 1 } }) // v1 gate shape
  expect(g.recent).toEqual([])
  expect(g.totals.shell.rule).toBe(0)
  expect(normalizeCard({ id: 'a', status: 'done' }).tools).toEqual([])
})

test('layout math: lanes share one axis, the legend never wraps', () => {
  const cards = [
    { ...normalizeCard({}), id: 'a', spawnedAt: 1000, endedAt: 1050 },
    { ...normalizeCard({}), id: 'b', spawnedAt: 1050, endedAt: null },
  ]
  const [a, b] = lanes(cards, 1100, 20)
  expect(a).toEqual({ id: 'a', before: 0, bar: 10, after: 10 })
  expect(b?.before).toBe(10)
  expect((b?.before ?? 0) + (b?.bar ?? 0) + (b?.after ?? 0)).toBe(20)
  expect(fitLegend([{ label: 'main' }, { label: 'agents' }, { label: 'architect' }], 20).map(x => x.label)).toEqual(['main', 'agents'])
  expect([marksIn(64, true), marksIn(64, false), marksIn(6, false)]).toEqual([64, 42, 4])
  expect(limitLabel('five_hour')).toBe('5h')
  expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
  expect(prettyModel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('Sonnet 4.5')
  expect(prettyModel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
  expect(prettyModel('claude-opus-4-20250514')).toBe('Opus 4')
  expect(prettyModel('claude-3-opus-20240229')).toBe('Opus 3')
  expect(prettyModel('z-ai/glm-5.3-flash-with-a-long-name')).toBe('z-ai/glm-5.3-flash-wi…')
  expect(prettyModel('')).toBe('—')
  const hb = '<agent-message from="a1940a83d593229d5">\n[Subagent hand-back] The text below is the final report. The report follows:\n  Add gate tests: redaction edge cases.\n  - more\n</agent-message>'
  expect(handbackOf(hb)).toEqual({ from: 'a1940a83d593229d5', body: 'Add gate tests: redaction edge cases.' })
  expect(handbackOf('<agent-message from="x">\nPlain report line\n</agent-message>')).toEqual({ from: 'x', body: 'Plain report line' })
  expect(handbackOf('fix the parser')).toBe(null)
  expect(adviceLine('## Ship it after one more gate test.\n- details')).toBe('Ship it after one more gate test.')
  expect(adviceLine('[Subagent hand-back] header\n\n**Fix card overflow first**')).toBe('Fix card overflow first')
  expect(adviceLine('')).toBe('')
  expect(titleLines('Write tinyqueue test suite', 13, 16)).toEqual(['Write', 'tinyqueue test…'])
  expect(titleLines('Short', 13, 16)).toEqual(['Short', ''])
})

test('a request\'s speed is its time to the first piece of response, and no output rate', () => {
  expect(stepSpeed(1000, 1800)).toEqual({ ttftMs: 800 })
  expect(stepSpeed(1000, null)).toBe(null) // no response arrived
  expect(fmtSpeed({ ttftMs: 1250 })).toBe('ttft 1.3s')
  // State saved by 0.5.0 still carries a rate: it is not drawn.
  expect(fmtSpeed({ ttftMs: 800, tokPerS: 9844 } as { ttftMs: number })).toBe('ttft 0.8s')
})

test('a window keeps its reset time, drawn as the time left', () => {
  expect(limitOf({ kind: 'five_hour', percentUsed: 19, resetsAt: '1970-01-01T03:10:00.000Z' })).toEqual({ kind: 'five_hour', pct: 19, resetsAt: 11_400_000 })
  expect(limitOf({ kind: 'seven_day', percentUsed: 3 }).resetsAt).toBe(null)
  expect(limitOf({ kind: 'spend_limit', percentUsed: 1, resetsAt: 'soon' }).resetsAt).toBe(null)
  expect([fmtResetIn(11_400_000, 0), fmtResetIn(25 * 60_000 + 5_000, 0), fmtResetIn(4 * 86_400_000 + 2 * 3_600_000, 0)]).toEqual(['3h10m', '25m', '4d2h'])
  expect([fmtResetIn(null, 0), fmtResetIn(undefined, 0), fmtResetIn(5, 10)]).toEqual(['', '', ''])
})

// ---------------------------------------------------------------- drawing

const engine = (on: On) => {
  const clock = mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return clock
}

const pane = (bodyColumns: number) => ({
  plugin: 'flightdeck-plus',
  component: 'Pane' as const,
  requestId: 'flightdeck',
  props: {
    title: 'Flightdeck',
    isFocused: true,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 70 },
    view: {},
  },
})

let spawnN = 0
const spawn = (subagentType: string, description: string) => ({
  prompt: description,
  description,
  subagentType,
  tool_use_id: `tu${++spawnN}`,
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
})

test('a fresh session draws on every surface and width, empty panels hidden', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const cols of [40, 60, 86, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      expect(await ui.find({ text: /RẢNH/ })).toBeDefined()
      expect(await ui.find({ text: /TOKEN/ })).toBeDefined() // the token box
      expect(await ui.find({ text: /LẦN LÀM VIỆC|TOKEN LẦN NÀY/ })).toBeUndefined() // no turn yet: no work box
      expect(await ui.find({ text: /agents ·/ })).toBeUndefined() // no subagents: no agents panel
      expect(await ui.find({ text: /permissions/ })).toBeUndefined() // no checks yet: no gate panel
      await ui.unmount()
    }
  }
})

test('inline above the prompt, the pane is a summary of at most 8 rows', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `m${++n}` }))
  on('tool.check', () => ({ decision: 'allow' }))
  await $.turn.start({ text: 'go', turnId: 'M1' })
  for (const d of ['one', 'two', 'three', 'four', 'five']) await $.agent.spawn(spawn('general-purpose', `task ${d}`))
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'm-k1' })
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface })
    const root = (await ui.drawn()) as { children?: unknown[] }
    expect((root.children ?? []).filter(Boolean).length <= 8).toBe(true)
    expect(await ui.find({ text: /\+2 more agents/ })).toBeDefined()
    expect(await ui.find({ text: /1 allowed/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/clear starts the pane fresh', async ($, on) => {
  engine(on)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'c1' }))
  await $.turn.start({ text: 'go', turnId: 'C1' })
  await $.agent.spawn(spawn('Explore', 'look around'))
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /look around/ })).toBeUndefined()
  await ui.unmount()
})

test('colours come from the theme by default, raw hex only when asked', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  const title = await ui.find({ text: /· main$/ })
  expect(title?.props.color).toBe('claude')
  await ui.unmount()
})

test('pastel keeps the fixed dark-terminal colours', { options: { palette: 'pastel' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await ui.find({ text: /· main$/ }))?.props.color).toBe('#7dd3fc')
  await ui.unmount()
})

test('subagents become cards, then swimlanes past the card limit; a card expands on its hotkey', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `ag${++n}` }))
  await $.turn.start({ text: 'fan out', turnId: 'T1' })
  await $.agent.spawn(spawn('general-purpose', 'Write the parser tests'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites'))

  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /Write the parser/ })).toBeDefined()
  expect(await ui.find({ text: /Sonnet 5\.5/ })).toBeDefined() // differs from main: shown
  await ui.press({ key: 'card-ag1' })
  expect(await ui.find({ text: /^Write the parser tests$/ })).toBeDefined() // the expanded panel, full title
  await ui.unmount()

  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('general-purpose', 'Review the parser'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const lanesUi = await $.ui.mount({ ...pane(64), surface })
    expect(await lanesUi.find({ text: /4 total/ })).toBeDefined()
    expect(await lanesUi.find({ text: /━/ })).toBeDefined()
    await lanesUi.unmount()
  }
})

test('cards fit 20 columns and a gap each, between one and the limit', () => {
  expect([cardsFit(24, 3), cardsFit(41, 3), cardsFit(62, 3), cardsFit(64, 3), cardsFit(120, 3), cardsFit(120, 6)]).toEqual([1, 2, 3, 3, 3, 5])
})

// #32: the panel below the agents sat flush against swimlanes, or against an expanded card, with no connector between.
test('the panel below the agents gets a connector unless the cards end on their merge rail', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `gp${++n}` }))
  await $.turn.start({ text: 'fan out', turnId: 'GP1' }) // a turn running: the work box shows below the agents
  await $.agent.spawn(spawn('general-purpose', 'Write the parser tests'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites'))

  const cardsUi = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await cardsUi.find({ key: 'merge' })).toBeDefined()
  expect(await cardsUi.find({ key: 'link-work' })).toBeUndefined() // the merge rail leads on
  await cardsUi.press({ key: 'card-gp1' })
  expect(await cardsUi.find({ text: /^Write the parser tests$/ })).toBeDefined() // expanded below the cards
  expect(await cardsUi.find({ key: 'link-work' })).toBeDefined()
  await cardsUi.press({ key: 'card-gp1' })
  expect(await cardsUi.find({ key: 'link-work' })).toBeUndefined()
  await cardsUi.unmount()

  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('general-purpose', 'Review the parser'))
  for (const cols of [40, 64, 120]) {
    const lanesUi = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await lanesUi.find({ text: /━/ })).toBeDefined() // swimlanes
    expect(await lanesUi.find({ key: 'link-work' })).toBeDefined()
    await lanesUi.unmount()
  }
})

test('the server-side advisor is read from assistant rows: consulting, then on call', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'plan it', turnId: 'T2' })
  const row = (content: unknown[]) =>
    $.session
      .append({
        message: { type: 'assistant', role: 'assistant', content: content as never },
        door: 'response',
        origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
        uuid: `u${++spawnN}`,
      })
      .catch(() => undefined) // the test has no transcript to store rows in
  await row([{ type: 'server_tool_use', id: 'srv1', name: 'advisor', input: {} }])
  const mid = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await mid.find({ text: /ARCHITECT · advising/ })).toBeDefined()
  expect(await mid.find({ text: /◆ before a plan/ })).toBeDefined()
  await mid.unmount()

  await row([{ type: 'advisor_tool_result', tool_use_id: 'srv1', content: { type: 'advisor_redacted_result' } }])
  const after = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await after.find({ text: /ARCHITECT · on call/ })).toBeDefined()
  expect(await after.find({ text: /^1$/ })).toBeDefined()
  await after.unmount()
})

// The built-in guard passes user plugins over on the attachment, hook-context and compaction doors,
// so the hook subscribes to the response door alone, which is where the assistant's rows come in.
test('the server-side advisor is read only from rows that come in by the response door', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'plan it', turnId: 'T5' })
  const row = (door: 'response' | 'hook-context', id: string) =>
    $.session
      .append({
        message: { type: 'assistant', role: 'assistant', content: [{ type: 'server_tool_use', id, name: 'advisor', input: {} }] as never },
        door,
        origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
        uuid: `u${++spawnN}`,
      })
      .catch(() => undefined) // the test has no transcript to store rows in
  await row('hook-context', 'srvH')
  const before = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await before.find({ text: /ARCHITECT · advising/ })).toBeUndefined()
  await before.unmount()

  await row('response', 'srvR')
  const after = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await after.find({ text: /ARCHITECT · advising/ })).toBeDefined()
  await after.unmount()
})

test('the gate strip fills from checks and a row opens its redacted drill-down', async ($, on) => {
  engine(on)
  on('tool.check', (_$, e) => ({ decision: e.tool === 'Read' ? 'allow' : 'ask' }))
  await $.tool.check({ tool: 'Read', input: { file_path: '/a/b.ts' }, tool_use_id: 'k1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'curl -H "Authorization: Bearer abcdefgh12345" api' }, tool_use_id: 'k2' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /2 checks/ })).toBeDefined()
  expect(await ui.find({ text: /1 pending/ })).toBeDefined()
  await ui.press({ key: 'gate-shell' })
  expect(await ui.find({ text: /Authorization: Bearer •••/ })).toBeDefined()
  expect(await ui.find({ text: /abcdefgh12345/ })).toBeUndefined()
  await ui.unmount()
})

test('config changes labels, hides panels and turns the moments off', { options: { architectLabel: 'REVIEWER', panels: 'main,architect,agents,log', moments: false } }, async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-fable-5-1', agentId: `r${++n}` }))
  await $.turn.start({ text: 'review it', turnId: 'T3' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /REVIEWER · advising/ })).toBeDefined()
  expect(await ui.find({ text: /permissions/ })).toBeUndefined()
  expect(await ui.find({ text: /before a plan/ })).toBeUndefined()
  await ui.unmount()
})

test('a consult whose start and result share one row closes, and its review flag with it', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.turn.start({ text: 'go', turnId: 'T4' })
  // An edit first, so the consult is inferred as "before done" and sets the review flag.
  await $.tool.call({ tool: 'Edit', file_path: '/x.ts', old_string: 'a', new_string: 'b' } as never)
  await $.session
    .append({
      message: {
        type: 'assistant',
        role: 'assistant',
        content: [
          { type: 'server_tool_use', id: 'srv9', name: 'advisor', input: {} },
          { type: 'advisor_tool_result', tool_use_id: 'srv9', content: { type: 'advisor_redacted_result' } },
        ] as never,
      },
      door: 'response',
      origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
      uuid: 'one-row',
    })
    .catch(() => undefined)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /ARCHITECT · on call/ })).toBeDefined()
  expect(await ui.find({ text: /◆ before done/ })).toBeDefined()
  expect(await ui.find({ text: /reviewing before done/ })).toBeUndefined()
  await ui.unmount()
})

test('with no architect anywhere, the panel, legend entry and status field stay hidden', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /ARCHITECT/ })).toBeUndefined()
  expect(await ui.find({ text: /^ architect$/ })).toBeUndefined()
  await ui.unmount()
})

test('cards that cannot fit the pane fall back to lanes', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'W1' })
  for (const d of ['alpha', 'beta', 'gamma']) await $.agent.spawn(spawn('Explore', `task ${d}`))
  const narrow = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await narrow.find({ text: /━/ })).toBeDefined() // lanes
  await narrow.unmount()
  const wide = await $.ui.mount({ ...pane(70), surface: 'terminal' })
  expect(await wide.find({ text: /━/ })).toBeUndefined() // three cards fit in 70
  expect(await wide.find({ text: /task gamma/ })).toBeDefined()
  await wide.unmount()
})

test("a background architect's advice is read from its hand-back", async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-fable-5-1', agentId: 'fab1' }))
  await $.turn.start({ text: 'review it', turnId: 'H1' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'H1', agentId: 'fab1', reason: 'answer' })
  await $.turn.start({
    text: '<agent-message from="fab1">\n[Subagent hand-back] The report follows:\n  Ship it after one more gate test.\n</agent-message>',
    turnId: 'H2',
  })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /» Ship it after one more gate test\./ })).toBeDefined()
  await ui.unmount()
})

// From #35, thanks @ai94iq: the prompt line, an agent's task and answer, and advice were stored as they came.
test('agent tasks and answers, and advice reach the pane masked and without control bytes', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `rd${++n}` }))
  await $.turn.start({ text: 'use AKIAIOSFODNN7EXAMPLE now', turnId: 'RD1' })
  await $.agent.spawn(spawn('general-purpose', 'deploy with AKIAIOSFODNN7EXAMPLF\u001b[2J'))
  await $.turn.complete({ answer: 'key AKIAIOSFODNN7EXAMPLG done', durationMs: 10, isAborted: false, turnId: 'RD2', agentId: 'rd1', reason: 'answer' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  await $.turn.complete({ answer: 'Rotate password=hunter2 before shipping.', durationMs: 10, isAborted: false, turnId: 'RD3', agentId: 'rd2', reason: 'answer' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  await ui.press({ key: 'card-rd1' }) // the expanded card: the whole task and the answer
  for (const text of [/^deploy with •••\[2J$/, /» key ••• done/, /» Rotate password=••• before shipping\./]) {
    expect(await ui.find({ text })).toBeDefined()
  }
  expect(await ui.find({ text: /IOSFODNN7|hunter2|\u001b/ })).toBeUndefined()
  await ui.unmount()
})

test('each rate-limit window shows the time to its reset where the main panel has room', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const at = (ms: number) => new Date(ms).toISOString()
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 19, resetsAt: at(3 * 3_600_000 + 10 * 60_000) },
      { kind: 'seven_day', percentUsed: 3, resetsAt: at(4 * 86_400_000 + 2 * 3_600_000) },
    ],
    changed: ['rateLimits'],
  })
  for (const cols of [64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /^19%$/ })).toBeDefined()
    expect(await ui.find({ text: /^↻ 3h10m$/ })).toBeDefined()
    expect(await ui.find({ text: /^3%$/ })).toBeDefined()
    expect(await ui.find({ text: /^↻ 4d2h$/ })).toBeDefined()
    await ui.unmount()
  }
  const narrow = await $.ui.mount({ ...pane(30), surface: 'terminal' })
  expect(await narrow.find({ text: /^19%$/ })).toBeDefined()
  expect(await narrow.find({ text: /↻/ })).toBeUndefined() // no room: the bars stay whole
  await narrow.unmount()
})

test("the main box shows the last request's time to first token, and no tokens per second", async ($, on) => {
  const clock = engine(on)
  // The model beneath: 800 ms to its first words, then 2 s more to stop after 120 tokens.
  on('turn.step', async function* () {
    await clock.sleep(800)
    yield { kind: 'text' as const, index: 0, text: 'hello' }
    await clock.sleep(2000)
    const usage = { input_tokens: 10, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'S1', index: 0, answer: 'hello', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const before = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await before.find({ text: /ttft/ })).toBeUndefined() // nothing measured yet: no line
  await before.unmount()
  const s = $.turn.step({ turnId: 'S1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  const first = s.next()
  await clock.advance(800)
  expect((await first).value).toEqual({ kind: 'text', index: 0, text: 'hello' })
  const stop = s.next()
  await clock.advance(2000)
  await stop
  for await (const _ of s) void _
  await s.result
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /ttft 0\.8s$/ })).toBeDefined()
    expect(await ui.find({ text: /tok\/s/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('on a graphical surface, rows of marks hold fewer marks, keep the newest and clip at their box', async ($, on) => {
  engine(on)
  // The newest check is the one refused: its ✗ must stay in sight.
  on('tool.check', (_$, e) => ({ decision: e.tool_use_id === 'g29' ? 'deny' : 'allow' }))
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
  on('turn.step', async function* () {
    return { turnId: 'G1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  for (let i = 0; i < 30; i += 1) await $.tool.check({ tool: 'Read', input: { file_path: `/f${i}.ts` }, tool_use_id: `g${i}` })
  // A loop that is no card and no architect: a dot on the "other loops" row.
  const s = $.turn.step({ turnId: 'G1', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId: 'wf1' })
  for await (const _ of s) void _
  await s.result
  await $.session
    .append({
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'server_tool_use', id: 'srvG', name: 'advisor', input: {} }] as never },
      door: 'response',
      origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
      uuid: 'marks-row',
    })
    .catch(() => undefined)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const cols of [40, 64, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      // A terminal draws all 30 marks; a graphical surface draws fewer where 30 would not fit
      // (24 in the 36 cells of a 40-column pane), always ending on the newest.
      const strip = await ui.find({ type: 'Text', text: /^[■✗]{2,}$/ })
      expect(strip?.props.wrap).toBe('truncate-start')
      expect(strip?.text.length).toBe(surface !== 'terminal' && cols === 40 ? 24 : 30)
      expect(strip?.text.endsWith('✗')).toBe(true)
      expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.wrap).toBe('truncate-start')
      expect((await ui.find({ type: 'Text', text: /^[─━◆]+$/ }))?.props.wrap).toBe('truncate-middle')
      expect((await ui.find({ key: 'legend' }))?.props.marginBottom).toBe(surface === 'terminal' ? 0 : 1)
      await ui.unmount()
    }
  }
})

test("the inline summary's strip holds fewer marks on a graphical surface and keeps the newest", async ($, on) => {
  engine(on)
  on('tool.check', (_$, e) => ({ decision: e.tool_use_id === 'n59' ? 'deny' : 'allow' }))
  for (let i = 0; i < 60; i += 1) await $.tool.check({ tool: 'Bash', input: { command: `ls ${i}` }, tool_use_id: `n${i}` })
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface })
    // 80 columns less "gate " and " 59 allowed · 0 you · 1 denied" leave 45: 45 marks in a terminal, 30 elsewhere.
    const strip = await ui.find({ type: 'Text', text: /^[■✗]{2,}$/ })
    expect(strip?.props.wrap).toBe('truncate-start')
    expect(strip?.text.length).toBe(surface === 'terminal' ? 45 : 30)
    expect(strip?.text.endsWith('✗')).toBe(true)
    expect(await ui.find({ text: /59 allowed/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a draw that fails says why instead of leaving the pane empty', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => {
    throw new Error('boom')
  })
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /^draw failed \(throw\)/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a finished agent that takes another step (resumed by SendMessage) runs again, in the pane and the status line', async ($, on) => {
  // engine(on), with a status line that keeps what it was told
  mock.clock(on)
  const status: (string | undefined)[] = []
  on('ui.status', (_$, e) => (status.push(e.text), { value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'r1' }))
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }
  on('turn.step', async function* () {
    return { turnId: 'R1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const step = async () => {
    const s = $.turn.step({ turnId: 'R1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'r1' })
    for await (const _ of s) void _
    await s.result
  }
  await $.turn.start({ text: 'go', turnId: 'T1' })
  await $.agent.spawn(spawn('general-purpose', 'Audit the parser'))
  await step()
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'R1', agentId: 'r1', reason: 'answer' })
  expect(status[status.length - 1]).toMatch(/agents 0\/1/)
  await step()
  expect(status[status.length - 1]).toMatch(/agents 1\/1/)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /◐ running/ })).toBeDefined()
  expect(await ui.find({ text: /✓ done/ })).toBeUndefined()
  expect(await ui.find({ text: /^resumed$/ })).toBeDefined()
  expect(await ui.find({ text: /ctx 10 · out 10 · 2 st/ })).toBeDefined()
  await ui.unmount()
})

test('the docked pane asks for the width set in paneColumns', { options: { paneColumns: 46 } }, async ($, on) => {
  engine(on)
  const asked: (number | undefined)[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => (asked.push(e.columns), { value: { isPlaced: true as const } }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(asked).toEqual([46])
})

test('the context gauge measures against a compaction window set below the model window', () => {
  const u = { ...DEFAULT_USAGE, tokens: 200_000, window: 1_000_000, compactWindow: 400_000 }
  // From the real reading, not the model's percentage: 200k of 400k.
  expect(contextFill(u)).toEqual({ pct: 50, window: 400_000 })
  expect(contextFill({ ...u, tokens: 100_000 })).toEqual({ pct: 25, window: 400_000 })
  // None set, or not below the model's window: the model's window.
  expect(contextFill({ ...u, compactWindow: null })).toEqual({ pct: 20, window: 1_000_000 })
  expect(contextFill({ ...u, compactWindow: 1_000_000 })).toEqual({ pct: 20, window: 1_000_000 })
  expect(contextFill({ ...u, compactWindow: 1_500_000 })).toEqual({ pct: 20, window: 1_000_000 })
  expect(contextFill({ ...u, compactWindow: 0 })).toEqual({ pct: 20, window: 1_000_000 })
  // No reading yet, no gauge; and none from a window not yet known.
  expect(contextFill({ ...u, tokens: null })).toEqual({ pct: null, window: 400_000 })
  expect(contextFill(DEFAULT_USAGE)).toEqual({ pct: null, window: 0 })
  expect(contextFill({ ...DEFAULT_USAGE, tokens: 5 }).pct).toBeNull()
})

test('a breakdown names a compaction window only when auto-compaction is on and it is below the model window', () => {
  const on = { rawMaxTokens: 400_000, isAutoCompactEnabled: true }
  expect(compactWindowOf(on, 1_000_000)).toBe(400_000)
  expect(compactWindowOf({ ...on, isAutoCompactEnabled: false }, 1_000_000)).toBeNull()
  expect(compactWindowOf({ ...on, rawMaxTokens: 1_000_000 }, 1_000_000)).toBeNull() // the model's own limit
  expect(compactWindowOf(on, 200_000)).toBeNull() // a model switch to a smaller window
  expect(compactWindowOf({ ...on, rawMaxTokens: 0 }, 1_000_000)).toBeNull()
  expect(compactWindowOf(undefined, 1_000_000)).toBeNull() // no breakdown: unknown
  expect(compactWindowOf(null, 1_000_000)).toBeNull()
})

/** A session whose `session.usage` answers as a host does: the breakdown only to a call that asks for one. */
const compactHost = (on: On, o: { window: () => number; compact: number | null; isEnabled?: boolean; tokens?: number }) => {
  const asked: (string | undefined)[] = []
  on('session.usage', (_$, e) => {
    asked.push(e.breakdown)
    const window = o.window()
    const breakdown =
      e.breakdown && o.compact !== null
        ? { rawMaxTokens: o.compact, isAutoCompactEnabled: o.isEnabled ?? true, totalTokens: 123, percentage: 99 }
        : undefined
    return { value: { startedAt: 0, rateLimits: [], context: { window, ...(o.tokens !== undefined ? { tokens: o.tokens } : {}), ...(breakdown ? { breakdown: breakdown as never } : {}) } } }
  })
  return asked
}

test('the gauge, status and inline summary measure against the compaction window, read once per model window', async ($, on) => {
  mock.clock(on)
  let status: string | undefined
  on('ui.status', (_$, e) => {
    status = e.text
    return { value: undefined }
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  let window = 1_000_000
  const asked = compactHost(on, { window: () => window, compact: 400_000 })
  const measure = (tokens: number) =>
    $.session.measure({ context: { window, tokens, percent: tokens / (window / 100) }, rateLimits: [], changed: ['context'] })
  await measure(100_000)
  await measure(150_000)
  await measure(200_000)
  // Three measurements, one summary breakdown: never `full`, which would send token-count requests.
  expect(asked.filter(Boolean)).toEqual(['summary'])
  expect(status).toBe('ctx 50%') // not the host's 20% of a million
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /200k\/400k/ })).toBeDefined()
    expect(await ui.find({ text: /^50%$/ })).toBeDefined()
    expect(await ui.find({ text: /1\.0M/ })).toBeUndefined()
    await ui.unmount()
    const mini = await $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, placement: 'inline' as const }, surface: 'terminal' })
    expect(await mini.find({ text: / 50%/ })).toBeDefined()
    await mini.unmount()
  }
  // Past 80% of the compaction window the gauge warns, though the model's window has room.
  await measure(340_000)
  const warn = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await warn.find({ type: 'Text', text: /^█+[▏▎▍▌▋▊▉]?$/ }))?.props.color).toBe('error')
  expect(await warn.find({ text: /^85%$/ })).toBeDefined()
  await warn.unmount()
  // A model with a smaller window: read again, and a compaction window above it no longer counts.
  window = 200_000
  await measure(100_000)
  expect(asked.filter(Boolean)).toEqual(['summary', 'summary'])
  const small = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await small.find({ text: /100k\/200k/ })).toBeDefined()
  await small.unmount()
})

const keepsModelWindow = (name: string, host: { compact: number | null; isEnabled?: boolean }, asks: number) =>
  test(name, async ($, on) => {
    mock.clock(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    const asked = compactHost(on, { window: () => 1_000_000, ...host })
    for (const tokens of [50_000, 100_000, 200_000, 250_000, 300_000]) {
      await $.session.measure({ context: { window: 1_000_000, tokens, percent: tokens / 10_000 }, rateLimits: [], changed: ['context'] })
    }
    // An answer is asked for once; no breakdown (no session bound yet) is asked again, COMPACT_TRIES in all.
    expect(asked.filter(Boolean).length).toBe(asks)
    for (const cols of [40, 64, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
      expect(await ui.find({ text: /300k\/1\.0M/ })).toBeDefined()
      expect(await ui.find({ text: /^30%$/ })).toBeDefined()
      await ui.unmount()
    }
  })

keepsModelWindow('a host that gives no breakdown keeps the model window and stops asking after 3 tries', { compact: null }, 3)
keepsModelWindow('with auto-compaction off the gauge keeps the model window and is asked once', { compact: 400_000, isEnabled: false }, 1)

test('a resumed session reads its compaction window at start, and /clear leaves the reading alone', async ($, on) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('command.register', () => ({ value: { command: 'flightdeck' } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  // Resumed with 200k already in context.
  const asked = compactHost(on, { window: () => 1_000_000, compact: 400_000, tokens: 200_000 })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(asked).toEqual([undefined, 'summary'])
  const resumed = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await resumed.find({ text: /200k\/400k/ })).toBeDefined()
  expect(await resumed.find({ text: /^50%$/ })).toBeDefined()
  await resumed.unmount()
  // The gauge waits for the next measurement after a /clear; the compaction window is not asked again.
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  await $.session.measure({ context: { window: 1_000_000, tokens: 100_000, percent: 10 }, rateLimits: [], changed: ['context'] })
  expect(asked).toEqual([undefined, 'summary'])
  const cleared = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await cleared.find({ text: /100k\/400k/ })).toBeDefined()
  expect(await cleared.find({ text: /^25%$/ })).toBeDefined()
  await cleared.unmount()
})

test('a compaction-window read that fails is asked again at the next measurement', async ($, on) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  let reads = 0
  on('session.usage', (_$, e) => {
    if (e.breakdown && ++reads === 1) return { deny: 'not bound yet' }
    const breakdown = e.breakdown ? { rawMaxTokens: 400_000, isAutoCompactEnabled: true } : undefined
    return { value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000, ...(breakdown ? { breakdown: breakdown as never } : {}) } } }
  })
  const measure = (tokens: number) =>
    $.session.measure({ context: { window: 1_000_000, tokens, percent: tokens / 10_000 }, rateLimits: [], changed: ['context'] })
  await measure(100_000)
  const failed = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await failed.find({ text: /100k\/1\.0M/ })).toBeDefined()
  await failed.unmount()
  await measure(200_000)
  await measure(300_000)
  expect(reads).toBe(2) // the failed read once more, then not again
  const read = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await read.find({ text: /300k\/400k/ })).toBeDefined()
  expect(await read.find({ text: /^75%$/ })).toBeDefined()
  await read.unmount()
})

test('a compaction-window read is claimed once per model window, missed reads retried up to a cap, stale ones dropped', () => {
  const b = { rawMaxTokens: 400_000, isAutoCompactEnabled: true }
  const fresh = { ...DEFAULT_USAGE, window: 1_000_000 }
  const first = claimCompactRead(fresh, 1_000_000)
  expect([first.isClaimed, first.usage.compactFor]).toEqual([true, 1_000_000])
  expect(claimCompactRead(first.usage, 1_000_000).isClaimed).toBe(false) // already claimed
  expect(afterCompactRead(first.usage, 1_000_000, b).compactWindow).toBe(400_000)
  // A read for a window no longer claimed (the model switched while it ran) changes nothing.
  const switched = claimCompactRead({ ...first.usage, window: 1_000_000 }, 200_000).usage
  expect(afterCompactRead(switched, 1_000_000, b)).toBe(switched)
  // A miss (no breakdown, or a failed call) gives the claim back and counts; COMPACT_TRIES misses stop asking.
  let u = first.usage
  for (let i = 0; i < COMPACT_TRIES; i += 1) {
    const c = claimCompactRead(u, 1_000_000)
    expect(c.isClaimed || i === 0).toBe(true)
    u = afterCompactRead(c.isClaimed ? c.usage : u, 1_000_000, i % 2 ? null : undefined)
  }
  expect([u.compactFor, u.compactMisses, u.compactWindow]).toEqual([0, COMPACT_TRIES, null])
  expect(claimCompactRead(u, 1_000_000).isClaimed).toBe(false)
  // Another model window, or another model, starts afresh.
  expect(claimCompactRead(u, 200_000).isClaimed).toBe(true)
  expect(claimCompactRead(forgetCompactRead({ ...u, compactWindow: 400_000 }), 1_000_000).isClaimed).toBe(true)
  expect(forgetCompactRead({ ...u, compactWindow: 400_000 }).compactWindow).toBe(null)
})

// Claude Code's built-in guard keeps session.compact from user plugins. Claude Code reports no fill
// until the first response after a new session, a /clear or a compaction, so a main-loop request that
// finds none after a response came back follows a compaction: counted, marked as an estimate.
const fillHost = ($: Parameters<TestBody>[0], on: On) => {
  engine(on)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  let veto: string | undefined
  on('session.compact', (_$, e) => (veto ? { skip: veto } : { messages: e.messages }))
  let fill: number | undefined
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000, ...(fill !== undefined ? { tokens: fill } : {}) } } }))
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 60_000, cache_creation_input_tokens: 0, model: 'x' }
  on('turn.step', async function* () {
    return { turnId: 'C1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  return {
    /** One model request: the fill Claude Code reports as it goes out, then its response. */
    request: async (tokens: number | undefined, agentId?: string) => {
      fill = tokens
      const s = $.turn.step({ turnId: 'C1', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) })
      for await (const _ of s) void _
      await s.result
    },
    measure: (tokens: number) => $.session.measure({ context: { window: 1_000_000, tokens, percent: tokens / 10_000 }, rateLimits: [], changed: ['context'] }),
    /** Compactions from here on come back skipped with this reason, as a blocking PreCompact hook's do; undefined lets them run. */
    vetoCompactions: (why: string | undefined) => {
      veto = why
    },
    /** The compaction mark the main box shows, whether it says `(estimated)`, and how many log lines say compacted. */
    shown: async () => {
      const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
      const mark = (await ui.find({ type: 'Text', text: /^⟲/ }))?.text ?? null
      const isEstimated = (await ui.find({ type: 'Text', text: /^\(estimated\)$/ })) !== undefined
      const logged = (await ui.findAll({ type: 'Text', text: /^context compacted/ })).map(n => n.text)
      await ui.unmount()
      return { mark, isEstimated, logged }
    },
  }
}

test('under the built-in guard a request that finds the context emptied counts an estimated compaction', async ($, on) => {
  const h = fillHost($, on)
  await h.measure(60_000)
  await h.request(undefined) // a new session's first request: nothing to have emptied
  await h.request(60_000)
  expect(await h.shown()).toEqual({ mark: null, isEstimated: false, logged: [] })
  await h.request(undefined)
  expect(await h.shown()).toEqual({ mark: '⟲~1', isEstimated: true, logged: ['context compacted (estimated)'] })
  // Compacted again after one response, as auto-compaction can within a turn; a subagent's own window is not the main one.
  await h.request(undefined)
  await h.request(undefined, 'sub1')
  expect((await h.shown()).mark).toBe('⟲~2')
  // The label is left out where the line is short; nothing spills.
  const spills: string[] = []
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const cols of [24, 28, 32, 36, 40, 64, 120]) {
      for (const placement of ['dock', 'inline'] as const) {
        const ui = await $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, placement }, surface })
        for (const s of spillsOf(await ui.drawn(), cols)) spills.push(`${surface} ${placement} ${cols}: ${s}`)
        await ui.unmount()
      }
    }
  }
  expect(spills).toEqual([])
  // A /clear empties the context too, and isn't a compaction.
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  await h.request(undefined)
  await h.measure(30_000)
  expect((await h.shown()).mark).toBe('⟲~2')
  // So can a /resume into another conversation, before its first response.
  await $.session.end({ reason: 'resume', sessionId: 's' } as never)
  await h.request(undefined)
  expect((await h.shown()).mark).toBe('⟲~2')
})

test('once session.compact reaches Flightdeck its count is the real one: estimates before it are dropped, none after', async ($, on) => {
  const h = fillHost($, on)
  await h.measure(60_000)
  await h.request(60_000)
  await h.request(undefined) // a rewind to the first prompt reads like a compaction
  expect((await h.shown()).mark).toBe('⟲~1')
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'the summary', toolUses: [] }] })
  await h.request(undefined)
  await h.request(60_000)
  await h.request(undefined)
  expect(await h.shown()).toEqual({ mark: '⟲1', isEstimated: false, logged: ['context compacted (estimated)', 'context compacted (auto)'] })
})

test('a compaction that comes back skipped is neither counted nor logged', async ($, on) => {
  const h = fillHost($, on)
  await h.measure(60_000)
  const compact = () => $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'the summary', toolUses: [] }] })
  h.vetoCompactions('a PreCompact hook blocked it')
  await compact()
  expect(await h.shown()).toEqual({ mark: null, isEstimated: false, logged: [] })
  h.vetoCompactions(undefined)
  await compact()
  expect(await h.shown()).toEqual({ mark: '⟲1', isEstimated: false, logged: ['context compacted (manual)'] })
})

test("an agent's estimate comes from the agents already done, its own type first, and never reaches 100%", () => {
  const card = (id: string, type: string, status: string, took: number | null) =>
    normalizeCard({ id, type, status, spawnedAt: 1000, endedAt: took === null ? null : 1000 + took })
  const me = card('me', 'explore', 'running', null)
  expect(baselineMs(me, [me])).toBeNull()
  expect(baselineMs(me, [me, card('a', 'plan', 'done', 60_000)])).toBe(60_000)
  expect(baselineMs(me, [me, card('a', 'plan', 'done', 60_000), card('b', 'explore', 'done', 20_000), card('c', 'explore', 'failed', 5_000)])).toBe(20_000)
  expect(etaText(30_000, 60_000)).toEqual({ pct: 50, text: '~50% · còn 0:30' })
  expect(etaText(90_000, 60_000)).toEqual({ pct: 95, text: 'lâu hơn thường' })
})

test("a surface module's fault key is the same for the hook's path, either separator, and the drawing's name", () => {
  expect(faultKey('desktop', 'hooks/rail.tsx')).toBe('desktop:rail.tsx')
  expect(faultKey('desktop', 'hooks\\rail.tsx')).toBe(faultKey('desktop', 'rail.tsx'))
  expect(faultKey('terminal', 'hooks/elapsed.tsx')).not.toBe(faultKey('desktop', 'hooks/elapsed.tsx'))
})

test("Text's monospaced face is asked of 2.1.299 and later only, read from the release", () => {
  const at = (version: string, base?: string) => knowsMono({ version, ...(base !== undefined ? { base } : {}) })
  expect([at('2.1.287', '2.1.287'), at('2.1.295', '2.1.295'), at('2.1.298', '2.1.298')]).toEqual([false, false, false])
  expect([at('2.1.299', '2.1.299'), at('2.1.309', '2.1.309'), at('2.2.0', '2.2.0'), at('3.0.0', '3.0.0')]).toEqual([true, true, true, true])
  expect([at('2.0.999', '2.0.999'), at('1.9.400', '1.9.400')]).toEqual([false, false])
  // A development build: its base names the release, its version the build.
  expect(at('2.1.300-dev.20261001.t101500.sha1a2b3c4', '2.1.300-dev')).toBe(true)
  expect(at('2.1.296-dev.20260920.t101500.sha1a2b3c4', '2.1.296-dev')).toBe(false)
  // No base: the version itself, when it is spelled as a release.
  expect([at('2.1.310'), at('2.1.290')]).toEqual([true, false])
  // Nothing to read: no face.
  expect([at('local'), at(''), knowsMono(null), knowsMono(undefined)]).toEqual([false, false, false, false])
})

test('switching to another model with the same window reads its compaction window afresh', async ($, on) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  let compact = 400_000
  let reads = 0
  on('session.usage', (_$, e) => {
    if (e.breakdown) reads += 1
    const breakdown = e.breakdown ? { rawMaxTokens: compact, isAutoCompactEnabled: true } : undefined
    return { value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000, ...(breakdown ? { breakdown: breakdown as never } : {}) } } }
  })
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'x' }
  on('turn.step', async function* () {
    return { turnId: 'M1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const step = async (model: string) => {
    const s = $.turn.step({ turnId: 'M1', index: 0, model, messageCount: 1 })
    for await (const _ of s) void _
    await s.result
  }
  const measure = (tokens: number) =>
    $.session.measure({ context: { window: 1_000_000, tokens, percent: tokens / 10_000 }, rateLimits: [], changed: ['context'] })
  await step('claude-opus-5-5[1m]')
  await measure(300_000)
  await step('claude-opus-5-5[1m]')
  await measure(360_000)
  expect(reads).toBe(1) // the same model: not asked again
  // Another 1M model whose own autoCompactWindow (modelSettings) is 700k.
  compact = 700_000
  await step('claude-sonnet-5-5[1m]')
  await measure(360_000)
  expect(reads).toBe(2)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /360k\/700k/ })).toBeDefined()
  expect(await ui.find({ text: /^51%$/ })).toBeDefined()
  await ui.unmount()
})

test('a resume through agent.spawn logs once, whether its spawn or its first step lands first; "done" times the run', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }
  on('turn.step', async function* () {
    return { turnId: 'R1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const step = async () => {
    const s = $.turn.step({ turnId: 'R1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'r1' })
    for await (const _ of s) void _
    await s.result
  }
  // A resumed agent may take its first step before its spawn's own hooks have finished.
  let isStepFirst = false
  on('agent.spawn', async (_$, e) => {
    if (e.resume && isStepFirst) await step()
    return { model: 'claude-sonnet-5-5', agentId: e.resume?.agentId ?? 'r1' }
  })
  const complete = (durationMs: number) =>
    $.turn.complete({ answer: 'ok', durationMs, isAborted: false, turnId: 'R1', agentId: 'r1', reason: 'answer' })
  const lines = async (re: RegExp) => {
    const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
    const n = (await ui.findAll({ text: re })).length
    await ui.unmount()
    return n
  }
  await $.turn.start({ text: 'go', turnId: 'T1' })
  await $.agent.spawn(spawn('general-purpose', 'Audit the parser'))
  await step()
  await clock.advance(60_000)
  await complete(60_000)
  // Idle half an hour, then resumed: the spawn first, then its step.
  await clock.advance(30 * 60_000)
  await $.agent.spawn({ ...spawn('general-purpose', 'Audit it again'), resume: { agentId: 'r1' } })
  await step()
  expect(await lines(/^resumed$/)).toBe(1)
  await clock.advance(90_000)
  await complete(90_000)
  // Resumed again, its first step landing inside the spawn.
  isStepFirst = true
  await $.agent.spawn({ ...spawn('general-purpose', 'And once more'), resume: { agentId: 'r1' } })
  expect(await lines(/^resumed$/)).toBe(2)
  expect(await lines(/^Audit the parser$/)).toBe(0) // one card, the latest task
  // Each run timed on its own, not from the first spawn.
  expect(await lines(/^done · 1m00s$/)).toBe(1)
  expect(await lines(/^done · 1m30s$/)).toBe(1)
})

test("a subagent's turn start is its own: no prompt line, and the main turn keeps its count", async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.turn.start({ text: 'refactor it', turnId: 'T1' })
  await $.tool.call({ tool: 'Edit', file_path: '/x.ts', old_string: 'a', new_string: 'b' } as never)
  await $.turn.start({ text: 'Look at the parser again', turnId: 'A1', agentId: 'sub1' })
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 'T1', reason: 'answer' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /Look at the parser again/ })).toBeUndefined()
  expect(await ui.find({ text: /refactor it/ })).toBeDefined()
  expect(await ui.find({ text: /· 1 edit ·/ })).toBeDefined()
  await ui.unmount()
})

test('a line keeps the pieces that fit, in order, counting each lead and the gaps between them', () => {
  const pieces = [{ width: 5 }, { width: 5, lead: 2 }, { width: 3 }]
  expect([piecesThatFit(pieces, 13, 1), piecesThatFit(pieces, 12, 1), piecesThatFit(pieces, 17, 1), piecesThatFit(pieces, 4, 1)]).toEqual([2, 1, 3, 0])
  expect([cellWidth('■ ▰▱ 48%'), cellWidth('')]).toEqual([8, 0])
})

// ---------------------------------------------------------------- width check

// The kit lays nothing out, so this measures the drawn tree as a row layout would: the fewest cells
// each element needs without spilling (a truncating Text or a clipping Box needs none, a Text that
// asks to wrap its longest word, any other Text its whole length, a plain Button with a hotkey `1: `
// more than its label), and checks that every Box given a width holds what it contains.
type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isDrawn = (n: unknown): n is Drawn => typeof n === 'object' && n !== null && typeof (n as Drawn).type === 'string'
const cellsOf = (s: string) => [...s].length
const textOf = (n: unknown): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : isDrawn(n) ? (n.children ?? []).map(textOf).join('') : ''
const spaceOf = (v: unknown) => (typeof v === 'number' ? v : v === undefined ? 0 : 1)
const longestWord = (s: string) => Math.max(0, ...s.split(/\s+/).map(cellsOf))
const needs = (n: unknown, out: string[], path: string): number => {
  if (typeof n === 'string') return longestWord(n)
  if (!isDrawn(n)) return 0
  const p = n.props ?? {}
  const here = `${path}/${String(p.key ?? n.type)}`
  if (n.type === 'Text') return p.wrap === undefined ? cellsOf(textOf(n)) : p.wrap === 'wrap' ? longestWord(textOf(n)) : 1
  if (n.type === 'Button') return cellsOf(String(p.label ?? '')) + (p.plain ? (p.hotkey ? 3 : 0) : 4)
  if (n.type === 'Client') return typeof p.width === 'number' ? p.width : 5
  if (n.type !== 'Box') return 0
  const kids = (n.children ?? []).filter(c => c !== null && c !== undefined && c !== false && c !== '')
  const inner = kids.map((c, i) => needs(c, out, `${here}[${i}]`))
  const isColumn = p.flexDirection === 'column' || p.flexDirection === 'column-reverse'
  const content =
    isColumn || p.flexWrap === 'wrap'
      ? Math.max(0, ...inner)
      : inner.reduce((a, b) => a + b, 0) + spaceOf(p.columnGap ?? p.gap) * Math.max(0, inner.length - 1)
  const need = content + (p.borderStyle ? 2 : 0) + 2 * spaceOf(p.paddingX ?? p.padding)
  const margin = spaceOf(p.marginLeft) + spaceOf(p.marginRight) + 2 * spaceOf(p.marginX)
  // A Box with a width must hold its contents, clipping or not; one without clips to nothing if it may.
  if (typeof p.width === 'number') {
    if (need > p.width) out.push(`${here}: needs ${need} in ${p.width}`)
    return p.width + margin
  }
  return (p.overflow === 'hidden' ? 0 : need) + margin
}

/**
 * What a graphical surface needs of a line of text: no `truncate` Text nests Texts (the desktop app wraps the
 * nested pieces, or lays truncating ones out as blocks of their own), and no Text placed in a Box starts or
 * ends with a space (it collapses spaces, so a gap between pieces is the Box's, not the text's).
 */
const desktopFaults = (n: unknown, out: string[], path = '', parent = ''): string[] => {
  if (!isDrawn(n)) return out
  const p = n.props ?? {}
  const here = `${path}/${String(p.key ?? n.type)}`
  const kids = (n.children ?? []).filter(isDrawn)
  if (n.type === 'Text') {
    const text = textOf(n)
    if (p.wrap === 'truncate' && kids.some(k => k.type === 'Text')) out.push(`${here}: truncates nested Texts "${text}"`)
    if (parent === 'Box' && text !== text.trim()) out.push(`${here}: edge spaces "${text}"`)
    return out
  }
  kids.forEach((k, i) => desktopFaults(k, out, `${here}[${i}]`, n.type))
  return out
}
const spillsOf = (tree: unknown, columns: number) => {
  const out: string[] = []
  const need = needs(tree, out, '')
  if (need > columns) out.push(`root: needs ${need} in ${columns}`)
  return out
}

/** A session with every panel busy: a compaction window, limits, consults with advice, checks of every kind, agents, a loop. */
const busySession = async ($: Parameters<TestBody>[0], on: On) => {
  const clock = engine(on)
  await clock.advance(3_600_000) // clocks draw as m:ss, as in a session, not as the '—' of an unknown start
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('tool.check', (_$, e) => ({ decision: (e.tool_use_id ?? '').endsWith('7') ? 'deny' : 'allow' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  let n = 0
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: e.subagentType.includes('advisor') ? 'adv1' : `b${++n}` }))
  const usage = { input_tokens: 4000, output_tokens: 900, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
  on('turn.step', async function* () {
    yield { kind: 'text' as const, index: 0, text: 'ok' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'B1', index: 0, answer: 'ok', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const step = async (agentId?: string) => {
    const s = $.turn.step({ turnId: 'B1', index: 0, model: 'claude-opus-5-5[1m]', messageCount: 1, ...(agentId ? { agentId } : {}) })
    for await (const _ of s) void _
    await s.result
  }
  await $.session.measure({
    context: { window: 1_000_000, tokens: 360_000, percent: 36 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 82, resetsAt: new Date(3 * 3_600_000).toISOString() },
      { kind: 'seven_day_opus', percentUsed: 40, resetsAt: new Date(4 * 86_400_000).toISOString() },
    ],
    cost: { usd: 123.45 },
    changed: ['context', 'rateLimits', 'cost'],
  } as never)
  await $.turn.start({ text: 'Refactor the configuration loader and keep every public name stable please', turnId: 'B1' })
  await step()
  const tools = [
    { tool: 'Bash', input: { command: 'npm run test -- --reporter=verbose --coverage packages/configuration-loader' } },
    { tool: 'Read', input: { file_path: '/Users/someone/projects/a-very-long-repository-name/src/configuration/loader.ts' } },
    { tool: 'WebFetch', input: { url: 'https://example.com/a/very/long/documentation/path/for/the/loader' } },
  ]
  for (let i = 0; i < 60; i += 1) await $.tool.check({ ...tools[i % 3]!, tool_use_id: `k${i}` })
  await $.tool.call({ tool: 'Edit', file_path: '/x/loader.ts', old_string: 'a', new_string: 'b', tool_use_id: 'edit1' } as never)
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review of the loader'))
  await $.turn.complete({
    answer: 'Ship it once the configuration loader keeps its public names and the migration test covers the old shape',
    durationMs: 9000, isAborted: false, turnId: 'A1', agentId: 'adv1', reason: 'answer',
  })
  for (const d of ['Write the configuration loader regression tests', 'Map every call site of the old loader', 'Review the migration path for saved state']) {
    await $.agent.spawn(spawn('general-purpose', d))
  }
  await step('b1')
  await step('wf-unclaimed-loop')
  await clock.advance(95_000)
  await $.turn.complete({ answer: '', durationMs: 95_000, isAborted: false, turnId: 'B1', reason: 'answer' })
  return clock
}

test('every panel fits the pane at every width from 24 columns, on every surface and placement, in lines a graphical surface keeps whole', { timeoutMs: 60_000 }, async ($, on) => {
  await busySession($, on)
  const failures: string[] = []
  const check = async (label: string) => {
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      for (let cols = 24; cols <= 40; cols += 1) {
        for (const placement of ['dock', 'inline'] as const) {
          const ui = await $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, placement }, surface })
          for (const s of spillsOf(await ui.drawn(), cols)) failures.push(`${label} ${surface} ${placement} ${cols}: ${s}`)
          await ui.unmount()
        }
      }
      for (const cols of [64, 120]) {
        const ui = await $.ui.mount({ ...pane(cols), surface })
        for (const s of spillsOf(await ui.drawn(), cols)) failures.push(`${label} ${surface} dock ${cols}: ${s}`)
        await ui.unmount()
      }
    }
  }
  await check('lanes, finished')
  // The gate drill-down and an expanded card open, and a turn running.
  const opener = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  await opener.press({ key: 'gate-shell' })
  await opener.press({ key: 'card-b1' })
  await opener.unmount()
  await $.turn.start({ text: 'and once more', turnId: 'B2' })
  await check('drill-down, expanded, running')
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const cols of [24, 32, 40, 64, 120]) {
      for (const placement of ['dock', 'inline'] as const) {
        const ui = await $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, placement }, surface })
        for (const f of desktopFaults(await ui.drawn(), [])) failures.push(`${surface} ${placement} ${cols}: ${f}`)
        await ui.unmount()
      }
    }
  }
  // One line per panel and width that spills, the surface left out (they draw the same boxes).
  expect([...new Set(failures.map(f => f.replace(/ (terminal|desktop|vscode|mobile) /, ' ')))]).toEqual([])
})

test('a single agent card fits from 24 columns, and the time axis scales to the pane', async ($, on) => {
  const clock = engine(on)
  await clock.advance(3_600_000)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'one' }))
  await $.turn.start({ text: 'go', turnId: 'O1' })
  await $.agent.spawn(spawn('general-purpose', 'Write the configuration loader regression tests'))
  const failures: string[] = []
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (let cols = 24; cols <= 40; cols += 1) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      for (const s of spillsOf(await ui.drawn(), cols)) failures.push(`${surface} ${cols}: ${s}`)
      if (surface !== 'terminal') {
        // No pixel width of its own: the surface draws it at the markup's width, down to the pane's.
        const svg = await ui.find({ type: 'Svg' })
        expect([svg !== undefined, svg?.props.width, svg?.props.height]).toEqual([true, undefined, undefined])
      }
      await ui.unmount()
    }
  }
  expect(failures).toEqual([])
})

test('a running agent shows what it does now, and an estimate only once an agent has finished, in the cards and the inline summary', async ($, on) => {
  const clock = engine(on)
  await clock.advance(3_600_000)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `est${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'E1' })
  await $.agent.spawn(spawn('general-purpose', 'First estimate agent'))
  await clock.advance(20_000)
  const drawnText = async (placement: 'dock' | 'inline') => {
    const ui = await $.ui.mount({ ...pane(100), surface: 'terminal', props: { ...pane(100).props, placement } })
    const d = await ui.drawn()
    await ui.unmount()
    return { text: textOf(d), json: JSON.stringify(d) }
  }
  // No agent has finished: no yardstick, so no estimate, and the card says so.
  let dock = await drawnText('dock')
  expect(dock.json).not.toContain('hooks/eta.tsx')
  expect(dock.text).toContain('chưa có ước tính')

  await $.turn.complete({ answer: 'ok', durationMs: 20_000, isAborted: false, turnId: 'E1a', agentId: 'est1', reason: 'answer' })
  await $.agent.spawn(spawn('general-purpose', 'Second estimate agent'))
  await clock.advance(5_000)
  dock = await drawnText('dock')
  expect(dock.json).toContain('hooks/eta.tsx')
  expect(dock.text).not.toContain('chưa có ước tính')
  const inline = await drawnText('inline')
  expect(inline.json).toContain('hooks/eta.tsx')
  expect(inline.text).toContain('↳')
})

/** The engine's answer to `$.session.version()`: a release, or a refusal; a function is asked at each call. */
const engineAt = (on: On, version: string | null | (() => string | null)) =>
  on('session.version', () => {
    const v = typeof version === 'function' ? version() : version
    return v === null ? { deny: 'no version here' } : { value: { version: v, base: v } }
  })

/** A plugin whose pane is one Text in the monospaced face, for `kitHasMono`. */
const monoProbe: Plugin = {
  name: 'mono-probe',
  register(on) {
    on('ui.render', { component: 'Pane', requestId: 'mono-probe' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, { mono: true }, '─') as RenderElement
    })
  },
}

/**
 * Whether the engine `claude plugin test` runs on draws `Text`'s `mono` (2.1.299 and later), as CI runs the
 * tests on the oldest Claude Code the README names as well as a newer one. Nothing in the kit answers
 * `$.session.version()` (a test pins it with engineAt), so a drawing is asked instead: `monoProbe`'s, which
 * the test loads in `plugins`. False when the engine refuses the prop. It is a call on `$`, so the test's
 * hooks go in before it.
 */
const kitHasMono = async ($: Parameters<TestBody>[0]): Promise<boolean> => {
  try {
    const ui = await $.ui.mount({ ...pane(24), plugin: 'mono-probe', requestId: 'mono-probe', surface: 'terminal' })
    await ui.drawn()
    await ui.unmount()
    return true
  } catch (err) {
    if (/Text prop "mono" is not allowed/.test(String(err))) return false
    throw err
  }
}

test('a running connector keeps its length every frame: one face, clipped at its width, the dot still moving', { plugins: [monoProbe] }, async ($, on) => {
  engine(on)
  // The monospaced face where the engine running the tests has it; before 2.1.299 an engine of that age, and none.
  let hasMono = false
  engineAt(on, () => (hasMono ? '2.1.309' : '2.1.295'))
  on('tool.check', () => ({ decision: 'allow' }))
  hasMono = await kitHasMono($)
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'r1' })
  await $.turn.start({ text: 'go', turnId: 'R1' }) // a turn running: the connectors animate
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...pane(64), surface })
    expect((await ui.find({ key: 'link-gate' }))?.type).toBe('Client')
    const heads = new Set<number>()
    for (let frame = 0; frame < 30; frame += 1) {
      const tree = (await ui.drawn({ in: 'link-gate' })) as Drawn
      const texts: Drawn[] = []
      const walk = (n: unknown) => {
        if (!isDrawn(n)) return
        if (n.type === 'Text') texts.push(n)
        else (n.children ?? []).forEach(walk)
      }
      walk(tree)
      const line = texts.map(textOf).join('')
      // The box is the line's width and clips; its text is that width and four spare cells, every frame.
      expect([tree.type, tree.props?.width, tree.props?.overflow]).toEqual(['Box', 64, 'hidden'])
      expect(cellsOf(line)).toBe(64 + 4)
      expect(texts.every(t => t.props?.mono === (hasMono ? true : undefined))).toBe(true)
      expect(/^[─●•┬┴]+$/.test(line)).toBe(true)
      const head = [...line].slice(0, 64).indexOf('●')
      if (head >= 0) heads.add(head)
      await ui.advance(110)
    }
    expect(heads.size > 5).toBe(true) // the dot travels along the line
    await ui.unmount()
  }
})

/** Every Text in a drawing that names `mono`, true or false: an engine before 2.1.299 has no such prop. */
const monoTexts = (n: unknown, out: string[], path: string): string[] => {
  if (!isDrawn(n)) return out
  const here = `${path}/${String(n.props?.key ?? n.type)}`
  if (n.type === 'Text' && n.props !== undefined && 'mono' in n.props) out.push(here)
  ;(n.children ?? []).forEach((c, i) => monoTexts(c, out, `${here}[${i}]`))
  return out
}

/**
 * A turn running with a check in the gate, on an engine at `version` (null: one that won't say; a function:
 * the release to pin, told whether the engine running the tests draws the face, with `monoProbe` loaded),
 * drawn at 64 columns on the terminal and the desktop app for a few frames: the Texts that name `mono`, in
 * the pane and in its animated connectors, the connectors' lines (each a Client, or a still Text with motion
 * off), and what kitHasMono said when it was asked.
 */
const facesAt = async ($: Parameters<TestBody>[0], on: On, version: string | null | ((hasMono: boolean) => string)) => {
  engine(on)
  let pinned = typeof version === 'function' ? null : version
  engineAt(on, () => pinned)
  on('tool.check', () => ({ decision: 'allow' }))
  let hasMono: boolean | undefined
  if (typeof version === 'function') {
    hasMono = await kitHasMono($)
    pinned = version(hasMono)
  }
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'r1' })
  await $.turn.start({ text: 'go', turnId: 'R1' })
  const named: string[] = []
  const lines: string[] = []
  const walkLines = (n: unknown) => {
    if (!isDrawn(n)) return
    if (n.type === 'Text' && /^─{64}$/.test(textOf(n))) lines.push(textOf(n))
    else (n.children ?? []).forEach(walkLines)
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(64), surface })
    for (let frame = 0; frame < 3; frame += 1) {
      const tree = await ui.drawn()
      monoTexts(tree, named, surface)
      walkLines(tree)
      for (const key of ['link-gate', 'link-work']) {
        if ((await ui.find({ key }))?.type !== 'Client') continue
        const rail = await ui.drawn({ in: key })
        monoTexts(rail, named, `${surface}:${key}`)
        lines.push(textOf(rail))
      }
      await ui.advance(110)
    }
    await ui.unmount()
  }
  return { named, lines, hasMono }
}

// #28: on 2.1.295 the pane went empty at the first prompt, when the first connector was drawn with `mono`.
test('on an engine before 2.1.299 nothing asks for the monospaced face, and the connectors still run', async ($, on) => {
  const { named, lines } = await facesAt($, on, '2.1.295')
  expect(named).toEqual([])
  // Both connectors, on both surfaces, every frame: still animated, still clipped at 64 from 68 cells.
  expect(lines.length).toBe(2 * 2 * 3)
  expect(lines.every(l => cellsOf(l) === 64 + 4 && /^[─●•┬┴]+$/.test(l))).toBe(true)
  expect(lines.some(l => /[●•]/.test(l))).toBe(true)
})

test('an engine that will not say its version gets no monospaced face either', async ($, on) => {
  expect((await facesAt($, on, null)).named).toEqual([])
})

// With motion off the terminal draws each connector as a still line; the desktop app draws a blank row there
// (a dashed line would sit flush against the borders and read as another border), so only the terminal's count.
test('with motion off, the still connector is drawn without the face before 2.1.299', { options: { motion: 'off' } }, async ($, on) => {
  const { named, lines } = await facesAt($, on, '2.1.295')
  expect(named).toEqual([])
  expect(lines.length).toBe(2 * 3)
})

test('with motion off, the still connector keeps the face from 2.1.299', { plugins: [monoProbe], options: { motion: 'off' } }, async ($, on) => {
  // An engine running the tests that predates the face refuses it: there, one of that age, and no face.
  // From 2.1.299 the terminal's connector lines name it, and so does every Text the desktop app draws.
  const { named, lines, hasMono } = await facesAt($, on, kit => (kit ? '2.1.299' : '2.1.295'))
  expect(lines.length).toBe(2 * 3)
  expect(hasMono ? named.length > lines.length : named.length === 0).toBe(true)
})

test('on a graphical surface every Text takes the monospaced face from 2.1.299; a terminal draws its own', { plugins: [monoProbe] }, async ($, on) => {
  engine(on)
  let version: string | null = null
  engineAt(on, () => version)
  const hasMono = await kitHasMono($)
  version = hasMono ? '2.1.299' : '2.1.295'
  await $.turn.start({ text: 'go', turnId: 'M1' })
  const faces = async (surface: 'terminal' | 'vscode') => {
    const ui = await $.ui.mount({ ...pane(64), surface })
    const texts: Drawn[] = []
    const walk = (n: unknown) => {
      if (!isDrawn(n)) return
      if (n.type === 'Text') texts.push(n)
      ;(n.children ?? []).forEach(walk)
    }
    walk(await ui.drawn())
    await ui.unmount()
    return { all: texts.length, mono: texts.filter(t => t.props?.mono === true).length }
  }
  const vscode = await faces('vscode')
  expect(vscode.all > 10).toBe(true)
  expect(vscode.mono).toBe(hasMono ? vscode.all : 0)
  expect((await faces('terminal')).mono).toBe(0)
})

// ---------------------------------------------------------------- tokens and the mascot

test('tokens add up per day; the box reads today, the total, the first day and the busiest day', () => {
  const d0 = '2026-11-18'
  const d1 = '2026-11-19'
  let days = addTokens({}, { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 1000, output_tokens: 20 }, d1)
  expect(days[d1]).toEqual({ fresh: 150, out: 20, cache: 1000 })
  days = addTokens(days, { input_tokens: 10, output_tokens: 5 }, d1)
  days = addTokens(days, { output_tokens: 7 }, d0)
  const s = summary(days, d1)
  expect(sumTokens(s.today)).toBe(1185)
  expect(sumTokens(s.total)).toBe(1192)
  expect(s.since).toBe(d0)
  expect(s.best?.day).toBe(d1)
  // The next day: today is empty, the rest stays; a day with no tokens is never the busiest.
  expect(sumTokens(summary(days, '2026-11-20').today)).toBe(0)
  expect(summary({}, d1)).toEqual({ today: { fresh: 0, out: 0, cache: 0 }, total: { fresh: 0, out: 0, cache: 0 }, since: d1, best: null })
  // History imported from the logs and the live counts add up day by day.
  const merged = mergeDays(historyDays({ days: { [d1]: { fresh: 5, out: 0, cache: 0 }, '2026-09-05': { fresh: 1, out: 2, cache: 3 } } }), days)
  expect(merged[d1]).toEqual({ fresh: 165, out: 25, cache: 1000 })
  expect(summary(merged, d1).since).toBe('2026-09-05')
  // No usage adds nothing; junk, or an older shape of the store, reads as nothing.
  expect(addTokens(days, null, d1)[d1]).toEqual(days[d1])
  expect(readDays({ [d1]: { fresh: -5, out: 'x', cache: NaN }, garbage: { fresh: 1 } })).toEqual({ [d1]: { fresh: 0, out: 0, cache: 0 } })
  expect(readDays('x')).toEqual({})
  expect(readDays({ since: '2026-11-19', day: d1, total: { fresh: 1, out: 1, cache: 1 }, today: { fresh: 1, out: 1, cache: 1 } })).toEqual({})
  expect(historyDays(undefined)).toEqual({})
})

test('token counts read short, the day is the local one, the hello follows the hour', () => {
  expect([850, 12_345, 1_240_000, 48_300_000, 3_100_000_000].map(fmtTok)).toEqual(['850', '12.3k', '1.24M', '48.3M', '3.10B'])
  expect(fmtTok(999_999)).toBe('1000k')
  expect(fmtDay('2026-11-19')).toBe('19/11')
  expect(dayKey(new Date(2026, 10, 9, 23, 59).getTime())).toBe('2026-11-09')
  expect(greeting(8, 'Nhung')).toBe('Chào buổi sáng, Nhung!')
  expect([2, 11, 14, 19].map(h => greeting(h, ''))).toEqual(['Khuya rồi!', 'Chào buổi trưa!', 'Chào buổi chiều!', 'Chào buổi tối!'])
  expect(parseConfig({ userName: '  Nhung ' }).userName).toBe('Nhung')
  expect(parseConfig({}).userName).toBe('')
  expect(parseConfig({}).panels).toContain('tokens')
  expect(parseConfig({ panels: 'main,work' }).panels).toEqual(['main', 'work'])
})

test('the mascot keeps one size in every frame, types while working, and looks around, blinks and dozes while idle', () => {
  const width = (r: ReturnType<typeof frame>[number]) => r.reduce((n, s) => n + ('gap' in s ? s.gap : [...s.text].length), 0)
  const text = (rows: ReturnType<typeof frame>) => rows.map(r => r.map(s => ('gap' in s ? ' '.repeat(s.gap) : s.text)).join('')).join('\n')
  for (const active of [true, false]) {
    for (let t = 0; t < 130; t++) {
      const rows = frame(t, active)
      expect(rows.length).toBe(HEIGHT)
      for (const r of rows) expect(width(r) <= WIDTH).toBe(true)
    }
  }
  const work = Array.from({ length: 40 }, (_, t) => text(frame(t, true)))
  expect(new Set(work).size > 30).toBe(true)
  expect(work.every(f => f.includes('╭') && f.includes('▟'))).toBe(true)
  const idle = Array.from({ length: 64 }, (_, t) => text(frame(t, false)))
  expect(idle.every(f => !f.includes('▟'))).toBe(true)
  // Over a cycle the head sits in three places, shuts its eyes once and the z's come and go.
  expect(new Set(idle.map(f => f.split('\n')[1]!.indexOf('▐'))).size).toBe(3)
  expect(idle.some(f => f.includes('▐▀███▀▌'))).toBe(true)
  expect(idle.some(f => f.includes('z')) && idle.some(f => !f.includes('z'))).toBe(true)
})

test('the pane counts every model request on top of the imported history, and the mascot says who works', async ($, on) => {
  const clock = engine(on)
  await clock.advance(Date.UTC(2026, 10, 19, 12))
  // The history the log scan imported: 1000 new tokens on 1 October, 9000 cache reads on 5 October.
  mock.store(on, { history: { days: { '2026-10-01': { fresh: 1000, out: 0, cache: 0 }, '2026-10-05': { fresh: 0, out: 0, cache: 9000 } } } })
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `tk${++n}` }))
  // The model beneath answers every request with its own usage.
  const answers = new Map<string, { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }>()
  on('turn.step', async function* (_$, e) {
    const u = { ...answers.get(e.agentId ?? 'main')!, model: 'claude-opus-5-5' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: u }
    return { turnId: e.turnId, index: 0, answer: 'ok', toolUses: [], stopReason: 'end_turn' as const, usage: u }
  })
  answers.set('main', { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 25 })
  answers.set('tk1', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  const step = async (agentId?: string) => {
    const s = $.turn.step({ turnId: 'K1', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) })
    for await (const _ of s) void _
    await s.result
  }
  const drawn = async (cols: number) => {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const d = await ui.drawn()
    await ui.unmount()
    return { text: textOf(d), json: JSON.stringify(d) }
  }

  // Idle, nothing counted live yet: the hello, the box with the history's first day.
  const idle = await drawn(66)
  expect(idle.text).toContain('Chào')
  expect(idle.text).toContain('TOKEN')
  expect(idle.json).toContain('hooks/mascot.tsx')
  expect(idle.json).toContain('"active":false')

  await $.turn.start({ text: 'go', turnId: 'K1' })
  await $.agent.spawn(spawn('general-purpose', 'Audit the parser'))
  await step()
  await step('tk1')
  // Main: 125 new + 50 out + 1000 cache; the agent: 10 + 5. Today's row holds just those 1190; the total adds
  // the history, from its first day; the busiest day is 5 October.
  const working = await drawn(66)
  expect(working.text).toContain('từ 01/10')
  expect(working.text).toContain('vào 135 · ra 55 · cache 1.00k')
  expect(working.text).toContain('1.19k')
  expect(working.text).toContain('11.2k')
  expect(working.text).toContain('vào 1.14k · ra 55 · cache 10.0k')
  expect(working.text).toContain('cao nhất')
  expect(working.text).toContain('05/10 · vào 0 · ra 0 · cache 9.00k')
  expect(working.text).toContain('Claude đang code')
  expect(working.text).toMatch(/◐ .*Audit/)
  expect(working.json).toContain('"active":true')
  // Inline above the prompt it is one more piece on the first line.
  const ui = await $.ui.mount({ ...pane(100), surface: 'terminal', props: { ...pane(100).props, placement: 'inline' } })
  expect(textOf(await ui.drawn())).toContain('hôm nay 1.19k')
  await ui.unmount()
})

// ---------------------------------------------------------------- the main box, the work box, the branch

test('a bar fills in eighths, a HEAD names its branch, and tokens add up per agent', () => {
  expect(bar(50, 10)).toEqual({ on: '█████', off: '░░░░░' })
  expect(bar(0, 4)).toEqual({ on: '', off: '░░░░' })
  expect(bar(100, 4)).toEqual({ on: '████', off: '' })
  expect(bar(37.5, 4)).toEqual({ on: '█▌', off: '░░' }) // 1.5 cells
  expect(bar(250, 4).on).toBe('████') // never past its width
  expect(branchOf('ref: refs/heads/feat/login\n')).toBe('feat/login')
  expect(branchOf('ref: refs/remotes/origin/main')).toBe('remotes/origin/main')
  expect(branchOf('0123456789abcdef0123456789abcdef01234567\n')).toBe('0123456')
  expect(branchOf('')).toBe('')
  expect(branchOf('garbage')).toBe('')
  expect(tokensOf({ input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 7 })).toEqual({ fresh: 15, out: 7, cache: 100 })
  expect(tokensOf(null)).toEqual({ fresh: 0, out: 0, cache: 0 })
  const c = applyStep(normalizeCard({ id: 'a' }), { model: 'm', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90 }, stopReason: null })
  const d = applyStep(c, { model: 'm', usage: { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 190 }, stopReason: null })
  expect(countOf(d.used)).toEqual({ fresh: 30, out: 10, cache: 280 })
  expect(d.out).toBe(10) // the card's own output count is unchanged
  // A card saved before `used` existed, or with junk in it, reads as nothing and still adds.
  expect(countOf(undefined)).toEqual({ fresh: 0, out: 0, cache: 0 })
  expect(addCount({ fresh: 'x', out: 2 }, { fresh: 1, out: 1, cache: 1 })).toEqual({ fresh: 1, out: 3, cache: 1 })
})

test('the main box shows the model, branch, effort, mode and the meters, large; the branch is read from .git/HEAD above the session directory', async ($, on) => {
  const clock = engine(on)
  await clock.advance(Date.UTC(2026, 10, 19, 12))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'flightdeck' } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.cwd', () => ({ value: '/work/proj/src' }))
  on('fs.read', (_$, e) => {
    if (e.path === '/work/proj/.git/HEAD') return { value: 'ref: refs/heads/feat/login\n' }
    throw new Error('ENOENT')
  })
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
  on('turn.step', async function* () {
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'H1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  await $.session.start({ cwd: '/work/proj/src', surface: 'terminal', isInteractive: true })
  const s = $.turn.step({ turnId: 'H1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as never)
  for await (const _ of s) void _
  await s.result
  await $.session.measure({
    context: { window: 200_000, tokens: 124_000, percent: 62 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 31, resetsAt: new Date(clock.now() + 2 * 3_600_000 + 10 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 90, resetsAt: new Date(clock.now() + 4 * 86_400_000).toISOString() },
    ],
    cost: { usd: 12.34 },
    changed: ['context', 'rateLimits', 'cost'],
  } as never)
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const text = textOf(await ui.drawn())
    for (const want of ['✦ OPUS 5.5', '⎇ feat/login', 'NGỮ CẢNH', '5h'.toUpperCase(), '7D', 'CHI PHÍ', '$12.34', '62%', '31%', '90%']) expect(text).toContain(want)
    // 90% is past the red mark, 62% past the amber one, 31% neither.
    const colours = async (pct: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${pct}%$`) }))?.props.color
    expect([await colours('90'), await colours('62'), await colours('31')]).toEqual(['error', 'warning', 'claude'])
    await ui.unmount()
  }
  // Wide enough for the tails: the window's tokens and the time to each reset.
  const wide = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  const wideText = textOf(await wide.drawn())
  expect(wideText).toContain('124k/200k')
  expect(wideText).toContain('↻ 2h10m')
  await wide.unmount()
})

test('the work box adds up what the turn cost: the main loop and each agent that started in it, and starts over with the next prompt', async ($, on) => {
  const clock = engine(on)
  await clock.advance(3_600_000)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `w${++n}` }))
  const answers: Record<string, { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }> = {
    main: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
    w1: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 },
  }
  on('turn.step', async function* (_$, e) {
    const u = { ...answers[e.agentId ?? 'main']!, model: 'claude-opus-5-5' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: u }
    return { turnId: e.turnId, index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: u }
  })
  const step = async (agentId?: string) => {
    const s = $.turn.step({ turnId: 'W1', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) })
    for await (const _ of s) void _
    await s.result
  }
  const text = async (cols = 100) => {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const t = textOf(await ui.drawn())
    await ui.unmount()
    return t
  }
  expect(await text()).not.toContain('LẦN LÀM VIỆC') // no turn yet: no box

  await $.turn.start({ text: 'go', turnId: 'W1' })
  expect(await text()).toContain('chưa chạy agent nào trong lần này')
  await $.agent.spawn(spawn('general-purpose', 'Audit the parser'))
  await step()
  await step('w1')
  await step('w1')
  // main 1150; the agent 2 x 415 = 830; together 1980.
  const t1 = await text()
  expect(t1).toContain('LẦN LÀM VIỆC · token')
  expect(t1).toContain('● đang chạy')
  expect(t1).toContain('1.15k')
  expect(t1).toContain('830')
  expect(t1).toContain('1.98k')
  expect(t1).toContain('vào 20 · ra 10 · cache 800')
  expect(t1).toMatch(/Audit the/)
  expect(t1).toContain('main 1.15k · 1 agent 830')

  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'W1', reason: 'answer' })
  expect(await text()).toContain('✓ xong') // the finished work stays on show
  // Inline above the prompt: one line.
  const ui = await $.ui.mount({ ...pane(100), surface: 'terminal', props: { ...pane(100).props, placement: 'inline' } })
  expect(textOf(await ui.drawn())).toContain('lần này 1.98k token · main 1.15k · 1 agent 830')
  await ui.unmount()

  // The next prompt: the main loop's count starts over, and the earlier agent is not part of this work.
  await clock.advance(5000)
  await $.turn.start({ text: 'again', turnId: 'W2' })
  const t2 = await text()
  expect(t2).toContain('chưa chạy agent nào trong lần này')
  expect(t2).not.toContain('1.98k')
})
