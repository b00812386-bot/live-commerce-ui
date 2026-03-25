from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.db import get_db
from app.models import SourceType, Task, TaskStatus, User
from app.schemas import TaskCreateResponse, UrlTaskRequest
from app.services.storage import DownloadError, save_upload_file
from app.services.url_validator import UrlValidationError, validate_video_url
from app.tasks import enqueue_task

router = APIRouter(prefix="/api/videos", tags=["videos"])


def _validate_video_file(file: UploadFile) -> None:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".mp4", ".mov"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .mp4 and .mov files are supported")

    content_type = (file.content_type or "").lower()
    if content_type and content_type not in {"video/mp4", "application/mp4", "video/mpeg", "video/quicktime"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid video content type")


@router.post("/upload", response_model=TaskCreateResponse)
def upload_video(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskCreateResponse:
    _validate_video_file(file)
    try:
        video_path = save_upload_file(file)
    except DownloadError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    task = Task(
        user_id=current_user.id,
        source_type=SourceType.FILE,
        status=TaskStatus.QUEUED,
        video_path=video_path,
        progress=5.0,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    enqueue_task(task)
    return TaskCreateResponse(task_id=task.id, status=task.status, source_type=task.source_type)


@router.post("/by-url", response_model=TaskCreateResponse)
def create_task_by_url(
    payload: UrlTaskRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskCreateResponse:
    try:
        validate_video_url(str(payload.url))
    except UrlValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    task = Task(
        user_id=current_user.id,
        source_type=SourceType.URL,
        status=TaskStatus.QUEUED,
        source_url=str(payload.url),
        progress=5.0,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    enqueue_task(task)
    return TaskCreateResponse(task_id=task.id, status=task.status, source_type=task.source_type)
