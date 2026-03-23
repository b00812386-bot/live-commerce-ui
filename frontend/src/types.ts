export type SourceType = "file" | "url";
export type TaskStatus = "queued" | "downloading" | "processing" | "succeeded" | "failed";

export interface TaskCreateResponse {
  task_id: string;
  status: TaskStatus;
  source_type: SourceType;
}

export interface TaskItem {
  id: string;
  source_type: SourceType;
  status: TaskStatus;
  source_url?: string | null;
  error_message?: string | null;
  progress: number;
  created_at: string;
  updated_at: string;
}

export interface PaginatedTasks {
  items: TaskItem[];
  page: number;
  page_size: number;
  total: number;
}

export interface PredictionResult {
  prediction_value: number;
  confidence: number;
  time_series: Array<{ second: number; value: number }>;
  linked_metrics: Array<{ second: number; metric_a: number; metric_b: number }>;
  heatmap_frames: Array<{ second: number; image_url: string; score: number }>;
  multi_feature_scores?: {
    voice_score: number;
    text_score: number;
    expression_score: number;
  };
  sales_forecast?: {
    predicted_sales: number;
    conversion_rate: number;
    gmv_index: number;
    level: "高潜力" | "中潜力" | "待优化";
  };
  recommendations: string[];
}

export interface TaskResultResponse {
  task_id: string;
  status: TaskStatus;
  result: PredictionResult | null;
}
