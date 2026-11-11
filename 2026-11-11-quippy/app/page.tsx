import Link from "next/link";
import { readDb } from "@/lib/db";
import { CUSTOM_UNIT_ID } from "@/lib/logic";
import { progressFrom } from "@/lib/progress";
import { ScenarioCard } from "@/components/ScenarioCard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await readDb();
  const { progress, states, focusScenarioId, focusPattern } = progressFrom(db);
  const units = db.units.filter((u) => u.id !== CUSTOM_UNIT_ID).sort((a, b) => a.order - b.order);
  const custom = db.scenarios.filter((s) => s.unitId === CUSTOM_UNIT_ID);
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold">Rehearse the conversation before you have it</h1>
        <p className="mt-1 text-stone-600 dark:text-stone-400">
          Pick a scenario, talk it through with an AI scene partner, then see which lines landed. Streak: {progress.streakDays} day{progress.streakDays === 1 ? "" : "s"}.
        </p>
        <Link href="/custom" className="mt-3 inline-block rounded-lg border border-indigo-600 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950">Practice anything</Link>
      </section>
      {units.map((unit) => (
        <section key={unit.id}>
          <h2 className="text-lg font-semibold">Unit {unit.order}: {unit.title}</h2>
          <p className="mb-3 text-sm text-stone-500">{unit.blurb}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {db.scenarios.filter((s) => s.unitId === unit.id).sort((a, b) => a.order - b.order).map((s) => (
              <ScenarioCard key={s.id} scenario={s} state={states[s.id]} focus={s.id === focusScenarioId ? focusPattern : null} />
            ))}
          </div>
        </section>
      ))}
      {custom.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Custom</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {custom.map((s) => <ScenarioCard key={s.id} scenario={s} state={states[s.id]} />)}
          </div>
        </section>
      )}
    </div>
  );
}
