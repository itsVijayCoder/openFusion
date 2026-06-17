# Local Runner

The local runner is a native Go binary under `apps/runner-go`.

## Process model

Local development normally uses three processes:

- `npm run api:dev`
- `npm run dev`
- `fusion-runner serve --cloud-url http://localhost:8787`

In a deployed setup, the web app and API are hosted, so the user's trusted machine only runs the local runner:

- `fusion-runner serve --cloud-url <deployed-api-url>`

The hosted browser UI cannot directly spawn a local binary or scan the user's PATH. OpenDesign appears native because its Electron package starts a privileged daemon sidecar that performs local agent detection and CLI spawning. Fusion Harness uses the same trust boundary through the Go runner.

A one-click "start runner" button requires an installed Fusion Runner launcher, such as a signed desktop helper or registered `fusion-runner://` protocol handler. Until that installer exists, the UI can show/copy the exact command and refresh runner detection after the process starts.

Initial commands:

- `fusion-runner login`
- `fusion-runner logout`
- `fusion-runner doctor`
- `fusion-runner discover`
- `fusion-runner serve`
- `fusion-runner run-test`
- `fusion-runner config`
- `fusion-runner update`

The current runner implements discovery, registration, job polling, local OpenCode/Codex execution, streamed run events, and artifact result posting. Production-grade runner auth, token rotation, installer packaging, and protocol-handler startup remain dedicated hardening tasks.
