package localui

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/asthrix/openfusion/apps/runner-go/internal/config"
	"github.com/asthrix/openfusion/apps/runner-go/internal/discovery"
	"github.com/asthrix/openfusion/apps/runner-go/internal/fusion"
	"github.com/asthrix/openfusion/apps/runner-go/internal/localagents"
	"github.com/asthrix/openfusion/apps/runner-go/internal/terminal"
	"github.com/gorilla/websocket"
)

type Options struct {
	Address           string
	WorkspacePath     string
	PermissionProfile string
	Timeout           time.Duration
	Config            config.Config
	SessionManager    *terminal.SessionManager
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func Serve(ctx context.Context, options Options) error {
	if options.Address == "" {
		options.Address = "127.0.0.1:7457"
	}
	if options.PermissionProfile == "" {
		options.PermissionProfile = options.Config.DefaultProfile
	}
	if options.PermissionProfile == "" {
		options.PermissionProfile = config.DefaultProfile
	}
	if options.Timeout <= 0 {
		options.Timeout = 10 * time.Minute
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(indexHTML))
	})
	mux.HandleFunc("GET /api/models", func(w http.ResponseWriter, r *http.Request) {
		models := localagents.ListModels(r.Context(), options.Config.AllowedRoots, options.Config.ToolDirs)
		tools := localagents.DetectAll(r.Context(), options.Config.ToolDirs)
		writeJSON(w, map[string]any{
			"data":       models,
			"tools":      tools,
			"workspace":  options.WorkspacePath,
			"permission": options.PermissionProfile,
		})
	})
	mux.HandleFunc("POST /api/fuse", func(w http.ResponseWriter, r *http.Request) {
		var req fusion.Request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if strings.TrimSpace(req.WorkspacePath) == "" {
			req.WorkspacePath = options.WorkspacePath
		}
		if strings.TrimSpace(req.PermissionProfile) == "" {
			req.PermissionProfile = options.PermissionProfile
		}
		if req.TimeoutMs <= 0 {
			req.TimeoutMs = int(options.Timeout.Milliseconds())
		}
		req.AllowedRoots = options.Config.AllowedRoots
		req.ToolDirs = options.Config.ToolDirs
		req.SessionManager = options.SessionManager
		result, err := fusion.Execute(r.Context(), req)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, result)
	})

	if options.SessionManager != nil {
		mux.HandleFunc("GET /api/sessions/{id}/stream", func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("id")
			session, ok := options.SessionManager.Get(id)
			if !ok {
				writeError(w, http.StatusNotFound, fmt.Errorf("session not found"))
				return
			}
			conn, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer conn.Close()

			scrollback := session.Scrollback()
			if len(scrollback) > 0 {
				_ = conn.WriteMessage(websocket.BinaryMessage, scrollback)
			}

			ch := session.Subscribe()
			defer session.Unsubscribe(ch)

			for {
				chunk, ok := <-ch
				if !ok {
					return
				}
				if err := conn.WriteMessage(websocket.BinaryMessage, chunk); err != nil {
					return
				}
			}
		})

		mux.HandleFunc("POST /api/sessions/{id}/input", func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("id")
			session, ok := options.SessionManager.Get(id)
			if !ok {
				writeError(w, http.StatusNotFound, fmt.Errorf("session not found"))
				return
			}
			var body struct {
				Input string `json:"input"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			if len(body.Input) > 4096 {
				writeError(w, http.StatusBadRequest, fmt.Errorf("input too long"))
				return
			}
			if err := session.Send(body.Input); err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, map[string]any{"ok": true})
		})

		mux.HandleFunc("POST /api/sessions/{id}/resize", func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("id")
			session, ok := options.SessionManager.Get(id)
			if !ok {
				writeError(w, http.StatusNotFound, fmt.Errorf("session not found"))
				return
			}
			var body struct {
				Rows int `json:"rows"`
				Cols int `json:"cols"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			if err := session.Resize(body.Rows, body.Cols); err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, map[string]any{"ok": true})
		})

		mux.HandleFunc("GET /api/sessions", func(w http.ResponseWriter, r *http.Request) {
			sessions := options.SessionManager.List()
			type sessionInfo struct {
				ID        string `json:"id"`
				AdapterID string `json:"adapterId"`
				ModelID   string `json:"modelId"`
				State     string `json:"state"`
			}
			out := make([]sessionInfo, 0, len(sessions))
			for _, s := range sessions {
				out = append(out, sessionInfo{
					ID:        s.ID,
					AdapterID: s.AdapterID,
					ModelID:   s.ModelID,
					State:     s.State().String(),
				})
			}
			writeJSON(w, map[string]any{"sessions": out})
		})
	}

	server := &http.Server{
		Addr:              options.Address,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	log.Printf("openFusion local UI listening on http://%s", options.Address)
	err := server.ListenAndServe()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		log.Printf("failed to write response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, err error) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
}

func DetectionSummary(ctx context.Context, cfg config.Config) discovery.Report {
	models := make([]any, 0)
	for _, model := range localagents.ListModels(ctx, cfg.AllowedRoots, cfg.ToolDirs) {
		models = append(models, model)
	}
	return discovery.Report{
		RunnerID: cfg.RunnerID,
		Tools:    localagents.DetectAll(ctx, cfg.ToolDirs),
		Models:   models,
	}
}

const indexHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>openFusion</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #fafafa;
      --panel: #ffffff;
      --surface: #f4f4f5;
      --surface-2: #e4e4e7;
      --line: rgba(0,0,0,.10);
      --line-strong: rgba(0,0,0,.16);
      --text: #18181b;
      --muted: #71717a;
      --soft: #a1a1aa;
      --accent: #0891b2;
      --accent-2: #059669;
      --danger: #dc2626;
      --rail-bg: #f4f4f5;
      --pill-active-bg: #18181b;
      --pill-active-fg: #fafafa;
      --chip-bg: rgba(0,0,0,.05);
      --chip-fg: #3f3f46;
      --hover-bg: rgba(0,0,0,.06);
      --input-bg: #ffffff;
      --shadow: 0 20px 60px rgba(0,0,0,.10);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #050607;
        --panel: #0b0c0e;
        --surface: #111214;
        --surface-2: #151618;
        --line: rgba(255,255,255,.11);
        --line-strong: rgba(255,255,255,.17);
        --text: #f4f4f5;
        --muted: #71717a;
        --soft: #a1a1aa;
        --accent: #67e8f9;
        --accent-2: #34d399;
        --danger: #fca5a5;
        --rail-bg: #08090b;
        --pill-active-bg: #f4f4f5;
        --pill-active-fg: #09090b;
        --chip-bg: rgba(255,255,255,.06);
        --chip-fg: #d4d4d8;
        --hover-bg: rgba(255,255,255,.08);
        --input-bg: #090a0c;
        --shadow: 0 20px 60px rgba(0,0,0,.36);
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    button, input, select, textarea { font: inherit; }
    .app { min-height: 100vh; display: grid; grid-template-columns: 260px minmax(0, 1fr); }
    .rail { border-right: 1px solid var(--line); background: var(--rail-bg); display: flex; flex-direction: column; min-height: 100vh; }
    .brand { height: 56px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); padding: 0 20px; font-size: 14px; font-weight: 700; }
    .mark { width: 26px; height: 26px; display: grid; place-items: center; background: var(--pill-active-bg); color: var(--pill-active-fg); border-radius: 6px; font-weight: 800; }
    .rail-main { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .rail-button { height: 36px; border: 0; border-radius: 6px; background: var(--chip-bg); color: var(--text); text-align: left; padding: 0 12px; font-weight: 650; cursor: pointer; }
    .rail-button:hover { background: var(--hover-bg); }
    .rail-footer { margin-top: auto; border-top: 1px solid var(--line); padding: 14px 16px; color: var(--muted); font-size: 12px; line-height: 1.6; }
    .main { min-width: 0; display: flex; flex-direction: column; min-height: 100vh; }
    .top { height: 56px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: flex-end; padding: 0 20px; }
    .top nav { display: flex; gap: 22px; color: var(--muted); font-size: 14px; font-weight: 700; }
    .top span:first-child { color: var(--text); }
    .stage { flex: 1; display: grid; place-items: center; padding: 44px 16px; }
    .wrap { width: min(920px, 100%); }
    .headline { text-align: center; margin-bottom: 28px; }
    .headline h1 { margin: 0; font-size: 32px; line-height: 1.15; letter-spacing: 0; }
    .headline p { margin: 12px 0 0; color: var(--muted); font-size: 14px; font-weight: 600; }
    .composer { border: 1px solid var(--line-strong); background: var(--surface); border-radius: 8px; overflow: hidden; box-shadow: var(--shadow); }
    .toolbar { display: grid; gap: 14px; padding: 14px; }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pill { height: 32px; border-radius: 999px; border: 0; background: var(--chip-bg); color: var(--muted); padding: 0 12px; font-size: 12px; font-weight: 750; cursor: pointer; }
    .pill.active { background: var(--pill-active-bg); color: var(--pill-active-fg); }
    .chip { display: inline-flex; height: 32px; align-items: center; gap: 8px; border: 1px solid var(--line-strong); background: var(--chip-bg); border-radius: 6px; padding: 0 10px; color: var(--chip-fg); font-size: 12px; font-weight: 750; }
    .chip button { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 0; }
    .ghost { height: 32px; border: 1px dashed var(--line-strong); background: transparent; color: var(--soft); border-radius: 6px; padding: 0 12px; font-size: 12px; font-weight: 750; cursor: pointer; }
    .ghost:hover { border-color: var(--soft); color: var(--text); }
    .micro-label { color: var(--muted); font-size: 12px; font-weight: 750; }
    textarea { display: block; width: 100%; min-height: 170px; resize: vertical; border: 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--surface-2); color: var(--text); padding: 22px 24px; outline: none; line-height: 1.55; }
    textarea::placeholder { color: var(--muted); }
    .bottom { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; }
    .iconbar { display: flex; gap: 6px; color: var(--muted); }
    .iconbar button, .send { width: 34px; height: 34px; border-radius: 6px; border: 0; display: grid; place-items: center; cursor: pointer; }
    .iconbar button { background: transparent; color: inherit; }
    .iconbar button:hover { background: var(--hover-bg); color: var(--text); }
    .send { background: var(--accent); color: white; font-size: 18px; }
    .send:disabled { opacity: .45; cursor: not-allowed; }
    .options { margin-top: 12px; display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(0, 1fr)); color: var(--muted); font-size: 12px; }
    .field { border: 1px solid var(--line); background: var(--chip-bg); border-radius: 6px; padding: 8px 10px; min-width: 0; }
    .field label { display: block; color: var(--soft); font-weight: 750; margin-bottom: 6px; }
    .field input, .field select { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--muted); }
    .output { margin-top: 18px; display: none; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 14px; }
    .output.visible { display: grid; }
    .panel { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; overflow: hidden; }
    .panel h2 { margin: 0; padding: 12px 14px; border-bottom: 1px solid var(--line); font-size: 13px; }
    .panel pre { margin: 0; padding: 14px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text); font-size: 13px; line-height: 1.55; max-height: 460px; overflow: auto; }
    .trace-item { border-bottom: 1px solid var(--line); padding: 12px 14px; }
    .trace-item:last-child { border-bottom: 0; }
    .trace-title { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 750; }
    .trace-meta { margin-top: 4px; color: var(--muted); font-size: 12px; }
    .trace-error { margin-top: 6px; color: var(--danger); font-size: 12px; }
    .trace-status { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
    .trace-status.queued { background: var(--chip-bg); color: var(--muted); }
    .trace-status.running { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
    .trace-status.completed { background: color-mix(in srgb, var(--accent-2) 15%, transparent); color: var(--accent-2); }
    .trace-status.failed { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
    .trace-spinner { display: inline-block; width: 10px; height: 10px; border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .trace-retry { margin-top: 6px; height: 26px; border: 1px solid var(--line-strong); background: var(--chip-bg); color: var(--soft); border-radius: 6px; padding: 0 10px; font-size: 11px; font-weight: 700; cursor: pointer; }
    .trace-retry:hover { background: var(--hover-bg); color: var(--text); }
    .analysis-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); font-size: 12px; color: var(--muted); flex-wrap: wrap; }
    .analysis-bar .label { font-weight: 750; color: var(--soft); }
    .confidence-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800; padding: 3px 10px; border-radius: 999px; }
    .confidence-badge.high { background: color-mix(in srgb, var(--accent-2) 15%, transparent); color: var(--accent-2); }
    .confidence-badge.medium { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
    .confidence-badge.low { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
    .analysis-meta { color: var(--muted); }
    .synthesis-analysis { border-bottom: 1px solid var(--line); padding: 12px 14px; }
    .synthesis-analysis summary { cursor: pointer; font-size: 12px; font-weight: 750; color: var(--soft); list-style: none; }
    .synthesis-analysis summary::-webkit-details-marker { display: none; }
    .synthesis-analysis summary::before { content: '▸ '; }
    .synthesis-analysis[open] summary::before { content: '▾ '; }
    .synthesis-analysis pre { margin: 8px 0 0; padding: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); font-size: 12px; line-height: 1.5; }
    .verify-bar { border-bottom: 1px solid var(--line); padding: 10px 14px; font-size: 12px; color: var(--muted); }
    .verify-bar .label { font-weight: 750; color: var(--soft); }
    .verify-bar .ok { color: var(--accent-2); font-weight: 700; }
    .verify-bar .warn { color: var(--danger); font-weight: 700; }
    .verify-bar ul { margin: 6px 0 0; padding-left: 18px; }
    .verify-bar li { color: var(--muted); }
    .modal { position: fixed; inset: 0; display: none; place-items: center; padding: 18px; background: color-mix(in srgb, var(--bg) 76%, transparent); z-index: 20; }
    .modal.visible { display: grid; }
    .picker { width: min(920px, 100%); max-height: min(620px, calc(100vh - 36px)); display: grid; grid-template-columns: minmax(0, 1fr) 280px; border: 1px solid var(--line-strong); background: var(--panel); border-radius: 8px; overflow: hidden; }
    .picker-main { min-width: 0; display: flex; flex-direction: column; }
    .picker-head { padding: 12px; border-bottom: 1px solid var(--line); display: flex; gap: 10px; }
    .picker-head input { flex: 1; height: 38px; border: 1px solid var(--line-strong); background: var(--input-bg); color: var(--text); border-radius: 6px; padding: 0 12px; outline: none; }
    .picker-head button { width: 38px; border: 0; border-radius: 6px; background: var(--chip-bg); color: var(--soft); cursor: pointer; }
    .models { overflow: auto; min-height: 260px; }
    .model-option { width: 100%; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: inherit; text-align: left; display: flex; gap: 12px; align-items: center; padding: 12px 14px; cursor: pointer; }
    .model-option:hover, .model-option.selected { background: var(--hover-bg); }
    .badge { width: 28px; height: 28px; border-radius: 6px; background: var(--pill-active-bg); color: var(--pill-active-fg); display: grid; place-items: center; font-size: 12px; font-weight: 900; flex: 0 0 auto; }
    .model-copy { min-width: 0; flex: 1; }
    .model-name, .model-sub { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .model-name { font-size: 13px; font-weight: 800; color: var(--text); }
    .model-sub { color: var(--muted); font-size: 12px; margin-top: 3px; }
    .custom { padding: 12px; border-top: 1px solid var(--line); display: grid; grid-template-columns: 130px minmax(0, 1fr) auto; gap: 8px; }
    .custom input, .custom select, .custom button { height: 36px; border-radius: 6px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--soft); padding: 0 10px; }
    .custom button { cursor: pointer; font-weight: 750; }
    .picker-side { border-left: 1px solid var(--line); background: var(--surface); padding: 16px; color: var(--muted); font-size: 13px; line-height: 1.6; }
    .error { color: var(--danger); font-size: 12px; max-width: 420px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* ── Terminal Grid ── */
    .term-section { margin-top: 22px; display: none; }
    .term-section.visible { display: block; animation: fadeUp .35s ease; }
    .term-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .term-section-head h2 { margin: 0; font-size: 15px; font-weight: 800; letter-spacing: -.01em; }
    .term-section-meta { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 12px; font-weight: 600; }
    .term-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 14px; }
    .term-card { border: 1px solid var(--line); background: var(--panel); border-radius: 10px; overflow: hidden; transition: border-color .2s, box-shadow .2s; display: flex; flex-direction: column; }
    .term-card:hover { border-color: var(--line-strong); box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    .term-card.running { border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); }
    .term-card.running .term-card-head { background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, var(--surface)), var(--surface)); }
    .term-card.completed { border-color: color-mix(in srgb, var(--accent-2) 30%, var(--line)); }
    .term-card.failed { border-color: color-mix(in srgb, var(--danger) 30%, var(--line)); }
    .term-card-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--surface); transition: background .2s; }
    .term-badge { width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center; font-size: 11px; font-weight: 900; color: #fff; flex-shrink: 0; background: #6366f1; }
    .term-badge.opencode { background: #0891b2; }
    .term-badge.codex { background: #059669; }
    .term-badge.claude { background: #d97706; }
    .term-badge.gemini { background: #4285f4; }
    .term-badge.pi { background: #8b5cf6; }
    .term-badge.aider { background: #dc2626; }
    .term-badge.copilot { background: #6366f1; }
    .term-badge.deepseek { background: #1e40af; }
    .term-badge.kimi { background: #7c3aed; }
    .term-badge.grok-build { background: #18181b; }
    .term-badge.cursor-agent { background: #0ea5e9; }
    .term-badge.qwen { background: #6d28d9; }
    .term-badge.qoder { background: #db2777; }
    .term-badge.amp { background: #16a34a; }
    .term-badge.kiro { background: #0d9488; }
    .term-badge.kilo { background: #b45309; }
    .term-badge.vibe { background: #f97316; }
    .term-badge.trae-cli { background: #2563eb; }
    .term-badge.codebuddy { background: #9333ea; }
    .term-badge.reasonix { background: #1e3a8a; }
    .term-badge.antigravity { background: #be185d; }
    .term-badge.hermes { background: #c026d3; }
    .term-badge.devin { background: #4f46e5; }
    .term-info { flex: 1; min-width: 0; }
    .term-model { font-size: 13px; font-weight: 750; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .term-adapter { font-size: 11px; color: var(--muted); font-weight: 600; margin-top: 1px; }
    .term-status { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 800; padding: 3px 9px; border-radius: 999px; text-transform: uppercase; letter-spacing: .03em; flex-shrink: 0; }
    .term-status.running { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
    .term-status.completed { background: color-mix(in srgb, var(--accent-2) 15%, transparent); color: var(--accent-2); }
    .term-status.failed { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
    .term-status.cancelled { background: var(--chip-bg); color: var(--muted); }
    .term-status.extracting { background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--accent); }
    .term-pulse { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .4; transform: scale(.7); } }
    .term-body { background: #0c0c0f; position: relative; min-height: 180px; transition: height .3s ease; }
    .term-body.expanded { min-height: 420px; }
    .term-body .xterm { padding: 8px 10px; }
    .term-body .xterm-viewport { background: transparent !important; }
    .term-shimmer { position: absolute; inset: 0; display: grid; place-items: center; color: #52525b; font-size: 12px; font-weight: 600; gap: 8px; }
    .term-shimmer .dots { display: flex; gap: 4px; }
    .term-shimmer .dots span { width: 6px; height: 6px; border-radius: 50%; background: #3f3f46; animation: bounce 1.4s ease-in-out infinite; }
    .term-shimmer .dots span:nth-child(2) { animation-delay: .2s; }
    .term-shimmer .dots span:nth-child(3) { animation-delay: .4s; }
    @keyframes bounce { 0%, 80%, 100% { transform: scale(.6); opacity: .4; } 40% { transform: scale(1); opacity: 1; } }
    .term-foot { display: flex; align-items: center; justify-content: space-between; padding: 7px 14px; border-top: 1px solid var(--line); background: var(--surface); font-size: 11px; color: var(--muted); font-weight: 600; }
    .term-foot-left { display: flex; gap: 10px; align-items: center; }
    .term-conf { font-weight: 700; }
    .term-conf.high { color: var(--accent-2); }
    .term-conf.medium { color: var(--accent); }
    .term-conf.low { color: var(--danger); }
    .term-expand { border: 0; background: transparent; color: var(--soft); cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 4px; transition: background .15s, color .15s; }
    .term-expand:hover { background: var(--hover-bg); color: var(--text); }
    .term-empty { text-align: center; padding: 40px 20px; color: var(--soft); font-size: 13px; font-weight: 600; border: 1px dashed var(--line-strong); border-radius: 10px; }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .term-card { animation: fadeUp .3s ease; }

    @media (max-width: 900px) {
      .app { grid-template-columns: 1fr; }
      .rail { display: none; }
      .stage { padding-top: 28px; }
      .options, .output { grid-template-columns: 1fr; }
      .picker { grid-template-columns: 1fr; }
      .picker-side { display: none; }
      .term-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="rail">
      <div class="brand"><span class="mark">F</span><span>openFusion</span></div>
      <div class="rail-main"><button class="rail-button" onclick="location.reload()">New Fusion</button></div>
      <div class="rail-footer"><div id="agentCount">Detecting local agents...</div><div>Go runner · local CLI sessions</div></div>
    </aside>
    <main class="main">
      <header class="top"><nav><span>Fusion</span><span>Models</span><span>Agents</span><span>Runs</span></nav></header>
      <section class="stage">
        <div class="wrap">
          <div class="headline">
            <h1>Local Agent Fusion</h1>
            <p>Prompt → native panel runs → judge / synthesis → final output.</p>
          </div>
          <div class="composer">
            <div class="toolbar">
              <div class="row" id="modes"></div>
              <div class="row" id="chips"></div>
              <div class="row">
                <span class="micro-label">Judge / synthesis</span><button class="ghost" id="judgeButton"></button>
              </div>
            </div>
            <textarea id="prompt" placeholder="Ask anything..."></textarea>
            <div class="bottom">
              <div class="iconbar"><button title="Web">⌘</button><button title="Attach">＋</button><button title="Tools">✦</button></div>
              <div class="row"><span id="error" class="error"></span><button class="send" id="runButton" title="Run Fusion">↑</button></div>
            </div>
          </div>
          <div class="options">
            <div class="field"><label>Workspace</label><input id="workspace" placeholder="/path/to/workspace" /></div>
            <div class="field"><label>Permission</label><select id="permission"><option>readonly</option><option>workspace_write</option><option>trusted_internal</option></select></div>
            <div class="field"><label>Selected</label><span id="selectedSummary">0 analysis · auto judge</span></div>
          </div>
          <div id="output" class="output">
            <div class="panel"><h2>Trace</h2><div id="trace"></div></div>
            <div class="panel"><h2>Final Output</h2><pre id="finalAnswer"></pre></div>
          </div>
          <div id="termSection" class="term-section">
            <div class="term-section-head">
              <h2>Live Terminals</h2>
              <div class="term-section-meta"><span id="termCount">0 sessions</span></div>
            </div>
            <div id="termGrid" class="term-grid"></div>
            <div id="termEmpty" class="term-empty">No active terminal sessions. Run a fusion to see live PTY terminals.</div>
          </div>
        </div>
      </section>
    </main>
  </div>
  <div id="modal" class="modal">
    <div class="picker">
      <div class="picker-main">
        <div class="picker-head"><input id="modelSearch" placeholder="Search models" /><button id="closePicker">×</button></div>
        <div id="modelsList" class="models"></div>
        <div class="custom"><select id="customAdapter"><option value="opencode">OpenCode</option><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="gemini">Gemini</option><option value="pi">Pi</option><option value="aider">Aider</option><option value="copilot">Copilot</option><option value="deepseek">DeepSeek</option><option value="kimi">Kimi</option><option value="qwen">Qwen</option><option value="qoder">Qoder</option><option value="grok-build">Grok</option><option value="cursor-agent">Cursor</option><option value="amp">Amp</option><option value="hermes">Hermes</option><option value="devin">Devin</option><option value="kiro">Kiro</option><option value="kilo">Kilo</option><option value="vibe">Vibe</option><option value="trae-cli">Trae</option><option value="codebuddy">Codebuddy</option><option value="reasonix">Reasonix</option><option value="antigravity">Antigravity</option></select><input id="customModel" placeholder="model-id" /><button id="addCustom">Add</button></div>
      </div>
      <aside class="picker-side"><strong id="pickerTitle">Panel models</strong><p id="pickerHelp">Choose the analysis models that should answer independently.</p><p>Use OpenCode for provider-qualified IDs and Codex for Codex CLI model IDs. Custom IDs are sent as process arguments, not shell strings.</p></aside>
    </div>
  </div>
  <script>
    const state = { models: [], tools: [], mode: 'required', analysis: [], judge: '', target: 'analysis', custom: [] };
    const modes = ['auto', 'required', 'direct'];
    const adapterLabels = { opencode: 'OpenCode', codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini', pi: 'Pi', aider: 'Aider', 'cursor-agent': 'Cursor', qwen: 'Qwen', qoder: 'Qoder', copilot: 'Copilot', deepseek: 'DeepSeek', kimi: 'Kimi', hermes: 'Hermes', devin: 'Devin', 'grok-build': 'Grok', amp: 'Amp', kiro: 'Kiro', kilo: 'Kilo', vibe: 'Vibe', 'trae-cli': 'Trae', codebuddy: 'Codebuddy', reasonix: 'Reasonix', antigravity: 'Antigravity' };
    const $ = (id) => document.getElementById(id);
    const short = (m) => (m.displayName || m.model || m.id || '').split('/').pop();
    const validCustom = (value) => /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/.test(value.trim());
    function allModels() {
      const map = new Map();
      [...state.models, ...state.custom].forEach((model) => map.set(model.id, model));
      return [...map.values()].sort((a, b) => (a.adapter || '').localeCompare(b.adapter || '') || (a.model || '').localeCompare(b.model || ''));
    }
    function byId(id) { return allModels().find((m) => m.id === id); }
    function defaultPick() {
      const available = allModels().filter((m) => m.availability !== 'unavailable');
      state.analysis = available.slice(0, Math.min(3, available.length)).map((m) => m.id);
      state.judge = (available[0] || {}).id || '';
    }
    function render() {
      $('modes').innerHTML = modes.map((mode) => '<button class="pill ' + (state.mode === mode ? 'active' : '') + '" data-mode="' + mode + '">' + mode + '</button>').join('');
      $('modes').querySelectorAll('button').forEach((button) => button.onclick = () => { state.mode = button.dataset.mode; render(); });
      $('chips').innerHTML = state.analysis.map((id) => {
        const model = byId(id);
        return model ? '<span class="chip">' + short(model) + '<button data-remove="' + id + '">×</button></span>' : '';
      }).join('') + '<button class="ghost" id="addModel">+ Add Model</button>';
      $('chips').querySelectorAll('[data-remove]').forEach((button) => button.onclick = () => { if (state.analysis.length > 1) state.analysis = state.analysis.filter((id) => id !== button.dataset.remove); render(); });
      $('addModel').onclick = () => openPicker('analysis');
      const judge = byId(state.judge);
      $('judgeButton').textContent = judge ? short(judge) : 'Auto';
      $('judgeButton').onclick = () => openPicker('judge');
      $('selectedSummary').textContent = state.analysis.length + ' analysis · ' + (judge ? short(judge) : 'auto') + ' judge';
    }
    function openPicker(target) {
      state.target = target;
      $('pickerTitle').textContent = target === 'analysis' ? 'Panel models' : 'Judge / synthesis model';
      $('pickerHelp').textContent = target === 'analysis' ? 'Choose the models that answer independently.' : 'Choose one model to compare panel outputs and write the final output.';
      $('modal').classList.add('visible');
      $('modelSearch').value = '';
      renderPicker();
      $('modelSearch').focus();
    }
    function closePicker() { $('modal').classList.remove('visible'); }
    function selectedIds() { return state.target === 'analysis' ? state.analysis : [state.judge].filter(Boolean); }
    function renderPicker() {
      const q = $('modelSearch').value.trim().toLowerCase();
      const selected = new Set(selectedIds());
      $('modelsList').innerHTML = allModels().filter((m) => ((m.displayName || '') + ' ' + m.model + ' ' + m.adapter + ' ' + (m.provider || '')).toLowerCase().includes(q)).map((m) => {
        const label = adapterLabels[m.adapter] || m.adapter;
        const initial = (m.adapter || '?')[0].toUpperCase();
        return '<button class="model-option ' + (selected.has(m.id) ? 'selected' : '') + '" data-model="' + m.id + '"><span class="badge term-badge ' + m.adapter + '">' + initial + '</span><span class="model-copy"><span class="model-name">' + (m.displayName || m.model) + '</span><span class="model-sub">' + label + ' · ' + (m.provider || 'local') + ' · ' + (m.availability || '').replaceAll('_', ' ') + '</span></span></button>';
      }).join('');
      $('modelsList').querySelectorAll('[data-model]').forEach((button) => button.onclick = () => selectModel(button.dataset.model));
    }
    function selectModel(id) {
      if (state.target === 'analysis') {
        if (state.analysis.includes(id)) {
          if (state.analysis.length > 1) state.analysis = state.analysis.filter((item) => item !== id);
        } else {
          state.analysis = [...state.analysis, id].slice(0, 6);
        }
        renderPicker();
      } else if (state.target === 'judge') {
        state.judge = id; closePicker();
      }
      render();
    }
    async function loadModels() {
      const response = await fetch('/api/models');
      const body = await response.json();
      state.models = body.data || [];
      state.tools = body.tools || [];
      $('workspace').value = body.workspace || '';
      $('permission').value = body.permission || 'readonly';
      const found = state.tools.filter((tool) => tool.found || tool.Found).length;
      $('agentCount').textContent = found + ' local tools detected · ' + state.models.length + ' models';
      defaultPick();
      render();
    }
    async function runFusion() {
      $('error').textContent = '';
      $('runButton').disabled = true;
      $('runButton').textContent = '…';
      $('output').classList.add('visible');
      $('termSection').classList.add('visible');
      $('termEmpty').style.display = 'block';
      $('termGrid').innerHTML = '';
      Object.keys(terminals).forEach(function(id) { if (terminals[id].ws) terminals[id].ws.close(); delete terminals[id]; });
      $('trace').innerHTML = '<div class="trace-item"><div class="trace-title"><span>Running fusion pipeline</span><span class="trace-status running"><span class="trace-spinner"></span>running</span></div><div class="trace-meta">Panel calls run first, then one judge / synthesis call writes the final output.</div></div>';
      $('finalAnswer').textContent = '';
      try {
        const response = await fetch('/api/fuse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          prompt: $('prompt').value,
          workspacePath: $('workspace').value,
          mode: state.mode,
          permissionProfile: $('permission').value,
          analysisModels: state.analysis,
          judgeModel: state.judge
        })});
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Fusion request failed');
        renderResult(body);
      } catch (err) {
        $('error').textContent = err.message || String(err);
        $('trace').innerHTML = '<div class="trace-item"><div class="trace-title"><span>Fusion failed</span><span>failed</span></div><div class="trace-error">' + ($('error').textContent) + '</div></div>';
      } finally {
        $('runButton').disabled = false;
        $('runButton').textContent = '↑';
      }
    }
    function traceItem(output) {
      if (!output) return '';
      let roleLabel = output.role || '';
      const knownLenses = ['correctness','performance','security','maintainability','pragmatism'];
      if (knownLenses.includes(roleLabel)) roleLabel = 'lens: ' + roleLabel;
      const statusClass = output.status || 'queued';
      const spinner = statusClass === 'running' ? '<span class="trace-spinner"></span>' : '';
      return '<div class="trace-item"><div class="trace-title"><span>' + roleLabel + ' · ' + output.modelId + '</span><span class="trace-status ' + statusClass + '">' + spinner + output.status + '</span></div><div class="trace-meta">' + output.adapter + ' · ' + (output.latencyMs || 0) + 'ms</div>' + (output.error ? '<div class="trace-error">' + output.error + '</div>' : '') + '</div>';
    }
    function confidenceBadge(confidence) {
      const label = confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'medium' : 'low';
      return '<span class="confidence-badge ' + label + '">confidence ' + label + ' · ' + (confidence * 100).toFixed(0) + '%</span>';
    }
    function analysisBar(analysis) {
      if (!analysis) return '';
      const parts = ['<div class="analysis-bar"><span class="label">Pre-analysis</span>', confidenceBadge(analysis.confidence || 0)];
      parts.push('<span class="analysis-meta">agreement ' + ((analysis.agreementScore || 0) * 100).toFixed(0) + '%</span>');
      if (analysis.contradictions && analysis.contradictions.length) {
        parts.push('<span class="analysis-meta">' + analysis.contradictions.length + ' contradiction(s)</span>');
      }
      if (analysis.uniqueInsights && analysis.uniqueInsights.length) {
        parts.push('<span class="analysis-meta">' + analysis.uniqueInsights.length + ' unique insight(s)</span>');
      }
      parts.push('</div>');
      return parts.join('');
    }
    function synthesisAnalysisBlock(text) {
      if (!text) return '';
      return '<details class="synthesis-analysis"><summary>Synthesis analysis (Phase A)</summary><pre>' + text.replace(/</g, '&lt;') + '</pre></details>';
    }
    function verifyBar(verification) {
      if (!verification) return '';
      const parts = ['<div class="verify-bar"><span class="label">Verification</span> '];
      if (verification.fullyCovered) {
        parts.push('<span class="ok">fully covered</span>');
      } else {
        parts.push('<span class="warn">gaps found' + (verification.refined ? ' · refined' : '') + '</span>');
        parts.push('<ul>');
        (verification.gaps || []).forEach((g) => parts.push('<li>Gap: ' + g + '</li>'));
        (verification.unresolvedContradictions || []).forEach((c) => parts.push('<li>Unresolved: ' + c + '</li>'));
        parts.push('</ul>');
      }
      parts.push('</div>');
      return parts.join('');
    }
    function renderResult(result) {
      $('trace').innerHTML = analysisBar(result.analysis) + verifyBar(result.verification) + synthesisAnalysisBlock(result.synthesisAnalysis) + [...(result.panel || []), result.judge].map(traceItem).join('');
      $('finalAnswer').textContent = result.finalAnswer || result.error || 'No final answer returned.';
    }
    $('closePicker').onclick = closePicker;
    $('modal').onclick = (event) => { if (event.target === $('modal')) closePicker(); };
    $('modelSearch').oninput = renderPicker;
    $('addCustom').onclick = () => {
      const adapter = $('customAdapter').value;
      const model = $('customModel').value.trim();
      if (!validCustom(model)) { $('error').textContent = 'Invalid custom model ID'; return; }
      const item = { id: adapter + '/' + model, adapter, provider: model.includes('/') ? model.split('/')[0] : adapter, model, displayName: model, authMode: 'cli_session', availability: 'configured_unverified', source: 'custom', capabilities: { streaming: true, tools: true, fileEdits: true, shell: true, jsonOutput: true, modelListing: false } };
      state.custom = [...state.custom.filter((m) => m.id !== item.id), item];
      $('customModel').value = '';
      selectModel(item.id);
    };
    $('runButton').onclick = runFusion;
    $('prompt').addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') runFusion(); });

    /* ── Live Terminal Cards ── */
    const terminals = {};
    const adapterColors = { opencode: '#0891b2', codex: '#059669', claude: '#d97706', gemini: '#4285f4', pi: '#8b5cf6', aider: '#dc2626', copilot: '#6366f1', deepseek: '#1e40af', kimi: '#7c3aed', 'grok-build': '#18181b', 'cursor-agent': '#0ea5e9', qwen: '#6d28d9', qoder: '#db2777', amp: '#16a34a', kiro: '#0d9488', kilo: '#b45309', vibe: '#f97316', 'trae-cli': '#2563eb', codebuddy: '#9333ea', reasonix: '#1e3a8a', antigravity: '#be185d', hermes: '#c026d3', devin: '#4f46e5' };

    function createTerminalCard(session) {
      const id = session.id;
      if (terminals[id]) return terminals[id];

      const adapter = session.adapterId || 'agent';
      const model = session.modelId || 'model';
      const label = adapterLabels[adapter] || adapter;
      const initial = adapter[0].toUpperCase();

      const card = document.createElement('div');
      card.className = 'term-card running';
      card.dataset.sessionId = id;

      card.innerHTML =
        '<div class="term-card-head">' +
          '<div class="term-badge ' + adapter + '">' + initial + '</div>' +
          '<div class="term-info">' +
            '<div class="term-model">' + model + '</div>' +
            '<div class="term-adapter">' + label + '</div>' +
          '</div>' +
          '<span class="term-status running"><span class="term-pulse"></span>Running</span>' +
        '</div>' +
        '<div class="term-body">' +
          '<div class="term-shimmer"><div class="dots"><span></span><span></span><span></span></div>waiting for output</div>' +
        '</div>' +
        '<div class="term-foot">' +
          '<div class="term-foot-left">' +
            '<span class="term-latency">—</span>' +
            '<span class="term-strategy"></span>' +
          '</div>' +
          '<button class="term-expand" title="Expand">⤢</button>' +
        '</div>';

      $('termGrid').appendChild(card);
      $('termEmpty').style.display = 'none';
      $('termSection').classList.add('visible');

      const bodyEl = card.querySelector('.term-body');
      const shimmerEl = card.querySelector('.term-shimmer');
      const statusEl = card.querySelector('.term-status');
      const latencyEl = card.querySelector('.term-latency');
      const strategyEl = card.querySelector('.term-strategy');
      const expandBtn = card.querySelector('.term-expand');

      let term = null, fitAddon = null, ws = null, hasOutput = false;

      if (typeof Terminal !== 'undefined') {
        term = new Terminal({ cursorBlink: true, fontSize: 12, fontFamily: 'Menlo, Monaco, "Courier New", monospace', scrollback: 5000, allowProposedApi: false, theme: { background: '#0c0c0f', foreground: '#e4e4e7', cursor: '#67e8f9' } });
        fitAddon = new FitAddon.FitAddon();
        term.loadAddon(fitAddon);
        term.open(bodyEl);
        fitAddon.fit();

        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(proto + '//' + location.host + '/api/sessions/' + id + '/stream');
        ws.binaryType = 'arraybuffer';
        ws.onmessage = function(e) {
          if (!hasOutput) { hasOutput = true; shimmerEl.style.display = 'none'; }
          term.write(new Uint8Array(e.data));
        };
        ws.onclose = function() {
          if (hasOutput) term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n');
          updateStatus('completed');
        };
        ws.onerror = function() { shimmerEl.textContent = 'connection error'; };

        term.onData(function(data) {
          fetch('/api/sessions/' + id + '/input', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: data }) });
        });

        expandBtn.onclick = function() {
          bodyEl.classList.toggle('expanded');
          expandBtn.textContent = bodyEl.classList.contains('expanded') ? '⤡' : '⤢';
          setTimeout(function() { if (fitAddon) fitAddon.fit(); }, 50);
        });

        window.addEventListener('resize', function() { if (fitAddon) fitAddon.fit(); });
      } else {
        shimmerEl.textContent = 'xterm.js not loaded';
      }

      function updateStatus(state, meta) {
        card.classList.remove('running', 'completed', 'failed', 'cancelled', 'extracting');
        card.classList.add(state);
        const pulse = state === 'running' || state === 'extracting' ? '<span class="term-pulse"></span>' : '';
        const label = state.charAt(0).toUpperCase() + state.slice(1);
        statusEl.innerHTML = pulse + label;
        statusEl.className = 'term-status ' + state;
        if (meta) {
          if (meta.latency !== undefined) latencyEl.textContent = meta.latency + 'ms';
          if (meta.strategy) strategyEl.textContent = '· ' + meta.strategy;
          if (meta.confidence !== undefined) {
            const conf = meta.confidence;
            const cls = conf >= 0.7 ? 'high' : conf >= 0.4 ? 'medium' : 'low';
            strategyEl.innerHTML = '· <span class="term-conf ' + cls + '">' + Math.round(conf * 100) + '%</span>';
          }
        }
      }

      terminals[id] = { card, term, ws, updateStatus };
      return terminals[id];
    }

    function loadSessions() {
      fetch('/api/sessions').then(function(r) { return r.json(); }).then(function(body) {
        const sessions = body.sessions || [];
        $('termCount').textContent = sessions.length + ' session' + (sessions.length !== 1 ? 's' : '');
        sessions.forEach(function(s) {
          if (!terminals[s.id] && (s.state === 'running' || s.state === 'created')) {
            createTerminalCard(s);
          }
        });
      }).catch(function() {});
    }
    setInterval(loadSessions, 2000);

    loadModels().catch((err) => { $('error').textContent = err.message || String(err); });
  </script>
</body>
</html>`

func FormatAddress(address string) string {
	if strings.HasPrefix(address, "http://") || strings.HasPrefix(address, "https://") {
		return address
	}
	return fmt.Sprintf("http://%s", address)
}
