from celery import Celery
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import SessionLocal
from app.models import SourceType, Task, TaskStatus
from app.services.predictor import run_prediction
from app.services.storage import DownloadError, download_video_from_url
from app.services.url_validator import UrlValidationError, validate_video_url

celery_app = Celery("video_predictor", broker=settings.redis_url, backend=settings.redis_url)


def _load_task(db: Session, task_id: str) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise ValueError(f"Task not found: {task_id}")
    return task


def _mark_failed(task: Task, message: str, db: Session) -> None:
    task.status = TaskStatus.FAILED
    task.error_message = message
    task.progress = 0.0
    db.commit()


@celery_app.task(name="process_file_task")
def process_file_task(task_id: str) -> None:
    db = SessionLocal()
    try:
        task = _load_task(db, task_id)
        if not task.video_path:
            _mark_failed(task, "Missing uploaded video path", db)
            return

        task.status = TaskStatus.PROCESSING
        task.progress = 30.0
        task.error_message = None
        db.commit()

        result = run_prediction(task.video_path, task.id)
        task.result_json = result
        task.status = TaskStatus.SUCCEEDED
        task.progress = 100.0
        db.commit()
    except Exception as exc:
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            _mark_failed(task, f"Prediction failed: {exc}", db)
    finally:
        db.close()


@celery_app.task(name="process_url_task")
def process_url_task(task_id: str) -> None:
    db = SessionLocal()
    try:
        task = _load_task(db, task_id)
        if not task.source_url:
            _mark_failed(task, "Missing source URL", db)
            return

        task.status = TaskStatus.DOWNLOADING
        task.progress = 10.0
        task.error_message = None
        db.commit()

        try:
            validate_video_url(task.source_url)
            downloaded_path = download_video_from_url(task.source_url)
        except (UrlValidationError, DownloadError) as exc:
            _mark_failed(task, f"Download failed: {exc}", db)
            return

        task.video_path = downloaded_path
        task.status = TaskStatus.PROCESSING
        task.progress = 40.0
        db.commit()

        result = run_prediction(downloaded_path, task.id)
        task.result_json = result
        task.status = TaskStatus.SUCCEEDED
        task.progress = 100.0
        db.commit()
    except Exception as exc:
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            _mark_failed(task, f"Task failed: {exc}", db)
    finally:
        db.close()


def enqueue_task(task: Task) -> None:
    if task.source_type == SourceType.FILE:
        process_file_task.delay(task.id)
    else:
        process_url_task.delay(task.id)
