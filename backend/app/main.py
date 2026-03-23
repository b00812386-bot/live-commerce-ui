from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.security import get_password_hash
from app.db import SessionLocal, engine
from app.models import Base, User
from app.routers import auth, tasks, videos
from app.services.storage import ensure_storage_dirs


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)
    app.include_router(videos.router)
    app.include_router(tasks.router)

    ensure_storage_dirs()
    app.mount("/artifacts", StaticFiles(directory=str(settings.artifact_dir)), name="artifacts")
    return app


app = create_app()


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_storage_dirs()

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == settings.default_username).first()
        if not existing:
            db.add(
                User(
                    username=settings.default_username,
                    password_hash=get_password_hash(settings.default_password),
                )
            )
            db.commit()
    finally:
        db.close()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
