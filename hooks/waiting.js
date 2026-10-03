// How many coter-kit questions wait on you, per project, from the brain's journal rows.
// Pure, so it can be tested without a brain on disk.
//
// Read the way coter-kit reads them: status rows applied in time order, unanswered questions
// dropped after 30 days. On top of that, the same question saved twice (two devices, a minute
// apart) counts once. Only `waiting` notes count: never threads (coter-kit 0.6.1 saves every
// question as a waiting note) and never handoffs.
//
// coter-kit plans a live status file (its build plan, M2). When that ships, read it instead of
// the journal; until then this mirrors coter-kit's own reader.

const TTL_MS = 30 * 86_400_000
const norm = (t) => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ')

export function countWaiting(rows, now) {
  const entries = new Map()
  const ops = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    if (row.op) ops.push(row)
    else if (row.id && row.kind) entries.set(row.id, row)
  }
  ops.sort((a, b) => a.at - b.at)
  for (const op of ops) {
    const e = entries.get(op.ref)
    if (e && op.op === 'status') entries.set(op.ref, { ...e, status: op.status, updatedAt: op.at })
  }
  const seen = new Set()
  const by = {}
  for (const e of entries.values()) {
    if (e.kind !== 'waiting' || e.status !== 'active' || now - (e.updatedAt || e.at) > TTL_MS) continue
    const project = e.project || 'every project'
    const key = project + '\u0000' + norm(e.text)
    if (seen.has(key)) continue
    seen.add(key)
    by[project] = (by[project] || 0) + 1
  }
  return by
}
