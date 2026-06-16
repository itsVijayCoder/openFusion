# API

Native API surface:

- `GET /api/health`
- `GET /api/runners`
- `POST /api/runners/register`
- `GET /api/models`
- `POST /api/models/discover`
- `POST /api/fusion/runs`
- `GET /api/fusion/runs/:id`
- `GET /api/fusion/runs/:id/events`
- `POST /api/fusion/runs/:id/approve`
- `POST /api/fusion/runs/:id/cancel`
- `GET /api/artifacts/:id`

OpenAI-compatible surface:

- `GET /v1/models`
- `POST /v1/chat/completions`
