import { PlaceholderPage } from "@/features/shell/placeholder-page";

type ArtifactPageProps = {
  params: Promise<{ artifactId: string }>;
};

export default async function ArtifactPage({ params }: ArtifactPageProps) {
  const { artifactId } = await params;
  return <PlaceholderPage title={`Artifact ${artifactId}`} description="Patches, changed files, logs, transcripts, generated files, and test outputs." />;
}
