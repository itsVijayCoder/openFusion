package localui

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/asthrix/fusion-harness/apps/runner-go/internal/config"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/discovery"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/fusion"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/localagents"
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

	log.Printf("Fusion Harness local UI listening on http://%s", options.Address)
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
  <title>Fusion Harness</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #050607;
      --panel: #0b0c0e;
      --surface: #111214;
      --surface-2: #151618;
      --line: rgba(255,255,255,.11);
      --line-strong: rgba(255,255,255,.17);
      --text: #f4f4f5;
      --muted: #71717a;
      --soft: #a1a1aa;
      --accent: #7c3aed;
      --accent-2: #a78bfa;
      --danger: #fca5a5;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    button, input, select, textarea { font: inherit; }
    .app { min-height: 100vh; display: grid; grid-template-columns: 260px minmax(0, 1fr); }
    .rail { border-right: 1px solid var(--line); background: #08090b; display: flex; flex-direction: column; min-height: 100vh; }
    .brand { height: 56px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); padding: 0 20px; font-size: 14px; font-weight: 700; }
    .mark { width: 26px; height: 26px; display: grid; place-items: center; background: #f4f4f5; color: #09090b; border-radius: 6px; font-weight: 800; }
    .rail-main { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .rail-button { height: 36px; border: 0; border-radius: 6px; background: rgba(255,255,255,.06); color: #e4e4e7; text-align: left; padding: 0 12px; font-weight: 650; cursor: pointer; }
    .rail-button:hover { background: rgba(255,255,255,.09); }
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
    .composer { border: 1px solid var(--line-strong); background: var(--surface); border-radius: 8px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.36); }
    .toolbar { display: grid; gap: 14px; padding: 14px; }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pill { height: 32px; border-radius: 999px; border: 0; background: rgba(255,255,255,.045); color: var(--muted); padding: 0 12px; font-size: 12px; font-weight: 750; cursor: pointer; }
    .pill.active { background: #f4f4f5; color: #09090b; }
    .chip { display: inline-flex; height: 32px; align-items: center; gap: 8px; border: 1px solid var(--line-strong); background: rgba(255,255,255,.06); border-radius: 6px; padding: 0 10px; color: #d4d4d8; font-size: 12px; font-weight: 750; }
    .chip button { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 0; }
    .ghost { height: 32px; border: 1px dashed rgba(255,255,255,.22); background: transparent; color: var(--soft); border-radius: 6px; padding: 0 12px; font-size: 12px; font-weight: 750; cursor: pointer; }
    .ghost:hover { border-color: rgba(255,255,255,.42); color: var(--text); }
    .micro-label { color: var(--muted); font-size: 12px; font-weight: 750; }
    textarea { display: block; width: 100%; min-height: 170px; resize: vertical; border: 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--surface-2); color: var(--text); padding: 22px 24px; outline: none; line-height: 1.55; }
    textarea::placeholder { color: #52525b; }
    .bottom { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; }
    .iconbar { display: flex; gap: 6px; color: var(--muted); }
    .iconbar button, .send { width: 34px; height: 34px; border-radius: 6px; border: 0; display: grid; place-items: center; cursor: pointer; }
    .iconbar button { background: transparent; color: inherit; }
    .iconbar button:hover { background: rgba(255,255,255,.08); color: var(--text); }
    .send { background: var(--accent); color: white; font-size: 18px; }
    .send:disabled { opacity: .45; cursor: not-allowed; }
    .options { margin-top: 12px; display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(0, 1fr)); color: var(--muted); font-size: 12px; }
    .field { border: 1px solid var(--line); background: rgba(255,255,255,.03); border-radius: 6px; padding: 8px 10px; min-width: 0; }
    .field label { display: block; color: var(--soft); font-weight: 750; margin-bottom: 6px; }
    .field input, .field select { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--muted); }
    .output { margin-top: 18px; display: none; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 14px; }
    .output.visible { display: grid; }
    .panel { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; overflow: hidden; }
    .panel h2 { margin: 0; padding: 12px 14px; border-bottom: 1px solid var(--line); font-size: 13px; }
    .panel pre { margin: 0; padding: 14px; white-space: pre-wrap; overflow-wrap: anywhere; color: #d4d4d8; font-size: 13px; line-height: 1.55; max-height: 460px; overflow: auto; }
    .trace-item { border-bottom: 1px solid var(--line); padding: 12px 14px; }
    .trace-item:last-child { border-bottom: 0; }
    .trace-title { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 750; }
    .trace-meta { margin-top: 4px; color: var(--muted); font-size: 12px; }
    .trace-error { margin-top: 6px; color: var(--danger); font-size: 12px; }
    .modal { position: fixed; inset: 0; display: none; place-items: center; padding: 18px; background: rgba(0,0,0,.76); z-index: 20; }
    .modal.visible { display: grid; }
    .picker { width: min(920px, 100%); max-height: min(620px, calc(100vh - 36px)); display: grid; grid-template-columns: minmax(0, 1fr) 280px; border: 1px solid var(--line-strong); background: var(--panel); border-radius: 8px; overflow: hidden; }
    .picker-main { min-width: 0; display: flex; flex-direction: column; }
    .picker-head { padding: 12px; border-bottom: 1px solid var(--line); display: flex; gap: 10px; }
    .picker-head input { flex: 1; height: 38px; border: 1px solid var(--line-strong); background: #090a0c; color: var(--text); border-radius: 6px; padding: 0 12px; outline: none; }
    .picker-head button { width: 38px; border: 0; border-radius: 6px; background: rgba(255,255,255,.06); color: var(--soft); cursor: pointer; }
    .models { overflow: auto; min-height: 260px; }
    .model-option { width: 100%; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: inherit; text-align: left; display: flex; gap: 12px; align-items: center; padding: 12px 14px; cursor: pointer; }
    .model-option:hover, .model-option.selected { background: rgba(255,255,255,.065); }
    .badge { width: 28px; height: 28px; border-radius: 6px; background: white; color: black; display: grid; place-items: center; font-size: 12px; font-weight: 900; flex: 0 0 auto; }
    .model-copy { min-width: 0; flex: 1; }
    .model-name, .model-sub { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .model-name { font-size: 13px; font-weight: 800; color: #e4e4e7; }
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
      <div class="brand"><span class="mark">F</span><span>Open Fusion</span></div>
      <div class="rail-main"><button class="rail-button" onclick="location.reload()">New Fusion</button></div>
      <div class="rail-footer"><div id="agentCount">Detecting local agents...</div><div>Go runner · local CLI sessions</div></div>
    </aside>
    <main class="main">
      <header class="top"><nav><span>Fusion</span><span>Models</span><span>Agents</span><span>Runs</span></nav></header>
      <section class="stage">
        <div class="wrap">
          <div class="headline">
            <h1>Model Fusion</h1>
            <p>Run local agent models side by side, judge the result, then write the final answer.</p>
          </div>
          <div class="composer">
            <div class="toolbar">
              <div class="row" id="modes"></div>
              <div class="row" id="chips"></div>
              <div class="row">
                <span class="micro-label">Judge</span><button class="ghost" id="judgeButton"></button>
                <span class="micro-label" style="margin-left:8px">Final</span><button class="ghost" id="finalButton"></button>
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
            <div class="panel"><h2>Final Answer</h2><pre id="finalAnswer"></pre></div>
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
    const state = { models: [], tools: [], mode: 'required', analysis: [], judge: '', final: '', target: 'analysis', custom: [] };
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
      const available = allModels().filter((m) => m.model !== 'default' && m.availability !== 'unavailable');
      state.analysis = available.slice(0, Math.min(3, available.length)).map((m) => m.id);
      const codex = available.find((m) => m.adapter === 'codex');
      state.judge = (codex || available[0] || {}).id || '';
      state.final = (codex || available[0] || {}).id || '';
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
      const final = byId(state.final);
      $('judgeButton').textContent = judge ? short(judge) : 'Auto';
      $('finalButton').textContent = final ? short(final) : 'Auto';
      $('judgeButton').onclick = () => openPicker('judge');
      $('finalButton').onclick = () => openPicker('final');
      $('selectedSummary').textContent = state.analysis.length + ' analysis · ' + (judge ? short(judge) : 'auto') + ' judge';
    }
    function openPicker(target) {
      state.target = target;
      $('pickerTitle').textContent = target === 'analysis' ? 'Panel models' : target === 'judge' ? 'Judge model' : 'Final writer model';
      $('pickerHelp').textContent = target === 'analysis' ? 'Choose the models that answer independently.' : 'Choose one model for this stage.';
      $('modal').classList.add('visible');
      $('modelSearch').value = '';
      renderPicker();
      $('modelSearch').focus();
    }
    function closePicker() { $('modal').classList.remove('visible'); }
    function selectedIds() { return state.target === 'analysis' ? state.analysis : [state.target === 'judge' ? state.judge : state.final].filter(Boolean); }
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
      } else {
        state.final = id; closePicker();
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
      $('trace').innerHTML = '<div class="trace-item"><div class="trace-title"><span>Running fusion pipeline</span><span>queued</span></div><div class="trace-meta">Panel calls run first, then judge, then final writer.</div></div>';
      $('finalAnswer').textContent = '';
      try {
        const response = await fetch('/api/fuse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          prompt: $('prompt').value,
          workspacePath: $('workspace').value,
          mode: state.mode,
          permissionProfile: $('permission').value,
          analysisModels: state.analysis,
          judgeModel: state.judge,
          finalModel: state.final
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
      return '<div class="trace-item"><div class="trace-title"><span>' + output.role + ' · ' + output.modelId + '</span><span>' + output.status + '</span></div><div class="trace-meta">' + output.adapter + ' · ' + (output.latencyMs || 0) + 'ms</div>' + (output.error ? '<div class="trace-error">' + output.error + '</div>' : '') + '</div>';
    }
    function renderResult(result) {
      $('trace').innerHTML = [...(result.panel || []), result.judge, result.final].map(traceItem).join('');
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
