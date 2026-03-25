import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

const MAX_BYTES = 1024 * 1024 * 1024;
const ACTIVE_STATUS: TaskStatus[] = ["queued", "downloading", "processing"];
const HISTORY_KEY = "vp_analysis_history";
const SUPPORTED_VIDEO_SUFFIXES = [".mp4", ".mov"];

type UIStatus = TaskStatus | "idle";

type FeatureItem = {
  key: string;
  label: string;
  value: number;
  desc: string;
  tip: string;
};

type HistoryRecord = {
  id: string;
  taskId: string;
  submittedAt: string;
  sourceDesc: string;
  result: PredictionResult;
};

type MetricCard = {
  key: string;
  label: string;
  value: string;
  tip: string;
  subtext?: string;
  featured?: boolean;
};

type FunnelStep = {
  key: string;
  label: string;
  value: number;
  tip: string;
};

type ControlFactors = {
  fansCount: string;
  expectedViewers: string;
  productPrice: string;
  discountRate: string;
  historicalConversionRate: string;
  inventoryLevel: "" | "tight" | "normal" | "high";
};

type CommerceDashboard = {
  predictedSales: number;
  conversionRate: number;
  gmvIndex: number;
  level: "高潜力" | "中潜力" | "待优化";
  estimatedGmv: number;
  uvValue: number;
  gpm: number;
  exposureUsers: number;
  enteringUsers: number;
  peakOnlineUsers: number;
  avgStaySeconds: number;
  interactionRate: number;
  productClickRate: number;
  addToCartRate: number;
  productClickUsers: number;
  addToCartUsers: number;
  payingUsers: number;
  watchThroughRate: number;
  contributionRatio: number;
  controlFactorsApplied: boolean;
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

function formatDateTime(date: Date): string {
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const leftSeconds = seconds % 60;
  return `${minutes} 分 ${leftSeconds} 秒`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatCurrency(value: number): string {
  return `¥${value.toLocaleString()}`;
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
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

function getFileValidationError(file: File | null): string {
  if (!file) {
    return "";
  }

  const lowerName = file.name.toLowerCase();
  if (!SUPPORTED_VIDEO_SUFFIXES.some((suffix) => lowerName.endsWith(suffix))) {
    return "仅支持 MP4 或 MOV 文件";
  }

  if (file.size > MAX_BYTES) {
    return "文件大小不能超过 1GB";
  }

  return "";
}

function getUrlValidationError(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "仅支持 http 或 https 视频链接";
    }
    return "";
  } catch {
    return "请输入有效的视频 URL";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getNetworkErrorMessage(error: unknown): string {
  if (!navigator.onLine) {
    return "网络异常，请检查网络连接后重试";
  }

  if (isAbortError(error)) {
    return "";
  }

  if (error instanceof TypeError) {
    return "网络请求失败，请稍后重试";
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("load failed")) {
      return "网络请求失败，请稍后重试";
    }
  }

  return "";
}

function MetricHint({ label, tip, light = false }: { label: string; tip: string; light?: boolean }): JSX.Element {
  return (
    <span className={`metric-hint ${light ? "metric-hint-light" : ""}`} tabIndex={0}>
      <span>{label}</span>
      <span className="metric-hint-icon">i</span>
      <span className="metric-hint-popup">{tip}</span>
    </span>
  );
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
  const [remainingTime, setRemainingTime] = useState("");
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
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [controlModalOpen, setControlModalOpen] = useState(false);
  const [controlFactors, setControlFactors] = useState<ControlFactors>({
    fansCount: "",
    expectedViewers: "",
    productPrice: "",
    discountRate: "",
    historicalConversionRate: "",
    inventoryLevel: ""
  });

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const analysisControllerRef = useRef<AbortController | null>(null);

  const mockMode = isMockModeEnabled();
  const currentDate = useMemo(() => new Date().toLocaleDateString("zh-CN"), []);
  const fileValidationError = useMemo(() => getFileValidationError(file), [file]);
  const urlValidationError = useMemo(() => getUrlValidationError(url), [url]);
  const controlFactorCount = useMemo(
    () =>
      Object.values(controlFactors).filter((value) => {
        if (typeof value !== "string") {
          return false;
        }
        return value.trim().length > 0;
      }).length,
    [controlFactors]
  );
  const hasControlFactors = controlFactorCount > 0;

  const canStartAnalysis =
    !loading && !isOffline && (mode === "file" ? Boolean(file) && !fileValidationError : Boolean(url.trim()) && !urlValidationError);

  useEffect(() => {
    setHistoryRecords(loadHistoryRecords());
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => {
      setIsOffline(true);
      setError("网络异常，请检查网络连接后重试");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    if (mode === "file") {
      if (!file || fileValidationError) {
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
    if (trimmed && !urlValidationError) {
      setPreviewUrl(trimmed);
      setPreviewStartSecond(null);
      setPreviewError("");
      return;
    }

    setPreviewUrl("");
    setPreviewStartSecond(null);
    setPreviewError("");
  }, [file, fileValidationError, mode, url, urlValidationError]);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
      }
      analysisControllerRef.current?.abort();
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
    const visualScore = fromModel?.visual_score ?? Math.max(...result.time_series.map((item) => item.value));

    return [
      {
        key: "voice",
        label: "声音表现分",
        value: voiceScore,
        desc: "语速节奏、情绪感染力、强调力度",
        tip: "平台通常会把主播语调、节奏和感染力作为互动与下单驱动因素之一。"
      },
      {
        key: "text",
        label: "文本话术分",
        value: textScore,
        desc: "卖点表达、促单语句、关键词质量",
        tip: "反映直播间话术结构、卖点输出和促单表达的完整度。"
      },
      {
        key: "visual",
        label: "视觉表现分",
        value: visualScore,
        desc: "画面构图、镜头稳定性、商品展示质量",
        tip: "对应直播画面质量、商品展示效率和镜头调度等视觉因素。"
      }
    ];
  }, [result]);

  const featureRadarData = useMemo(
    () =>
      featureScores.map((item) => ({
        feature: item.label,
        score: Number((item.value * 100).toFixed(1))
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

  const commerceDashboard = useMemo<CommerceDashboard | null>(() => {
    if (!result || !salesForecast) {
      return null;
    }

    const averageScore = average(featureScores.map((item) => item.value));
    const fansCount = parseOptionalNumber(controlFactors.fansCount);
    const expectedViewers = parseOptionalNumber(controlFactors.expectedViewers);
    const productPrice = parseOptionalNumber(controlFactors.productPrice);
    const discountRate = parseOptionalNumber(controlFactors.discountRate);
    const historicalConversionRate = parseOptionalNumber(controlFactors.historicalConversionRate);

    const controlFactorsApplied =
      fansCount !== null ||
      expectedViewers !== null ||
      productPrice !== null ||
      discountRate !== null ||
      historicalConversionRate !== null ||
      Boolean(controlFactors.inventoryLevel);

    const inventoryFactor =
      controlFactors.inventoryLevel === "tight" ? 0.95 : controlFactors.inventoryLevel === "high" ? 1.06 : 1;
    const fanFactor = fansCount !== null ? Math.min(Math.max(fansCount / 50000, 0.6), 2.1) : 1;
    const viewFactor = expectedViewers !== null ? Math.min(Math.max(expectedViewers / 9000, 0.6), 2.3) : 1;
    const discountFactor = discountRate !== null ? 1 + Math.min(Math.max(discountRate, 0), 90) / 220 : 1;
    const priceFactor = productPrice !== null ? Math.min(Math.max(productPrice / 129, 0.55), 2.4) : 1;

    const contentContributionRatio = Number(
      Math.min(0.95, averageScore * 0.58 + result.confidence * 0.3 + (featureScores[1]?.value ?? averageScore) * 0.12).toFixed(4)
    );

    const baseExposureUsers = Math.round(30000 + result.confidence * 18000 + salesForecast.predictedSales * 3.2);
    const exposureUsers =
      fansCount !== null
        ? Math.round((fansCount * 0.42 + baseExposureUsers * 0.58) * discountFactor * inventoryFactor)
        : Math.round(baseExposureUsers * fanFactor * discountFactor * inventoryFactor);
    const enteringUsers =
      expectedViewers !== null
        ? Math.round(expectedViewers)
        : Math.round(exposureUsers * (0.17 + averageScore * 0.19) * Math.min(viewFactor, 1.6));
    const peakOnlineUsers = Math.round(enteringUsers * (0.09 + result.confidence * 0.05));
    const avgStaySeconds = Math.round(26 + averageScore * 34 + result.confidence * 12);
    const interactionRate = Number((0.032 + (featureScores[0]?.value ?? averageScore) * 0.085).toFixed(4));
    const productClickRate = Number(
      (0.038 + (featureScores[1]?.value ?? averageScore) * 0.085 + (featureScores[2]?.value ?? averageScore) * 0.03).toFixed(4)
    );
    const addToCartRate = Number((productClickRate * 0.38 + (featureScores[0]?.value ?? averageScore) * 0.012).toFixed(4));
    const calibratedConversionRate =
      historicalConversionRate !== null
        ? Number(((salesForecast.conversionRate * 0.55 + historicalConversionRate / 100 * 0.45) * discountFactor * inventoryFactor).toFixed(4))
        : Number((salesForecast.conversionRate * discountFactor * inventoryFactor).toFixed(4));
    const payingUsers = Math.max(1, Math.round(enteringUsers * Math.min(calibratedConversionRate, 0.38)));
    const productClickUsers = Math.max(payingUsers, Math.round(enteringUsers * productClickRate));
    const addToCartUsers = Math.max(payingUsers, Math.round(enteringUsers * addToCartRate));
    const watchThroughRate = Number((0.22 + (featureScores[2]?.value ?? averageScore) * 0.31).toFixed(4));
    const estimatedGmv = Math.round(
      payingUsers * (productPrice !== null ? productPrice : 86 + averageScore * 46) * Math.max(priceFactor, 0.75)
    );
    const uvValue = Number((estimatedGmv / Math.max(enteringUsers, 1)).toFixed(2));
    const gpm = Number(((estimatedGmv / Math.max(enteringUsers, 1)) * 1000).toFixed(1));

    return {
      predictedSales: payingUsers,
      conversionRate: Math.min(calibratedConversionRate, 0.38),
      gmvIndex: salesForecast.gmvIndex,
      level: salesForecast.level,
      estimatedGmv,
      uvValue,
      gpm,
      exposureUsers,
      enteringUsers,
      peakOnlineUsers,
      avgStaySeconds,
      interactionRate,
      productClickRate,
      addToCartRate,
      productClickUsers,
      addToCartUsers,
      payingUsers,
      watchThroughRate,
      contributionRatio: contentContributionRatio,
      controlFactorsApplied
    };
  }, [controlFactors, featureScores, result, salesForecast]);

  const overviewMetrics = useMemo<MetricCard[]>(() => {
    if (!commerceDashboard) {
      return [];
    }

    if (!commerceDashboard.controlFactorsApplied) {
      return [
        {
          key: "contribution",
          label: "内容贡献比例",
          value: formatPercent(commerceDashboard.contributionRatio),
          tip: "当未补充粉丝量、场观、价格等外部经营因素时，系统展示内容质量对销量形成的贡献占比。",
          subtext: `潜力等级：${commerceDashboard.level}`,
          featured: true
        },
        {
          key: "conversion",
          label: "成交转化率",
          value: formatPercent(commerceDashboard.conversionRate),
          tip: "进入直播间的观众中，最终完成下单的人数占比。"
        },
        {
          key: "uv-value",
          label: "UV 价值",
          value: `¥${commerceDashboard.uvValue}`,
          tip: "每位进入直播间访客平均带来的成交金额，常用于评估流量质量。"
        },
        {
          key: "gpm",
          label: "千次观看成交额 GPM",
          value: `¥${commerceDashboard.gpm.toLocaleString()}`,
          tip: "每千次观看带来的成交金额，用于比较不同场次的流量变现效率。"
        }
      ];
    }

    return [
      {
        key: "gmv",
        label: "预估 GMV",
        value: formatCurrency(commerceDashboard.estimatedGmv),
        tip: "GMV 指直播间预计成交总额，是商家后台最常用的成交规模指标。",
        subtext: `潜力等级：${commerceDashboard.level}`,
        featured: true
      },
      {
        key: "sales",
        label: "预估销量",
        value: commerceDashboard.predictedSales.toLocaleString(),
        tip: "预测周期内的预计成交件数，用于衡量商品动销能力。"
      },
      {
        key: "conversion",
        label: "成交转化率",
        value: formatPercent(commerceDashboard.conversionRate),
        tip: "进入直播间的观众中，最终完成下单的人数占比。"
      },
      {
        key: "uv-value",
        label: "UV 价值",
        value: `¥${commerceDashboard.uvValue}`,
        tip: "每位进入直播间访客平均带来的成交金额，常用于评估流量质量。"
      }
    ];
  }, [commerceDashboard]);

  const efficiencyMetrics = useMemo<MetricCard[]>(() => {
    if (!commerceDashboard) {
      return [];
    }

    return [
      { key: "exposure", label: "累计曝光人数", value: commerceDashboard.exposureUsers.toLocaleString(), tip: "直播内容在推荐、关注、店铺等入口被看到的人数规模。" },
      { key: "entering", label: "进入观看人数", value: commerceDashboard.enteringUsers.toLocaleString(), tip: "实际进入直播间并产生观看行为的人数，是进房口径核心指标。" },
      { key: "peak-online", label: "峰值在线人数", value: commerceDashboard.peakOnlineUsers.toLocaleString(), tip: "直播过程中同时在线人数的峰值，用于判断流量爆发时刻。" },
      { key: "stay", label: "平均停留时长", value: formatDuration(commerceDashboard.avgStaySeconds), tip: "用户在直播间的人均停留时间，停留越长通常说明内容承接越强。" },
      { key: "interaction", label: "互动率", value: formatPercent(commerceDashboard.interactionRate), tip: "评论、点赞、关注、分享等互动动作占观看人数的比例。" },
      { key: "click", label: "商品点击率", value: formatPercent(commerceDashboard.productClickRate), tip: "观看用户中点击商品卡、讲解卡或购物袋的人数占比。" },
      { key: "cart", label: "加购率", value: formatPercent(commerceDashboard.addToCartRate), tip: "观看用户中把商品加入购物车的人数占比，反映购买意向强度。" },
      { key: "gpm", label: "千次观看成交额 GPM", value: `¥${commerceDashboard.gpm.toLocaleString()}`, tip: "每千次观看带来的成交金额，用于比较不同场次的流量变现效率。" }
    ];
  }, [commerceDashboard]);

  const funnelSteps = useMemo<FunnelStep[]>(() => {
    if (!commerceDashboard) {
      return [];
    }

    return [
      { key: "expo", label: "曝光", value: commerceDashboard.exposureUsers, tip: "直播内容被平台推荐或被用户看到的基础流量规模。" },
      { key: "view", label: "进房", value: commerceDashboard.enteringUsers, tip: "从曝光到真正进入直播间观看的人数。" },
      { key: "click", label: "点击商品", value: commerceDashboard.productClickUsers, tip: "进入直播间后点击商品卡或购物袋的人数。" },
      { key: "cart", label: "加入购物车", value: commerceDashboard.addToCartUsers, tip: "已表现出明确购买意图、把商品加入购物车的人数。" },
      { key: "pay", label: "成交支付", value: commerceDashboard.payingUsers, tip: "最终完成支付的人数，是漏斗最后一层。" }
    ];
  }, [commerceDashboard]);

  const trendData = useMemo(() => {
    if (!result || !commerceDashboard) {
      return [];
    }

    return result.time_series.map((point, index) => {
      const linked = result.linked_metrics[index] ?? result.linked_metrics[result.linked_metrics.length - 1];
      const trafficHeat = Math.round(point.value * commerceDashboard.peakOnlineUsers);
      const interactionRate = Number((linked.metric_a * 0.11).toFixed(4));
      const clickRate = Number((linked.metric_b * 0.1).toFixed(4));
      const conversionRate = Number(Math.min(clickRate * 0.48 + commerceDashboard.conversionRate * 0.62, 0.32).toFixed(4));
      const gmvPerMinute = Math.round(point.value * commerceDashboard.estimatedGmv * 0.055);

      return {
        second: point.second,
        trafficHeat,
        interactionRate: Number((interactionRate * 100).toFixed(2)),
        clickRate: Number((clickRate * 100).toFixed(2)),
        conversionRate: Number((conversionRate * 100).toFixed(2)),
        gmvPerMinute
      };
    });
  }, [commerceDashboard, result]);

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
    setRemainingTime("");
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

  const resetAnalysisState = (preserveError = false) => {
    analysisControllerRef.current?.abort();
    analysisControllerRef.current = null;

    setTaskId("");
    setStatus("idle");
    setProgress(0);
    setRemainingTime("");
    setStatusHint("请先在上方提交直播视频任务。");
    setResult(null);
    setSelectedSecond(null);
    setSubmittedAt("");
    setSourceDesc("尚未提交任务");
    setLoading(false);

    if (!preserveError) {
      setError("");
    }
  };

  const handleCancelAnalysis = () => {
    resetAnalysisState();
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
      // browser autoplay can be blocked
    });

    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
    }

    previewTimerRef.current = window.setTimeout(() => {
      video.pause();
    }, 3500);
  };

  const runMockFlow = async (
    sourceType: SourceType,
    sourceId: string,
    finalSourceDesc: string,
    finalSubmittedAt: string,
    controller: AbortController
  ): Promise<void> => {
    const generated = await simulatePrediction(
      sourceType,
      sourceId,
      (payload) => {
        setStatus(payload.status);
        setProgress(payload.progress);
        setStatusHint(payload.label);
        const remainingSeconds = Math.max(1, Math.ceil(((100 - payload.progress) / 100) * 4));
        setRemainingTime(`约 ${remainingSeconds} 秒`);
      },
      controller.signal
    );

    const generatedTaskId = `mock-${Math.random().toString(16).slice(2, 10)}`;
    setTaskId(generatedTaskId);
    setResult(generated);
    setStatus("succeeded");
    setProgress(100);
    setRemainingTime("");
    setStatusHint("分析完成，已生成经营分析看板与销量预测。");
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
    finalSubmittedAt: string,
    controller: AbortController
  ): Promise<void> => {
    const created =
      sourceType === "file" && file
        ? await uploadVideo(file, controller.signal)
        : await createTaskByUrl(url.trim(), controller.signal);

    setTaskId(created.task_id);
    setStatus(created.status);
    setProgress(8);
    setRemainingTime("计算中");

    while (!controller.signal.aborted) {
      await sleep(2000);
      const task = await fetchTask(created.task_id, controller.signal);
      setStatus(task.status);
      setProgress(task.progress);
      setStatusHint(`任务状态：${STATUS_LABEL[task.status]}`);

      if (task.progress > 0 && task.progress < 100) {
        const remainingSeconds = Math.max(1, Math.ceil(((100 - task.progress) / 100) * 20));
        setRemainingTime(`约 ${remainingSeconds} 秒`);
      } else {
        setRemainingTime("");
      }

      if (task.status === "failed") {
        throw new Error(task.error_message ?? "分析失败");
      }

      if (task.status === "succeeded") {
        const taskResult = await fetchTaskResult(created.task_id, controller.signal);
        if (!taskResult.result) {
          throw new Error("任务已完成，但未返回结果数据");
        }

        setResult(taskResult.result);
        setStatus("succeeded");
        setProgress(100);
        setRemainingTime("");
        setStatusHint("分析完成，已生成经营分析看板与销量预测。");
        setSelectedSecond(taskResult.result.heatmap_frames[0]?.second ?? null);

        appendHistory({
          id: `${Date.now()}-${created.task_id}`,
          taskId: created.task_id,
          submittedAt: finalSubmittedAt,
          sourceDesc: finalSourceDesc,
          result: taskResult.result
        });
        return;
      }
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canStartAnalysis) {
      return;
    }

    if (!navigator.onLine) {
      setError("网络异常，请检查网络连接后重试");
      return;
    }

    setError("");
    setResult(null);
    setProgress(0);
    setTaskId("");
    setSelectedSecond(null);
    setLoading(true);

    const submitDate = formatDateTime(new Date());
    const controller = new AbortController();
    analysisControllerRef.current = controller;

    setSubmittedAt(submitDate);
    setRemainingTime("计算中");

    try {
      const payload = mode === "file" && file ? { sourceType: "file" as const, sourceId: `${file.name}-${file.size}` } : { sourceType: "url" as const, sourceId: url.trim() };
      const nextSourceDesc = payload.sourceType === "file" ? `本地文件：${file?.name ?? ""}` : `URL：${url.trim()}`;
      setSourceDesc(nextSourceDesc);

      if (mockMode) {
        await runMockFlow(payload.sourceType, payload.sourceId, nextSourceDesc, submitDate, controller);
      } else {
        await runServerFlow(payload.sourceType, nextSourceDesc, submitDate, controller);
      }
    } catch (err) {
      if (isAbortError(err)) {
        resetAnalysisState();
        return;
      }

      const networkMessage = getNetworkErrorMessage(err);
      resetAnalysisState(true);
      setStatus("failed");
      setError(networkMessage || (err instanceof Error ? err.message : "任务启动失败"));
      setStatusHint(networkMessage || "分析失败，请修正问题后重试。");
    } finally {
      analysisControllerRef.current = null;
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
            <p className="muted">上传直播视频后，系统将输出声音、文本、视觉特征评分及经营分析指标。</p>
          </div>
          <span className="tag-chip">{mockMode ? "演示模式" : "后端模式"}</span>
        </div>

        {isOffline && <p className="error">当前网络不可用，联网后才能开始分析。</p>}

        <div className="segmented">
          <button type="button" className={mode === "file" ? "active" : ""} onClick={() => setMode("file")} disabled={loading}>
            上传本地 MP4/MOV
          </button>
          <button type="button" className={mode === "url" ? "active" : ""} onClick={() => setMode("url")} disabled={loading}>
            输入视频 URL
          </button>
        </div>

        <form className="upload-form" onSubmit={onSubmit}>
          {mode === "file" ? (
            <label>
              选择直播视频（支持 MP4/MOV，最大 1GB）
              <input
                type="file"
                accept="video/mp4,.mp4,video/quicktime,.mov"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                disabled={loading}
              />
              {fileHint && <div className="muted">{fileHint}</div>}
              {fileValidationError && <p className="error">{fileValidationError}</p>}
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
                disabled={loading}
              />
              {urlValidationError && <p className="error">{urlValidationError}</p>}
            </label>
          )}

          <div className="action-row">
            <button type="submit" disabled={!canStartAnalysis}>
              开始分析
            </button>
            <button type="button" className="ghost-btn" onClick={() => setControlModalOpen(true)} disabled={loading}>
              补充经营因素
            </button>
            {loading && (
              <button type="button" className="secondary-btn" onClick={handleCancelAnalysis}>
                取消分析
              </button>
            )}
          </div>
          <p className="muted control-factor-note">
            可选补充粉丝量、场观、价格、折扣等经营变量。
            {hasControlFactors
              ? ` 当前已填写 ${controlFactorCount} 项，核心指标将按经营预测口径展示。`
              : " 若不填写，核心指标将展示内容对销量的贡献比例。"}
          </p>
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
              onError={() => setPreviewError("该视频暂时无法预览，请确认文件完整或链接可访问。")}
            />
          ) : (
            <p className="muted">上传有效视频或输入有效 URL 后，系统会自动随机预览几秒片段。</p>
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
          <p className="muted">剩余时长：{remainingTime || "--"}</p>
          <p className="muted">当前日期：{currentDate}</p>
          <p className="muted">提交时间：{submittedAt || "--"}</p>
          <p className="muted">来源：{sourceDesc}</p>
          {taskId && <p className="mono muted">任务 ID：{taskId}</p>}
          {error && <p className="error">{error}</p>}
        </div>
      </section>

      <section className="card workspace-bottom">
        <div className="section-head">
          <div>
            <h2>直播经营分析看板</h2>
            <p className="muted">参考直播电商常见的流量、互动、转化、成交复盘口径进行展示。</p>
          </div>
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
                ? "系统正在提取声音、文本、视觉特征，并结合流量与成交口径生成经营分析看板。"
                : "请先在上方上传直播视频或输入视频 URL。"}
            </p>
          </div>
        )}

        {result && commerceDashboard && (
          <>
            <div className="overview-grid">
              {overviewMetrics.map((item) => (
                <article key={item.key} className={`overview-card ${item.featured ? "overview-card-featured" : ""}`}>
                  <h3>
                    <MetricHint label={item.label} tip={item.tip} light={item.featured} />
                  </h3>
                  <p className={item.featured ? "overview-value overview-value-light" : "overview-value"}>{item.value}</p>
                  {item.subtext && <p className={item.featured ? "overview-subtext overview-subtext-light" : "overview-subtext"}>{item.subtext}</p>}
                </article>
              ))}
            </div>

            <div className="funnel-card">
              <div className="section-subhead">
                <h3>直播转化漏斗</h3>
                <p className="muted">按照曝光、进房、点击、加购、成交的典型直播电商链路展示。</p>
              </div>
              <div className="funnel-grid">
                {funnelSteps.map((step, index) => {
                  const base = funnelSteps[0]?.value || 1;
                  const ratio = Math.max(step.value / base, 0.08);
                  return (
                    <article key={step.key} className="funnel-step" style={{ ["--funnel-ratio" as string]: ratio } as CSSProperties}>
                      <div className="funnel-step-head">
                        <MetricHint label={step.label} tip={step.tip} />
                        <span className="funnel-step-index">0{index + 1}</span>
                      </div>
                      <strong>{step.value.toLocaleString()}</strong>
                      <div className="funnel-bar">
                        <div className="funnel-bar-fill" />
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="feature-radar-card">
              <div className="section-subhead">
                <h3>多特征综合雷达图</h3>
                <p className="muted">保留内容质量侧的声音、文本、视觉三类模型评分。</p>
              </div>
              <div className="feature-radar-layout">
                <ResponsiveContainer width="100%" height={320}>
                  <RadarChart data={featureRadarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="feature" />
                    <PolarRadiusAxis domain={[0, 100]} tickCount={6} />
                    <Tooltip formatter={(value: number | string) => `${value} 分`} />
                    <Radar name="特征分数" dataKey="score" stroke="#2e67ff" fill="#2e67ff" fillOpacity={0.35} />
                  </RadarChart>
                </ResponsiveContainer>
                <div className="feature-radar-list">
                  {featureScores.map((item) => (
                    <article key={item.key}>
                      <div>
                        <h4>
                          <MetricHint label={item.label} tip={item.tip} />
                        </h4>
                        <p>{item.desc}</p>
                      </div>
                      <strong>{(item.value * 100).toFixed(1)}分</strong>
                    </article>
                  ))}
                </div>
              </div>
            </div>

            <div className="efficiency-card">
              <div className="section-subhead">
                <h3>流量与成交效率指标</h3>
                <p className="muted">按直播复盘常见的流量承接、用户停留、点击和成交效率口径组织。</p>
              </div>
              <div className="efficiency-grid">
                {efficiencyMetrics.map((item) => (
                  <article key={item.key} className="efficiency-item">
                    <h4>
                      <MetricHint label={item.label} tip={item.tip} />
                    </h4>
                    <p className="metric">{item.value}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="chart-grid">
              <div className="chart-card">
                <h3>
                  <MetricHint label="流量热度与单分钟 GMV 趋势" tip="同时观察观看热度和单位时间成交额，便于定位高价值讲解时段。" />
                </h3>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="second" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="trafficHeat" name="观看热度" stroke="#2e67ff" strokeWidth={2.4} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="gmvPerMinute" name="单分钟 GMV" stroke="#20a579" strokeWidth={2.4} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-card">
                <h3>
                  <MetricHint label="互动-点击-成交联动" tip="用互动率、商品点击率和成交转化率的动态变化判断内容承接效率。" />
                </h3>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="second" />
                    <YAxis domain={[0, 20]} unit="%" />
                    <Tooltip formatter={(value: number | string) => `${value}%`} />
                    <Legend />
                    <Line type="monotone" dataKey="interactionRate" name="互动率" stroke="#2e67ff" strokeWidth={2.2} dot={false} />
                    <Line type="monotone" dataKey="clickRate" name="商品点击率" stroke="#63a3ff" strokeWidth={2.2} dot={false} />
                    <Line type="monotone" dataKey="conversionRate" name="成交转化率" stroke="#ff8b3d" strokeWidth={2.2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="heatmap-layout">
              <div className="chart-card">
                <h3>
                  <MetricHint label="视觉热力图" tip="突出画面中可能影响成交的高注意力区域，用于辅助复盘镜头和商品展示。" />
                </h3>
                {selectedFrame && (
                  <img src={artifactUrl(selectedFrame.image_url)} alt={`视觉热力图（${selectedFrame.second}s）`} className="heatmap-main" />
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
              <h3>
                <MetricHint label="直播优化建议" tip="结合当前预测结果，输出可用于直播脚本、货盘和镜头调度优化的建议。" />
              </h3>
              <ul>
                <li>建议在高热度时段加大福利口播和限时转化动作，承接峰值流量。</li>
                <li>商品点击率和加购率适合作为复盘重点，重点检查讲解节点与购物袋切换节奏。</li>
                <li>视觉热力区域可用于优化商品特写、主播站位和镜头稳定性。</li>
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

      {controlModalOpen && (
        <div className="history-modal-overlay" onClick={() => setControlModalOpen(false)}>
          <section className="history-modal control-modal" onClick={(event) => event.stopPropagation()}>
            <div className="history-modal-head">
              <div>
                <h3>补充经营因素</h3>
                <p className="muted">这些变量常用于直播电商复盘，可选填写，用于校正销量与成交预测。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setControlModalOpen(false)}>
                关闭
              </button>
            </div>

            <div className="control-factor-grid">
              <label>
                粉丝量
                <input
                  type="number"
                  min="0"
                  placeholder="例如：150000"
                  value={controlFactors.fansCount}
                  onChange={(event) => setControlFactors((prev) => ({ ...prev, fansCount: event.target.value }))}
                />
              </label>

              <label>
                预期场观人数
                <input
                  type="number"
                  min="0"
                  placeholder="例如：12000"
                  value={controlFactors.expectedViewers}
                  onChange={(event) => setControlFactors((prev) => ({ ...prev, expectedViewers: event.target.value }))}
                />
              </label>

              <label>
                商品价格
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="例如：199"
                  value={controlFactors.productPrice}
                  onChange={(event) => setControlFactors((prev) => ({ ...prev, productPrice: event.target.value }))}
                />
              </label>

              <label>
                优惠力度（%）
                <input
                  type="number"
                  min="0"
                  max="90"
                  placeholder="例如：20"
                  value={controlFactors.discountRate}
                  onChange={(event) => setControlFactors((prev) => ({ ...prev, discountRate: event.target.value }))}
                />
              </label>

              <label>
                历史转化率（%）
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="例如：6.5"
                  value={controlFactors.historicalConversionRate}
                  onChange={(event) =>
                    setControlFactors((prev) => ({ ...prev, historicalConversionRate: event.target.value }))
                  }
                />
              </label>

              <label>
                库存充足度
                <select
                  value={controlFactors.inventoryLevel}
                  onChange={(event) =>
                    setControlFactors((prev) => ({
                      ...prev,
                      inventoryLevel: event.target.value as ControlFactors["inventoryLevel"]
                    }))
                  }
                >
                  <option value="">未填写</option>
                  <option value="tight">偏紧</option>
                  <option value="normal">正常</option>
                  <option value="high">充足</option>
                </select>
              </label>
            </div>

            <div className="control-factor-tips">
              <p className="muted">参考口径：粉丝量、场观、价格、优惠和库存通常会影响直播间的流量承接与成交效率。</p>
            </div>

            <div className="control-factor-actions">
              <button type="button" className="ghost-btn" onClick={() => setControlFactors({
                fansCount: "",
                expectedViewers: "",
                productPrice: "",
                discountRate: "",
                historicalConversionRate: "",
                inventoryLevel: ""
              })}>
                清空
              </button>
              <button type="button" onClick={() => setControlModalOpen(false)}>
                保存并关闭
              </button>
            </div>
          </section>
        </div>
      )}

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
                          <button type="button" className="history-delete-btn" onClick={() => deleteHistoryRecord(record.id)}>
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

