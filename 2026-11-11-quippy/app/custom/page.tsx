export const dynamic = "force-dynamic";

import { CustomForm } from "@/components/CustomForm";

export default function CustomPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Practice anything</h1>
      <p className="text-stone-600 dark:text-stone-400">Describe a real situation and we will turn it into a scenario with a scene partner.</p>
      <CustomForm />
    </div>
  );
}
