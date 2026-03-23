from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.models import SourceType, TaskStatus


class TokenRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UrlTaskRequest(BaseModel):
    url: HttpUrl


class TaskCreateResponse(BaseModel):
    task_id: str
    status: TaskStatus
    source_type: SourceType


class TimeSeriesPoint(BaseModel):
    second: int
    value: float


class LinkedMetricPoint(BaseModel):
    second: int
    metric_a: float
    metric_b: float


class HeatmapFrame(BaseModel):
    second: int
    image_url: str
    score: float


class PredictionResult(BaseModel):
    prediction_value: float
    confidence: float
    time_series: list[TimeSeriesPoint]
    linked_metrics: list[LinkedMetricPoint]
    heatmap_frames: list[HeatmapFrame]
    recommendations: list[str] = Field(default_factory=list)


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_type: SourceType
    status: TaskStatus
    source_url: str | None
    error_message: str | None
    progress: float
    created_at: datetime
    updated_at: datetime


class TaskResultResponse(BaseModel):
    task_id: str
    status: TaskStatus
    result: PredictionResult | None


class PaginatedTasksResponse(BaseModel):
    items: list[TaskResponse]
    page: int
    page_size: int
    total: int
