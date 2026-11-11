import type { ScenarioState } from "@/lib/logic";
import { PATTERN_LABELS } from "@/lib/patterns";
import type { Pattern, Scenario } from "@/lib/schemas";
import { StartButton } from "./StartButton";

export function ScenarioCard({ scenario, state, focus }: { scenario: Scenario; state: ScenarioState; focus?: Pattern | null }) {
  const locked = state === "locked";
  return (
    <article className={`rounded-xl border p-4 ${locked ? "border-stone-200 bg-stone-100 opacity-60 dark:border-stone-800 dark:bg-stone-900" : "border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900"}`} data-state={state}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{scenario.title}</h3>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${state === "completed" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : state === "unlocked" ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200" : "bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400"}`}>
          {state === "completed" ? "Completed" : state === "unlocked" ? "Unlocked" : "Locked"}
        </span>
      </div>
      <p className="mt-1 text-sm"><strong>{scenario.character}</strong>, {scenario.persona}</p>
      <p className="mt-1 text-sm text-stone-600 dark:text-stone-400"><span className="font-medium">Stakes:</span> {scenario.stakes}</p>
      <p className="text-sm text-stone-600 dark:text-stone-400"><span className="font-medium">Your goal:</span> {scenario.goal}</p>
      {focus && state === "unlocked" && (
        <p className="mt-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Focus: {PATTERN_LABELS[focus]}</p>
      )}
      {!locked && (
        <div className="mt-3">
          <StartButton scenarioId={scenario.id} label={state === "completed" ? "Practice again" : "Start"} />
        </div>
      )}
    </article>
  );
}
