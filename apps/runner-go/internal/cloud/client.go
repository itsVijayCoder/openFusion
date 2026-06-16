package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	BaseURL    string
	Token      string
	HTTPClient *http.Client
}

func NewClient(baseURL string, token string) Client {
	return Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Token:   token,
		HTTPClient: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

func (client Client) RegisterRunner(ctx context.Context, payload any) error {
	return client.post(ctx, "/api/runners/register", payload)
}

func (client Client) Heartbeat(ctx context.Context, runnerID string, payload any) error {
	return client.post(ctx, "/api/runners/"+runnerID+"/heartbeat", payload)
}

func (client Client) post(ctx context.Context, path string, payload any) error {
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

	resp, err := client.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("cloud request failed with status %s", resp.Status)
	}

	return nil
}
