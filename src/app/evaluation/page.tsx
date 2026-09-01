import { EvaluationView } from "@/components/evaluation/EvaluationView";
import { LiveShell } from "@/components/shell/LiveShell";

export const metadata = {
  title: "Did value-based bidding work? · VBB",
};

export default function EvaluationPage() {
  return (
    <LiveShell>
      <EvaluationView />
    </LiveShell>
  );
}
