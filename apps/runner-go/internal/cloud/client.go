package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	BaseURL    string
	Token      string
	HTTPClient *http.Client
}

type ClaimedJob struct {
	ID             string     `json:"id"`
	OrgID          string     `json:"orgId"`
	RunID          string     `json:"runId"`
	RunnerID       string     `json:"runnerId"`
	Kind           string     `json:"kind"`
	Status         string     `json:"status"`
	Attempt        int        `json:"attempt"`
	LeaseOwner     string     `json:"leaseOwner,omitempty"`
	LeaseExpiresAt string     `json:"leaseExpiresAt,omitempty"`
	Payload        JobPayload `json:"payload"`
}

type JobPayload struct {
	JobID             string         `json:"jobId"`
	RunID             string         `json:"runId"`
	Kind              string         `json:"kind"`
	ModelID           string         `json:"modelId,omitempty"`
	Adapter           string         `json:"adapter,omitempty"`
	Model             string         `json:"model,omitempty"`
	Role              string         `json:"role,omitempty"`
	Prompt            string         `json:"prompt,omitempty"`
	PromptObjectKey   string         `json:"promptObjectKey,omitempty"`
	WorkspaceID       string         `json:"workspaceId,omitempty"`
	WorkspacePath     string         `json:"workspacePath,omitempty"`
	PermissionProfile string         `json:"permissionProfile"`
	TimeoutMs         int            `json:"timeoutMs,omitempty"`
	Attempt           int            `json:"attempt"`
	Metadata          map[string]any `json:"metadata,omitempty"`
}

type RunnerEvent struct {
	Type      string         `json:"type"`
	RunID     string         `json:"runId"`
	JobID     string         `json:"jobId,omitempty"`
	RunnerID  string         `json:"runnerId,omitempty"`
	Timestamp string         `json:"timestamp"`
	Data      map[string]any `json:"data"`
}

type JobCompletion struct {
	Status       string         `json:"status"`
	OutputKey    string         `json:"outputObjectKey,omitempty"`
	OutputText   string         `json:"outputText,omitempty"`
	Error        string         `json:"error,omitempty"`
	LatencyMs    int64          `json:"latencyMs,omitempty"`
	Usage        map[string]any `json:"usage,omitempty"`
	ArtifactKeys []string       `json:"artifactKeys,omitempty"`
}

type JobState struct {
	Status    string      `json:"status"`
	RunStatus string      `json:"runStatus"`
	Job       *ClaimedJob `json:"job,omitempty"`
}

func NewClient(baseURL string, token string) Client {
	return Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Token:   token,
		HTTPClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (client Client) RegisterRunner(ctx context.Context, payload any) error {
	return client.post(ctx, "/api/runners/register", payload)
}

func (client Client) Heartbeat(ctx context.Context, runnerID string, payload any) error {
	return client.post(ctx, "/api/runners/"+runnerID+"/heartbeat", payload)
}

func (client Client) ClaimJob(ctx context.Context, runnerID string, leaseOwner string, leaseSeconds int) (*ClaimedJob, error) {
	var body struct {
		Job *ClaimedJob `json:"job"`
	}
	if err := client.postJSON(ctx, "/api/runners/"+runnerID+"/jobs/claim", map[string]any{
		"leaseOwner":   leaseOwner,
		"leaseSeconds": leaseSeconds,
	}, &body); err != nil {
		return nil, err
	}
	return body.Job, nil
}

func (client Client) ConnectURL(runnerID string) string {
	return client.BaseURL + "/api/runners/" + runnerID + "/connect"
}

func (client Client) GetJobState(ctx context.Context, runnerID string, jobID string) (JobState, error) {
	var body JobState
	if err := client.getJSON(ctx, "/api/runners/"+runnerID+"/jobs/"+jobID, &body); err != nil {
		return JobState{}, err
	}
	return body, nil
}

func (client Client) PostJobEvent(ctx context.Context, runnerID string, jobID string, event RunnerEvent) error {
	return client.post(ctx, "/api/runners/"+runnerID+"/jobs/"+jobID+"/events", event)
}

func (client Client) CompleteJob(ctx context.Context, runnerID string, jobID string, completion JobCompletion) error {
	if completion.Status == "" {
		completion.Status = "completed"
	}
	return client.post(ctx, "/api/runners/"+runnerID+"/jobs/"+jobID+"/complete", completion)
}

func (client Client) FailJob(ctx context.Context, runnerID string, jobID string, completion JobCompletion) error {
	if completion.Status == "" || completion.Status == "completed" {
		completion.Status = "failed"
	}
	return client.post(ctx, "/api/runners/"+runnerID+"/jobs/"+jobID+"/fail", completion)
}

func (client Client) post(ctx context.Context, path string, payload any) error {
	return client.postJSON(ctx, path, payload, nil)
}

func (client Client) getJSON(ctx context.Context, path string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, client.BaseURL+path, nil)
	if err != nil {
		return err
	}
	if client.Token != "" {
		req.Header.Set("authorization", "Bearer "+client.Token)
	}

	return client.doWithRetry(req, target)
}

func (client Client) postJSON(ctx context.Context, path string, payload any, target any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, client.BaseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	if client.Token != "" {
		req.Header.Set("authorization", "Bearer "+client.Token)
	}

	return client.doWithRetry(req, target)
}

func (client Client) doWithRetry(req *http.Request, target any) error {
	const maxAttempts = 3
	var lastErr error

	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			body := req.GetBody
			if body != nil {
				r, err := body()
				if err != nil {
					return err
				}
				req.Body = r
			}
			select {
			case <-req.Context().Done():
				return req.Context().Err()
			case <-time.After(backoff(attempt)):
			}
		}

		resp, err := client.HTTPClient.Do(req)
		if err != nil {
			lastErr = err
			if isRetryable(err) && attempt < maxAttempts-1 {
				continue
			}
			return err
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
			resp.Body.Close()
			if len(responseBody) > 0 {
				return fmt.Errorf("cloud request failed with status %s: %s", resp.Status, strings.TrimSpace(string(responseBody)))
			}
			return fmt.Errorf("cloud request failed with status %s", resp.Status)
		}

		if target != nil {
			if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
				resp.Body.Close()
				return err
			}
		}
		resp.Body.Close()
		return nil
	}

	return lastErr
}

func backoff(attempt int) time.Duration {
	switch attempt {
	case 1:
		return 500 * time.Millisecond
	case 2:
		return 2 * time.Second
	default:
		return 5 * time.Second
	}
}

func isRetryable(err error) bool {
	if err == nil {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return true
	}
	return true
}
