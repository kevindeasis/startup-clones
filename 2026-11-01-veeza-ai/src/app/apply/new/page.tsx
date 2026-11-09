import { Suspense } from "react";
import NewApplicationForm from "@/components/NewApplicationForm";

export default function NewApplication() {
  return (
    <Suspense>
      <NewApplicationForm />
    </Suspense>
  );
}
