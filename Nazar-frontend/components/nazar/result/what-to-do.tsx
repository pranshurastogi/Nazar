const STEPS = ['Stop using it.', 'Keep the pack.', 'Return it to your chemist.', 'If already taken, talk to a doctor.']

export function WhatToDo() {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What to do</p>
      <ol className="mt-2 grid gap-1.5 text-sm">
        {STEPS.map((s, i) => (
          <li key={s} className="flex gap-2">
            <span className="font-mono text-xs leading-5 text-muted-foreground">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  )
}
