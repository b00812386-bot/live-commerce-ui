# Video Predictor MVP (MP4 + URL)

Web-based UI + FastAPI backend for video upload/URL prediction tasks with async processing and chart visualization.

## Stack
- Frontend: React + Vite + Recharts
- Backend: FastAPI + SQLAlchemy + JWT
- Queue: Celery + Redis
- DB: PostgreSQL

## Features
- Split auth screen:
  - left panel for brand/product showcase
  - right panel for sign in and register
- Workspace page (single screen):
  - top area for upload/URL submission
  - bottom area for visualization results
- Auth in front-end demo mode (`demo` / `demo123` by default)
- Create task by:
  - MP4/MOV upload (<= 1GB)
  - Public direct video URL (`http/https`)
- Async task pipeline:
  - file: `queued -> processing -> succeeded/failed`
  - url: `queued -> downloading -> processing -> succeeded/failed`
- Result zone with:
  - Prediction value + confidence
  - Time-series chart
  - Linked metrics chart
  - Heatmap frame gallery
  - Recommendations
  - smooth progress and status transitions

## Run with Docker Compose
```bash
docker compose up --build
```

Services:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- Health: http://localhost:8000/health

Front-end environment:
- `VITE_MOCK_MODE=true` (default): runs auth + prediction interaction in demo mode
- `VITE_MOCK_MODE=false`: uses backend endpoints

## Local Backend (without Docker)
```bash
cd backend
python -m venv .venv
. .venv/Scripts/Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```

Run worker:
```bash
cd backend
celery -A worker.celery_app worker --loglevel=info
```

## API
- `POST /api/auth/login`
- `POST /api/videos/upload`
- `POST /api/videos/by-url`
- `GET /api/tasks`
- `GET /api/tasks/{task_id}`
- `GET /api/tasks/{task_id}/result`
- `POST /api/tasks/{task_id}/retry`

## Notes
- URL ingestion supports only direct downloadable video URLs in v1.
- Basic SSRF mitigation is included (blocks localhost/private IP targets).
- Artifacts are served from `/artifacts/*`.

## Backend tests
```bash
cd backend
pytest
```
