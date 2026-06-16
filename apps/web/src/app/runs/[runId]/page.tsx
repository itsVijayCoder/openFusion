import { PlaceholderPage } from "@/features/shell/placeholder-page";

type RunPageProps = {
  params: Promise<{ runId: string }>;
};

export default async function RunPage({ params }: RunPageProps) {
  const { runId } = await params;
  return <PlaceholderPage title={`Run ${runId}`} description="Fusion trace, raw panel outputs, judge JSON, final answer, timings, and errors." />;
}
