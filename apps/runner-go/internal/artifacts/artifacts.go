package artifacts

import "path"

func ObjectKey(orgID string, runID string, name string) string {
	return path.Join("runs", orgID, runID, name)
}
