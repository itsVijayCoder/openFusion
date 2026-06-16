package audit

import "time"

type Event struct {
	Type      string         `json:"type"`
	Severity  string         `json:"severity"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt string         `json:"created_at"`
}

func NewEvent(eventType string, severity string, metadata map[string]any) Event {
	if severity == "" {
		severity = "info"
	}
	return Event{
		Type:      eventType,
		Severity:  severity,
		Metadata:  metadata,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
}
