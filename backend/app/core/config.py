from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "Video Predictor API"
    secret_key: str = "change-this-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 12

    database_url: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/video_predictor"
    redis_url: str = "redis://localhost:6379/0"

    upload_dir: Path = Path("data/uploads")
    artifact_dir: Path = Path("data/artifacts")
    max_upload_mb: int = 200
    max_download_mb: int = 200
    download_timeout_seconds: int = 30

    # Optional comma-separated allowlist: e.g. "example.com,cdn.example.com"
    allowed_url_domains: str = ""

    default_username: str = "demo"
    default_password: str = "demo123"

    @property
    def allowed_domains(self) -> set[str]:
        if not self.allowed_url_domains.strip():
            return set()
        return {item.strip().lower() for item in self.allowed_url_domains.split(",") if item.strip()}


settings = Settings()
