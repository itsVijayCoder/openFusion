package fusion

import "os"

// Lens is a perspective bias assigned to a panel model. Each model still gives
// a full answer; the lens biases the model's attention, not its scope. This
// maximizes information gain from running multiple models (strategy pattern).
type Lens struct {
	Name        string
	Instruction string
}

// panelLenses is the default lens set, ordered for round-robin assignment.
// The first two (correctness, pragmatism) are maximally different so a 2-model
// panel still gets useful diversity.
var panelLenses = []Lens{
	{Name: "correctness", Instruction: "Emphasize correctness, edge cases, error handling, and failure modes."},
	{Name: "performance", Instruction: "Emphasize performance, scalability, latency, and resource use."},
	{Name: "security", Instruction: "Emphasize security, attack surface, data exposure, and permission boundaries."},
	{Name: "maintainability", Instruction: "Emphasize readability, simplicity, conventions, and long-term maintainability."},
	{Name: "pragmatism", Instruction: "Emphasize the simplest working solution that ships now, with clear trade-offs."},
}

// lensForIndex assigns a lens round-robin to a panel model by index. If the
// panel is smaller than the lens set, the first N lenses are used in order.
// If larger, the set wraps. The assignment is deterministic and recorded in
// the trace.
func lensForIndex(index int) Lens {
	if len(panelLenses) == 0 {
		return Lens{Name: "general", Instruction: "Give your full best answer."}
	}
	return panelLenses[index%len(panelLenses)]
}

// noDiversityMode reports whether panel diversity is disabled. When true, all
// panel models get the identical generic prompt (preserves the pre-diversity
// behavior as an explicit opt-out).
func noDiversityMode() bool {
	return os.Getenv("FUSION_NO_DIVERSITY") == "1" || os.Getenv("FUSION_NO_DIVERSITY") == "true"
}
