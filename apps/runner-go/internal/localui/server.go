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
)

type Options struct {
	Address           string
	WorkspacePath     string
	PermissionProfile string
	Timeout           time.Duration
	Config            config.Config
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
		result, err := fusion.Execute(r.Context(), req)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, result)
	})

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
    @media (max-width: 900px) {
      .app { grid-template-columns: 1fr; }
      .rail { display: none; }
      .stage { padding-top: 28px; }
      .options, .output { grid-template-columns: 1fr; }
      .picker { grid-template-columns: 1fr; }
      .picker-side { display: none; }
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
        </div>
      </section>
    </main>
  </div>
  <div id="modal" class="modal">
    <div class="picker">
      <div class="picker-main">
        <div class="picker-head"><input id="modelSearch" placeholder="Search models" /><button id="closePicker">×</button></div>
        <div id="modelsList" class="models"></div>
        <div class="custom"><select id="customAdapter"><option value="opencode">OpenCode</option><option value="codex">Codex</option></select><input id="customModel" placeholder="provider/model or model-id" /><button id="addCustom">Add</button></div>
      </div>
      <aside class="picker-side"><strong id="pickerTitle">Panel models</strong><p id="pickerHelp">Choose the analysis models that should answer independently.</p><p>Use OpenCode for provider-qualified IDs and Codex for Codex CLI model IDs. Custom IDs are sent as process arguments, not shell strings.</p></aside>
    </div>
  </div>
  <script>
    const state = { models: [], tools: [], mode: 'required', analysis: [], judge: '', target: 'analysis', custom: [] };
    const modes = ['auto', 'required', 'direct'];
    const adapters = { opencode: 'OpenCode', codex: 'Codex' };
    const $ = (id) => document.getElementById(id);
    const short = (m) => (m.displayName || m.model || m.id || '').split('/').pop();
    const validCustom = (value) => /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/.test(value.trim());
    function allModels() {
      const map = new Map();
      [...state.models, ...state.custom].forEach((model) => map.set(model.id, model));
      return [...map.values()].filter((m) => m.adapter === 'opencode' || m.adapter === 'codex')
        .sort((a, b) => a.adapter.localeCompare(b.adapter) || a.model.localeCompare(b.model));
    }
    function byId(id) { return allModels().find((m) => m.id === id); }
    function defaultPick() {
      const available = allModels().filter((m) => m.availability !== 'unavailable');
      state.analysis = available.slice(0, Math.min(3, available.length)).map((m) => m.id);
      const codex = available.find((m) => m.adapter === 'codex');
      state.judge = (codex || available[0] || {}).id || '';
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
        return '<button class="model-option ' + (selected.has(m.id) ? 'selected' : '') + '" data-model="' + m.id + '"><span class="badge">' + (m.adapter === 'codex' ? 'C' : 'O') + '</span><span class="model-copy"><span class="model-name">' + (m.displayName || m.model) + '</span><span class="model-sub">' + adapters[m.adapter] + ' · ' + (m.provider || 'local') + ' · ' + m.availability.replaceAll('_', ' ') + '</span></span></button>';
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
      $('trace').innerHTML = '<div class="trace-item"><div class="trace-title"><span>Running fusion pipeline</span><span>queued</span></div><div class="trace-meta">Panel calls run first, then one judge / synthesis call writes the final output.</div></div>';
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
      return '<div class="trace-item"><div class="trace-title"><span>' + roleLabel + ' · ' + output.modelId + '</span><span>' + output.status + '</span></div><div class="trace-meta">' + output.adapter + ' · ' + (output.latencyMs || 0) + 'ms</div>' + (output.error ? '<div class="trace-error">' + output.error + '</div>' : '') + '</div>';
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
    function renderResult(result) {
      $('trace').innerHTML = analysisBar(result.analysis) + synthesisAnalysisBlock(result.synthesisAnalysis) + [...(result.panel || []), result.judge].map(traceItem).join('');
      $('finalAnswer').textContent = result.finalAnswer || result.error || 'No final answer returned.';
    }
    $('closePicker').onclick = closePicker;
    $('modal').onclick = (event) => { if (event.target === $('modal')) closePicker(); };
    $('modelSearch').oninput = renderPicker;
    $('addCustom').onclick = () => {
      const adapter = $('customAdapter').value;
      const model = $('customModel').value.trim();
      if (!validCustom(model)) { $('error').textContent = 'Invalid custom model ID'; return; }
      const item = { id: adapter + '/' + model, adapter, provider: adapter === 'codex' ? 'openai' : (model.includes('/') ? model.split('/')[0] : adapter), model, displayName: model, authMode: 'cli_session', availability: 'configured_unverified', source: 'custom', capabilities: { streaming: true, tools: true, fileEdits: true, shell: true, jsonOutput: true, modelListing: false } };
      state.custom = [...state.custom.filter((m) => m.id !== item.id), item];
      $('customModel').value = '';
      selectModel(item.id);
    };
    $('runButton').onclick = runFusion;
    $('prompt').addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') runFusion(); });
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
