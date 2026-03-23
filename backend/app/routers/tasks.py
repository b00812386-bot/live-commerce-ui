from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.db import get_db
from app.models import Task, TaskStatus, User
from app.schemas import PaginatedTasksResponse, TaskResponse, TaskResultResponse
from app.tasks import enqueue_task

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _get_user_task(task_id: str, user_id: int, db: Session) -> Task:
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == user_id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


@router.get("", response_model=PaginatedTasksResponse)
def list_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaginatedTasksResponse:
    offset = (page - 1) * page_size
    base_query = db.query(Task).filter(Task.user_id == current_user.id)
    total = base_query.with_entities(func.count(Task.id)).scalar() or 0
    items = base_query.order_by(Task.created_at.desc()).offset(offset).limit(page_size).all()
    return PaginatedTasksResponse(
        items=[TaskResponse.model_validate(item) for item in items],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.get("/{task_id}", response_model=TaskResponse)
def get_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskResponse:
    task = _get_user_task(task_id, current_user.id, db)
    return TaskResponse.model_validate(task)


@router.get("/{task_id}/result", response_model=TaskResultResponse)
def get_task_result(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskResultResponse:
    task = _get_user_task(task_id, current_user.id, db)
    return TaskResultResponse(task_id=task.id, status=task.status, result=task.result_json)


@router.post("/{task_id}/retry", response_model=TaskResponse)
def retry_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskResponse:
    task = _get_user_task(task_id, current_user.id, db)
    if task.status != TaskStatus.FAILED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only failed tasks can be retried")

    task.status = TaskStatus.QUEUED
    task.error_message = None
    task.progress = 5.0
    db.commit()
    db.refresh(task)

    enqueue_task(task)
    return TaskResponse.model_validate(task)
