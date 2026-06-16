export function buildArtifactKey(orgId: string, runId: string, name: string) {
  return `runs/${orgId}/${runId}/${name}`;
}
