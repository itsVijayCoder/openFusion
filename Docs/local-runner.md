# Local Runner

The local runner is a native Go binary under `apps/runner-go`.

Initial commands:

- `fusion-runner login`
- `fusion-runner logout`
- `fusion-runner doctor`
- `fusion-runner discover`
- `fusion-runner serve`
- `fusion-runner run-test`
- `fusion-runner config`
- `fusion-runner update`

The current scaffold implements safe discovery primitives and command routing. Cloud login, serving, adapters, and executors are intentionally left for dedicated implementation tasks.
