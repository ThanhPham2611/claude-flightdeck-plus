// A running agent's estimated progress and time left, counting down on the surface's frame clock so the
// pane need not redraw. `since`/`now` come from the hooks module's $.clock, `baseMs` from baselineMs in
// core.ts; between redraws it adds its own ticks. A surface module is self-contained, so the math of
// etaText (core.ts) is repeated here.
import type { ClientModule } from 'claude-code'

type Props = { since: number; now: number; baseMs: number; color: string; dim: string }
type Ref = { base: number; ticks: number; lastNow: number }
type State = { ref: Ref }

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

const Eta: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { base: 0, ticks: 0, lastNow: -1 }
  if (props.now !== ref.lastNow) {
    // A fresh reading from the hooks module: restart the local count from it.
    ref.lastNow = props.now
    ref.base = props.now - props.since
    ref.ticks = 0
  }
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(1000, () => {
      ref.ticks += 1
      surface.setState({ ref })
    })
  }

  const elapsed = ref.base + ref.ticks * 1000
  const left = props.baseMs - elapsed
  const pct = Math.max(0, Math.min(95, Math.floor((elapsed / props.baseMs) * 100)))
  const text = left > 0 ? `~${pct}% · còn ${fmt(left)}` : 'lâu hơn thường'
  // The bar takes what the text leaves, up to 8 cells; a narrow region keeps just the text.
  const barW = Math.max(0, Math.min(8, (surface.columns || 20) - text.length - 1))
  const full = left > 0 ? Math.round((pct / 100) * barW) : barW
  return (
    <Box columnGap={1} overflow="hidden">
      {barW > 0 ? (
        <Box flexShrink={0}>
          <Text color={props.color}>{'▰'.repeat(full)}</Text>
          <Text color={props.dim}>{'▱'.repeat(barW - full)}</Text>
        </Box>
      ) : null}
      <Text color={left > 0 ? props.color : props.dim} wrap="truncate">
        {text}
      </Text>
    </Box>
  )
}

export default Eta
