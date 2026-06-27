package cloud

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

type JobHandler func(ctx context.Context, job ClaimedJob) error

type cloudMessage struct {
	Type   string      `json:"type"`
	Job    *ClaimedJob `json:"job,omitempty"`
	JobID  string      `json:"jobId,omitempty"`
	Reason string      `json:"reason,omitempty"`
	Seq    int         `json:"seq,omitempty"`
}

type Stream struct {
	client    Client
	runnerID  string
	connected atomic.Bool
}

func NewStream(client Client, runnerID string) *Stream {
	return &Stream{client: client, runnerID: runnerID}
}

func (s *Stream) Connected() bool {
	return s.connected.Load()
}

func (s *Stream) Run(ctx context.Context, handler JobHandler) error {
	var attempt int
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		err := s.connectAndServe(ctx, handler)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "runner stream disconnected: %v\n", err)
		}

		attempt++
		delay := reconnectDelay(attempt)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}
}

func (s *Stream) connectAndServe(ctx context.Context, handler JobHandler) error {
	url := s.client.ConnectURL(s.runnerID)
	wsURL := toWebSocketURL(url)

	dialer := websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
	}
	header := http.Header{}
	if s.client.Token != "" {
		header.Set("authorization", "Bearer "+s.client.Token)
	}

	conn, resp, err := dialer.DialContext(ctx, wsURL, header)
	if err != nil {
		if resp != nil {
			resp.Body.Close()
		}
		s.connected.Store(false)
		return err
	}
	defer conn.Close()
	s.connected.Store(true)
	defer s.connected.Store(false)
	fmt.Fprintf(os.Stderr, "runner stream connected to %s\n", s.client.BaseURL)

	cancels := &sync.Map{}
	defer func() {
		cancels.Range(func(key, value any) bool {
			if cancel, ok := value.(context.CancelFunc); ok {
				cancel()
			}
			return true
		})
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return err
		}

		var msg cloudMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "job":
			if msg.Job == nil {
				continue
			}
			s.dispatchJob(ctx, handler, *msg.Job, cancels)
		case "cancel":
			if cancel, ok := cancels.LoadAndDelete(msg.JobID); ok {
				if fn, ok := cancel.(context.CancelFunc); ok {
					fn()
				}
			}
		}
	}
}

func (s *Stream) dispatchJob(ctx context.Context, handler JobHandler, job ClaimedJob, cancels *sync.Map) {
	jobCtx, cancel := context.WithCancel(ctx)
	cancels.Store(job.ID, context.CancelFunc(cancel))
	defer func() {
		cancels.Delete(job.ID)
		cancel()
	}()

	go func() {
		defer cancel()
		if err := handler(jobCtx, job); err != nil {
			fmt.Fprintf(os.Stderr, "job %s failed: %v\n", job.ID, err)
		}
	}()
}

func toWebSocketURL(url string) string {
	if strings.HasPrefix(url, "https://") {
		return "wss://" + strings.TrimPrefix(url, "https://")
	}
	if strings.HasPrefix(url, "http://") {
		return "ws://" + strings.TrimPrefix(url, "http://")
	}
	return url
}

func reconnectDelay(attempt int) time.Duration {
	switch {
	case attempt <= 1:
		return time.Second
	case attempt <= 5:
		return 5 * time.Second
	default:
		return 30 * time.Second
	}
}
