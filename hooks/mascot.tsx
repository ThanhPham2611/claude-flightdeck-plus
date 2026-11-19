// Clawd, the Claude Code mascot, drawn in block characters on the surface's own frame clock.
// Working: sits at an open laptop, code scrolling on its screen, hands on the keys, a spark spinning.
// Idle: the laptop is shut and a coffee steams; Clawd looks around, blinks and dozes off.
// Only this region redraws; the pane does not. A surface module is self-contained, so the frames live here.
import type { ClientModule } from 'claude-code'

type Role = 'c' | 's' | 'd' | 'k' | 'l'
type Colors = Record<Role, string>
type Props = { active: boolean; width: number; colors: Colors; mono: boolean }
type Ref = { tick: number; active: boolean; drawn: string }
type State = { ref: Ref }
type Seg = { gap: number } | { text: string; role: Role }

const STEP_MS = 140
export const WIDTH = 28
export const HEIGHT = 5
const LX = 14 // the laptop's left edge
const IN = 12 // its screen's inner width

const HEAD = '▐▛███▜▌'
const BLINK = '▐▀███▀▌'
// Arms: both down, left hand strikes, both down, right hand strikes.
const ARMS = ['▝▜█████▛▘', '▗▟█████▛▘', '▝▜█████▛▘', '▝▜█████▙▖']
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
// A line of code is its indent and its length in bars; they scroll as the lines move up.
const CODE: [number, number][] = [[0, 3], [2, 6], [2, 4], [0, 8], [2, 5], [4, 7], [2, 2], [0, 6]]

/** A row of WIDTH cells from [column, text, role] parts: the gaps are boxes, not spaces, which a graphical surface collapses. */
const row = (parts: [number, string, Role][]): Seg[] => {
  const out: Seg[] = []
  let at = 0
  for (const [col, text, role] of parts) {
    if (col > at) out.push({ gap: col - at })
    out.push({ text, role })
    at = col + [...text].length
  }
  return out
}

/** The mascot's `t`th frame: HEIGHT rows. Same input, same frame, so a redraw only happens when one changes. */
export const frame = (t: number, active: boolean): Seg[][] => {
  const R = (col: number, text: string, role: Role): [number, string, Role] => [col, text, role]
  if (active) {
    const n = Math.floor(t / 3)
    // The last line carries the cursor, blinking; the bars stop a cell short of the screen's edge for it.
    const code = (i: number, cursor = ''): [number, string, Role] => {
      const [indent, bars] = CODE[(n + i) % CODE.length]!
      return R(LX + 2 + indent, '▬'.repeat(Math.min(bars, IN - 3 - indent)) + cursor, 'k')
    }
    const keys = Array.from({ length: IN }, (_, i) => ((i + t) % 3 === 0 ? '▄' : '▂')).join('')
    return [
      row([R(3, SPINNER[t % SPINNER.length]!, 's'), R(LX, `╭${'─'.repeat(IN)}╮`, 'l')]),
      row([R(3, t % 24 === 11 ? BLINK : HEAD, 'c'), R(LX, '│', 'l'), code(0), R(LX + IN + 1, '│', 'l')]),
      row([R(1, ARMS[t % ARMS.length]!, 'c'), R(LX, '│', 'l'), code(1), R(LX + IN + 1, '│', 'l')]),
      row([R(3, '▘▘', 'c'), R(6, '▝▝', 'c'), R(LX, '│', 'l'), code(2, t % 4 < 2 ? '▌' : ''), R(LX + IN + 1, '│', 'l')]),
      row([R(0, '▁'.repeat(LX), 'd'), R(LX, `▟${keys}▙`, 'l')]),
    ]
  }
  const cyc = t % 64
  // The head turns: 1 is left of centre, 2 centre, 3 right.
  const look = cyc < 14 ? 2 : cyc < 22 ? 1 : cyc < 36 ? 2 : cyc < 46 ? 3 : 2
  const z = cyc > 24 && cyc < 44 ? (['z', 'zz', 'Zzz'] as const)[Math.floor((cyc - 25) / 7) % 3]! : ''
  const steam = [' ) ', ' ( ', '( )', ') ('][Math.floor(t / 3) % 4]!.trim()
  return [
    row([...(z ? [R(3, z, 's')] : []), R(LX + 4, steam, 'd')]),
    row([R(look, cyc === 54 || cyc === 55 ? BLINK : HEAD, 'c'), R(LX + 3, '╭───╮', 'd')]),
    row([R(1, ARMS[0]!, 'c'), R(LX + 3, '│', 'd'), R(LX + 7, '│', 'd'), R(LX + 8, '◗', 'd')]),
    row([R(3, '▘▘', 'c'), R(6, '▝▝', 'c'), R(LX + 3, '╰───╯', 'd')]),
    row([R(0, '▁'.repeat(LX), 'd'), R(LX, '▂'.repeat(IN + 2), 'l')]),
  ]
}

const Mascot: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { tick: 0, active: props.active, drawn: '' }
  ref.active = props.active
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      ref.tick += 1
      // Only a frame that differs is drawn: working changes every tick, idle a few times a second at most.
      const next = JSON.stringify(frame(ref.tick, ref.active))
      if (next !== ref.drawn) {
        ref.drawn = next
        surface.setState({ ref })
      }
    })
  }

  const face = props.mono ? { mono: true } : {}
  const rows = frame(ref.tick, props.active)
  return (
    <Box width={Math.max(1, surface.columns || props.width)} flexDirection="column" alignItems="center">
      {rows.map(r => (
        <Box width={WIDTH} flexShrink={0}>
          {r.map(seg =>
            'gap' in seg ? (
              <Box width={seg.gap} flexShrink={0} />
            ) : (
              <Box flexShrink={0}>
                <Text color={props.colors[seg.role]} {...face}>
                  {seg.text}
                </Text>
              </Box>
            ),
          )}
        </Box>
      ))}
    </Box>
  )
}

export default Mascot
