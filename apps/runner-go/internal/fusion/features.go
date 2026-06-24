package fusion

import "os"

// synthesisV2Enabled reports whether the two-phase judge prompt (Phase A
// <synthesis_analysis> block + Phase B final answer) is enabled. Gated behind
// the FEATURE_SYNTHESIS_V2 env var per the strangler-fig migration pattern.
// When disabled, the judge uses the single-pass answer-only prompt.
func synthesisV2Enabled() bool {
	return os.Getenv("FEATURE_SYNTHESIS_V2") == "1" || os.Getenv("FEATURE_SYNTHESIS_V2") == "true"
}
