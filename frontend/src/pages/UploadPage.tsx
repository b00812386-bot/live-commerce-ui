import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { artifactUrl, createTaskByUrl, fetchTask, fetchTaskResult, isMockModeEnabled, uploadVideo } from "../api";
import { simulatePrediction } from "../mockPredictor";
import type { PredictionResult, SourceType, TaskStatus } from "../types";

const MAX_BYTES = 200 * 1024 * 1024;
const ACTIVE_STATUS: TaskStatus[] = ["queued", "downloading", "processing"];
const HISTORY_KEY = "vp_analysis_history";

type UIStatus = TaskStatus | "idle";

type FeatureItem = {
  key: string;
  label: string;
  value: number;
  desc: string;
};

type HistoryRecord = {
  id: string;
  taskId: string;
  submittedAt: string;
  sourceDesc: string;
  result: PredictionResult;
};

const STATUS_LABEL: Record<UIStatus, string> = {
  idle: "待开始",
  queued: "排队中",
  downloading: "下载中",
  processing: "分析中",
  succeeded: "已完成",
  failed: "失败"
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, current) => sum + current, 0) / values.length;
}

function loadHistoryRecords(): HistoryRecord[] {
  const raw = localStorage.getItem(HISTORY_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as HistoryRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistoryRecords(records: HistoryRecord[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(records));
}

function predictSalesFallback(result: PredictionResult): {
  predictedSales: number;
  conversionRate: number;
  gmvIndex: number;
  level: "高潜力" | "中潜力" | "待优化";
} {
  const predictedSales = Math.round(1000 + result.prediction_value * 7200 + result.confidence * 1300);
  const conversionRate = Number((0.015 + result.prediction_value * 0.043).toFixed(4));
  const gmvIndex = Math.round((result.prediction_value * 100 + result.confidence * 50) * 1.08);

  let level: "高潜力" | "中潜力" | "待优化" = "待优化";
  if (predictedSales >= 7000) {
    level = "高潜力";
  } else if (predictedSales >= 4200) {
    level = "中潜力";
  }

  return { predictedSales, conversionRate, gmvIndex, level };
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("zh-CN", { hour12: false });
}

export default function UploadPage(): JSX.Element {
  const [mode, setMode] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [sourceDesc, setSourceDesc] = useState("尚未提交任务");
  const [taskId, setTaskId] = useState("");
  const [status, setStatus] = useState<UIStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [statusHint, setStatusHint] = useState("请先在上方提交直播视频任务。");
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [selectedSecond, setSelectedSecond] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submittedAt, setSubmittedAt] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewStartSecond, setPreviewStartSecond] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState("");

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewTimerRef = useRef<number | null>(null);

  const mockMode = isMockModeEnabled();
  const currentDate = useMemo(() => new Date().toLocaleDateString("zh-CN"), []);

  useEffect(() => {
    setHistoryRecords(loadHistoryRecords());
  }, []);

  useEffect(() => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    if (mode === "file") {
      if (!file) {
        setPreviewUrl("");
        setPreviewStartSecond(null);
        setPreviewError("");
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);
      setPreviewStartSecond(null);
      setPreviewError("");
      return () => {
        URL.revokeObjectURL(objectUrl);
      };
    }

    const trimmed = url.trim();
    setPreviewUrl(trimmed);
    setPreviewStartSecond(null);
    setPreviewError("");
  }, [file, mode, url]);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
      }
    };
  }, []);

  const fileHint = useMemo(() => {
    if (!file) {
      return "";
    }
    return `${file.name}（${(file.size / (1024 * 1024)).toFixed(2)}MB）`;
  }, [file]);

  const selectedFrame = useMemo(() => {
    if (!result || result.heatmap_frames.length === 0) {
      return null;
    }
    if (selectedSecond == null) {
      return result.heatmap_frames[0];
    }
    return result.heatmap_frames.find((item) => item.second === selectedSecond) ?? result.heatmap_frames[0];
  }, [result, selectedSecond]);

  const featureScores = useMemo<FeatureItem[]>(() => {
    if (!result) {
      return [];
    }

    const fromModel = result.multi_feature_scores;
    const voiceScore = fromModel?.voice_score ?? average(result.linked_metrics.map((item) => item.metric_a));
    const textScore = fromModel?.text_score ?? average(result.linked_metrics.map((item) => item.metric_b));
    const expressionScore = fromModel?.expression_score ?? Math.max(...result.time_series.map((item) => item.value));

    return [
      {
        key: "voice",
        label: "声音表现分",
        value: voiceScore,
        desc: "语速节奏、情绪感染力、强调力度"
      },
      {
        key: "text",
        label: "文本话术分",
        value: textScore,
        desc: "卖点表达、促单语句、关键词质量"
      },
      {
        key: "expression",
        label: "表情状态分",
        value: expressionScore,
        desc: "面部活跃度、表情稳定性、互动亲和力"
      }
    ];
  }, [result]);

  const featureRadarData = useMemo(
    () =>
      featureScores.map((item) => ({
        feature: item.label,
        score: Number((item.value * 100).toFixed(1)),
        full: 100,
        desc: item.desc
      })),
    [featureScores]
  );

  const salesForecast = useMemo(() => {
    if (!result) {
      return null;
    }
    if (result.sales_forecast) {
      return {
        predictedSales: result.sales_forecast.predicted_sales,
        conversionRate: result.sales_forecast.conversion_rate,
        gmvIndex: result.sales_forecast.gmv_index,
        level: result.sales_forecast.level
      };
    }
    return predictSalesFallback(result);
  }, [result]);

  const isActive = ACTIVE_STATUS.includes(status as TaskStatus);

  const appendHistory = (record: HistoryRecord) => {
    setHistoryRecords((previous) => {
      const next = [record, ...previous].slice(0, 30);
      saveHistoryRecords(next);
      return next;
    });
  };

  const restoreHistory = (record: HistoryRecord) => {
    setTaskId(record.taskId);
    setSubmittedAt(record.submittedAt);
    setSourceDesc(record.sourceDesc);
    setResult(record.result);
    setStatus("succeeded");
    setProgress(100);
    setStatusHint("已加载历史记录，可继续查看图表与建议。");
    setSelectedSecond(record.result.heatmap_frames[0]?.second ?? null);
    setHistoryOpen(false);
  };

  const deleteHistoryRecord = (recordId: string) => {
    const confirmed = window.confirm("确定删除这条历史记录吗？");
    if (!confirmed) {
      return;
    }
    setHistoryRecords((previous) => {
      const next = previous.filter((item) => item.id !== recordId);
      saveHistoryRecords(next);
      return next;
    });
  };

  const handlePreviewMetadataLoaded = () => {
    const video = previewVideoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }
    const clipLength = Math.min(5, Math.max(2, video.duration * 0.1));
    const maxStart = Math.max(0, video.duration - clipLength);
    const randomStart = maxStart > 0 ? Math.random() * maxStart : 0;

    setPreviewStartSecond(randomStart);
    video.currentTime = randomStart;
    video.muted = true;
    video.play().catch(() => {
      // no-op
    });

    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
    }
    previewTimerRef.current = window.setTimeout(() => {
      video.pause();
    }, 3500);
  };

  const validateFileInput = async (): Promise<{ sourceType: SourceType; sourceId: string }> => {
    if (!file) {
      throw new Error("请选择 MP4 文件");
    }
    if (!file.name.toLowerCase().endsWith(".mp4")) {
      throw new Error("仅支持 MP4 文件");
    }
    if (file.size > MAX_BYTES) {
      throw new Error("文件大小不能超过 200MB");
    }
    return { sourceType: "file", sourceId: `${file.name}-${file.size}` };
  };

  const validateUrlInput = async (): Promise<{ sourceType: SourceType; sourceId: string }> => {
    const trimmed = url.trim();
    if (!trimmed) {
      throw new Error("请输入视频 URL");
    }
    return { sourceType: "url", sourceId: trimmed };
  };

  const resolveInput = async (): Promise<{ sourceType: SourceType; sourceId: string }> => {
    return mode === "file" ? validateFileInput() : validateUrlInput();
  };

  const runMockFlow = async (
    sourceType: SourceType,
    sourceId: string,
    finalSourceDesc: string,
    finalSubmittedAt: string
  ): Promise<void> => {
    const generated = await simulatePrediction(sourceType, sourceId, (payload) => {
      setStatus(payload.status);
      setProgress(payload.progress);
      setStatusHint(payload.label);
    });

    const generatedTaskId = `mock-${Math.random().toString(16).slice(2, 10)}`;
    setTaskId(generatedTaskId);
    setResult(generated);
    setStatus("succeeded");
    setProgress(100);
    setStatusHint("分析完成，已生成多特征评分与销量预测。");
    setSelectedSecond(generated.heatmap_frames[0]?.second ?? null);

    appendHistory({
      id: `${Date.now()}-${generatedTaskId}`,
      taskId: generatedTaskId,
      submittedAt: finalSubmittedAt,
      sourceDesc: finalSourceDesc,
      result: generated
    });
  };

  const runServerFlow = async (
    sourceType: SourceType,
    finalSourceDesc: string,
    finalSubmittedAt: string
  ): Promise<void> => {
    const created =
      sourceType === "file" && file ? await uploadVideo(file) : await createTaskByUrl(url.trim());

    setTaskId(created.task_id);
    setStatus(created.status);
    setProgress(8);

    while (true) {
      await sleep(2000);
      const task = await fetchTask(created.task_id);
      setStatus(task.status);
      setProgress(task.progress);
      setStatusHint(`任务状态：${STATUS_LABEL[task.status]}`);

      if (task.status === "failed") {
        throw new Error(task.error_message ?? "分析失败");
      }
      if (task.status === "succeeded") {
        const taskResult = await fetchTaskResult(created.task_id);
        if (!taskResult.result) {
          throw new Error("任务已完成，但未返回结果数据");
        }
        setResult(taskResult.result);
        setStatus("succeeded");
        setProgress(100);
        setStatusHint("分析完成，已生成多特征评分与销量预测。");
        setSelectedSecond(taskResult.result.heatmap_frames[0]?.second ?? null);

        appendHistory({
          id: `${Date.now()}-${created.task_id}`,
          taskId: created.task_id,
          submittedAt: finalSubmittedAt,
          sourceDesc: finalSourceDesc,
          result: taskResult.result
        });
        break;
      }
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setResult(null);
    setProgress(0);
    setTaskId("");
    setSelectedSecond(null);
    setLoading(true);

    const submitDate = formatDateTime(new Date());
    setSubmittedAt(submitDate);

    try {
      const payload = await resolveInput();
      const nextSourceDesc = payload.sourceType === "file" ? `本地文件：${file?.name ?? ""}` : `URL：${url.trim()}`;
      setSourceDesc(nextSourceDesc);

      if (mockMode) {
        await runMockFlow(payload.sourceType, payload.sourceId, nextSourceDesc, submitDate);
      } else {
        await runServerFlow(payload.sourceType, nextSourceDesc, submitDate);
      }
    } catch (err) {
      setStatus("failed");
      setProgress(0);
      setError(err instanceof Error ? err.message : "任务启动失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="workspace">
      <section className="card workspace-top">
        <div className="section-head">
          <div>
            <p className="eyebrow">直播任务上传中心</p>
            <h1>销量预测工作台</h1>
            <p className="muted">上传直播视频后，系统将输出声音、文本、表情特征评分及销量预测。</p>
          </div>
          <span className="tag-chip">{mockMode ? "演示模式" : "后端模式"}</span>
        </div>

        <div className="segmented">
          <button type="button" className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}>
            上传本地 MP4
          </button>
          <button type="button" className={mode === "url" ? "active" : ""} onClick={() => setMode("url")}>
            输入视频 URL
          </button>
        </div>

        <form className="upload-form" onSubmit={onSubmit}>
          {mode === "file" ? (
            <label>
              选择直播视频（最大 200MB）
              <input
                type="file"
                accept="video/mp4,.mp4"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              {fileHint && <div className="muted">{fileHint}</div>}
            </label>
          ) : (
            <label>
              公开可访问的视频直链 URL
              <input
                type="url"
                placeholder="例如：https://example.com/live_replay.mp4"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
              />
            </label>
          )}

          <button type="submit" disabled={loading}>
            {loading ? "处理中..." : "开始分析"}
          </button>
        </form>

        <div className="preview-card">
          <div className="preview-head">
            <h3>视频预览</h3>
            {previewStartSecond != null && <span>随机预览起点：{previewStartSecond.toFixed(1)}s</span>}
          </div>
          {previewUrl ? (
            <video
              ref={previewVideoRef}
              className="preview-video"
              src={previewUrl}
              controls
              playsInline
              onLoadedMetadata={handlePreviewMetadataLoaded}
              onError={() => setPreviewError("该视频暂时无法预览，请确认链接可公开访问。")}
            />
          ) : (
            <p className="muted">上传文件或输入 URL 后，系统将自动随机预览几秒片段。</p>
          )}
          {previewError && <p className="error">{previewError}</p>}
        </div>

        <div className="status-wrap">
          <div className="status-row">
            <span>状态：{STATUS_LABEL[status]}</span>
            <span>进度：{Math.round(progress)}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="muted">{statusHint}</p>
          <p className="muted">当前日期：{currentDate}</p>
          <p className="muted">提交时间：{submittedAt || "--"}</p>
          <p className="muted">来源：{sourceDesc}</p>
          {taskId && <p className="mono muted">任务 ID：{taskId}</p>}
          {error && <p className="error">{error}</p>}
        </div>
      </section>

      <section className="card workspace-bottom">
        <div className="section-head">
          <h2>多模态评分与销量预测</h2>
          <span className={`pill ${isActive ? "busy" : status === "succeeded" ? "done" : ""}`}>
            {isActive ? "分析中" : status === "succeeded" ? "已完成" : "等待任务"}
          </span>
        </div>

        {!result && (
          <div className="result-placeholder">
            <div className="pulse" />
            <h3>{isActive ? "模型正在分析直播特征..." : "暂无分析结果"}</h3>
            <p>
              {isActive
                ? "系统正在提取声音、文本、表情特征，并结合时间序列生成销量预测。"
                : "请先在上方上传直播视频或输入视频 URL。"}
            </p>
          </div>
        )}

        {result && salesForecast && (
          <>
            <div className="sales-forecast">
              <article className="forecast-main">
                <h3>预测销量</h3>
                <p className="forecast-value">{salesForecast.predictedSales.toLocaleString()}</p>
                <span
                  className={`forecast-level ${
                    salesForecast.level === "高潜力" ? "high" : salesForecast.level === "中潜力" ? "mid" : "low"
                  }`}
                >
                  {salesForecast.level}
                </span>
              </article>
              <article>
                <h3>转化率预测</h3>
                <p className="metric">{(salesForecast.conversionRate * 100).toFixed(2)}%</p>
              </article>
              <article>
                <h3>GMV 指数</h3>
                <p className="metric">{salesForecast.gmvIndex}</p>
              </article>
            </div>

            <div className="feature-radar-card">
              <h3>多特征综合雷达图</h3>
              <div className="feature-radar-layout">
                <ResponsiveContainer width="100%" height={320}>
                  <RadarChart data={featureRadarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="feature" />
                    <PolarRadiusAxis domain={[0, 100]} tickCount={6} />
                    <Tooltip formatter={(value: number) => `${value} 分`} />
                    <Radar name="特征分数" dataKey="score" stroke="#2e67ff" fill="#2e67ff" fillOpacity={0.35} />
                  </RadarChart>
                </ResponsiveContainer>
                <div className="feature-radar-list">
                  {featureScores.map((item) => (
                    <article key={item.key}>
                      <div>
                        <h4>{item.label}</h4>
                        <p>{item.desc}</p>
                      </div>
                      <strong>{(item.value * 100).toFixed(1)}分</strong>
                    </article>
                  ))}
                </div>
              </div>
            </div>

            <div className="chart-grid">
              <div className="chart-card">
                <h3>综合转化趋势</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={result.time_series}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="second" />
                    <YAxis domain={[0, 1]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" stroke="#2e67ff" strokeWidth={2.8} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-card">
                <h3>声音与文本联动</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={result.linked_metrics}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="second" />
                    <YAxis domain={[0, 1]} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="metric_a" name="声音趋势" stroke="#2e67ff" strokeWidth={2.4} dot={false} />
                    <Line type="monotone" dataKey="metric_b" name="文本趋势" stroke="#63a3ff" strokeWidth={2.4} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="heatmap-layout">
              <div className="chart-card">
                <h3>表情热力叠加</h3>
                {selectedFrame && (
                  <img
                    src={artifactUrl(selectedFrame.image_url)}
                    alt={`表情热力图（${selectedFrame.second}s）`}
                    className="heatmap-main"
                  />
                )}
              </div>
              <div className="heatmap-list">
                {result.heatmap_frames.map((frame) => (
                  <button
                    key={frame.second}
                    type="button"
                    className={frame.second === selectedFrame?.second ? "active" : ""}
                    onClick={() => setSelectedSecond(frame.second)}
                  >
                    <span>时刻 {frame.second}s</span>
                    <strong>{(frame.score * 100).toFixed(1)}%</strong>
                  </button>
                ))}
              </div>
            </div>

            <div className="chart-card recommendations">
              <h3>直播优化建议</h3>
              <ul>
                {result.recommendations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </>
        )}

        <div className="history-actions">
          <button type="button" onClick={() => setHistoryOpen(true)}>
            查看历史记录
          </button>
          <p className="muted">点击后可追溯过往分析任务。</p>
        </div>
      </section>

      {historyOpen && (
        <div className="history-modal-overlay" onClick={() => setHistoryOpen(false)}>
          <section className="history-modal" onClick={(event) => event.stopPropagation()}>
            <div className="history-modal-head">
              <h3>历史记录列表</h3>
              <button type="button" className="modal-close-btn" onClick={() => setHistoryOpen(false)}>
                关闭
              </button>
            </div>

            {historyRecords.length === 0 ? (
              <p className="muted">暂无历史记录，完成一次分析后将自动生成。</p>
            ) : (
              <div className="history-list">
                {historyRecords.map((record) => {
                  const sales = record.result.sales_forecast?.predicted_sales ?? predictSalesFallback(record.result).predictedSales;
                  return (
                    <article key={record.id} className="history-item">
                      <div>
                        <h4>{record.taskId}</h4>
                        <p className="muted">{record.submittedAt}</p>
                        <p className="muted">{record.sourceDesc}</p>
                      </div>
                      <div className="history-item-right">
                        <p>预测销量：{sales.toLocaleString()}</p>
                        <div className="history-item-actions">
                          <button type="button" className="history-link-btn" onClick={() => restoreHistory(record)}>
                            追溯查看
                          </button>
                          <button
                            type="button"
                            className="history-delete-btn"
                            onClick={() => deleteHistoryRecord(record.id)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
