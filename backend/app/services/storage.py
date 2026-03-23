from pathlib import Path
from uuid import uuid4

import requests
from fastapi import UploadFile

from app.core.config import settings

CHUNK_SIZE = 1024 * 1024


class DownloadError(RuntimeError):
    pass


def ensure_storage_dirs() -> None:
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.artifact_dir.mkdir(parents=True, exist_ok=True)


def _safe_video_path(prefix: str = "video") -> Path:
    filename = f"{prefix}_{uuid4().hex}.mp4"
    return settings.upload_dir / filename


def save_upload_file(file: UploadFile) -> str:
    dst = _safe_video_path("upload")
    written = 0
    max_bytes = settings.max_upload_mb * CHUNK_SIZE

    with dst.open("wb") as out_file:
        while True:
            chunk = file.file.read(CHUNK_SIZE)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                dst.unlink(missing_ok=True)
                raise DownloadError(f"File exceeds max size {settings.max_upload_mb}MB")
            out_file.write(chunk)

    return str(dst)


def download_video_from_url(url: str) -> str:
    dst = _safe_video_path("url")
    total = 0
    max_bytes = settings.max_download_mb * CHUNK_SIZE

    try:
        with requests.get(url, stream=True, timeout=settings.download_timeout_seconds) as response:
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "").lower()
            if content_type and "video" not in content_type and "mp4" not in content_type:
                raise DownloadError("URL does not point to a video file")

            with dst.open("wb") as out_file:
                for chunk in response.iter_content(chunk_size=CHUNK_SIZE):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > max_bytes:
                        raise DownloadError(f"Downloaded file exceeds max size {settings.max_download_mb}MB")
                    out_file.write(chunk)
    except requests.RequestException as exc:
        dst.unlink(missing_ok=True)
        raise DownloadError("Failed to download URL source") from exc
    except Exception:
        dst.unlink(missing_ok=True)
        raise

    if total == 0:
        dst.unlink(missing_ok=True)
        raise DownloadError("Downloaded file is empty")

    return str(dst)
