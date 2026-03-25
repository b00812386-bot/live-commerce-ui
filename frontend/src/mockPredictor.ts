import type { PredictionResult, SourceType, TaskStatus } from "./types";

type ProgressStep = {
  status: TaskStatus;
  progress: number;
  label: string;
  waitMs: number;
};

export type MockProgress = {
  status: TaskStatus;
  progress: number;
  label: string;
};

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("分析已取消", "AbortError");
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new DOMException("分析已取消", "AbortError"));
    };

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort);
  });
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function createHeatmapDataUrl(score: number, second: number): string {
  const opacity = (0.22 + score * 0.48).toFixed(2);
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="720" height="405" viewBox="0 0 720 405">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0d2e6d"/>
        <stop offset="100%" stop-color="#123d91"/>
      </linearGradient>
      <radialGradient id="heat" cx="${0.36 + (second % 8) / 20}" cy="${0.4 + (second % 13) / 24}" r="0.48">
        <stop offset="0%" stop-color="rgba(255, 148, 63, ${opacity})"/>
        <stop offset="100%" stop-color="rgba(255, 148, 63, 0)"/>
      </radialGradient>
    </defs>
    <rect width="720" height="405" fill="url(#bg)" />
    <rect width="720" height="405" fill="url(#heat)" />
    <text x="30" y="44" fill="#f7f9ff" font-size="25" font-family="Sora, sans-serif">直播画面视觉热力图</text>
    <text x="30" y="80" fill="#d7e4ff" font-size="18" font-family="Sora, sans-serif">时刻 ${second}s | 强度 ${score.toFixed(2)}</text>
  </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function simulatePrediction(
  sourceType: SourceType,
  sourceId: string,
  onProgress: (payload: MockProgress) => void,
  signal?: AbortSignal
): Promise<PredictionResult> {
  const steps: ProgressStep[] =
    sourceType === "url"
      ? [
          { status: "queued", progress: 8, label: "任务已提交，正在排队", waitMs: 500 },
          { status: "downloading", progress: 26, label: "正在拉取直播回放视频", waitMs: 1300 },
          { status: "processing", progress: 64, label: "多模态特征分析中（声音/文本/视觉）", waitMs: 1500 },
          { status: "processing", progress: 90, label: "正在生成销量预测与可视化图表", waitMs: 950 }
        ]
      : [
          { status: "queued", progress: 10, label: "任务已提交，正在排队", waitMs: 500 },
          { status: "processing", progress: 58, label: "多模态特征分析中（声音/文本/视觉）", waitMs: 1500 },
          { status: "processing", progress: 90, label: "正在生成销量预测与可视化图表", waitMs: 950 }
        ];

  for (const step of steps) {
    abortIfNeeded(signal);
    onProgress({ status: step.status, progress: step.progress, label: step.label });
    await sleep(step.waitMs, signal);
  }

  abortIfNeeded(signal);

  const seed = hashSeed(sourceId);
  const voiceScore = Number((0.62 + (seed % 24) / 100).toFixed(4));
  const textScore = Number((0.58 + ((seed >> 4) % 30) / 100).toFixed(4));
  const visualScore = Number((0.55 + ((seed >> 7) % 32) / 100).toFixed(4));

  const fusedScore = Number((voiceScore * 0.34 + textScore * 0.38 + visualScore * 0.28).toFixed(4));
  const confidence = Number((0.72 + ((seed >> 10) % 18) / 100).toFixed(4));

  const timeSeries: PredictionResult["time_series"] = [];
  const linkedMetrics: PredictionResult["linked_metrics"] = [];
  const heatmapFrames: PredictionResult["heatmap_frames"] = [];

  for (let second = 0; second <= 60; second += 5) {
    const wave = Math.sin((second / 60) * Math.PI * 2 + ((seed % 7) * Math.PI) / 8) * 0.07;
    const trend = Math.max(0.2, Math.min(0.98, fusedScore + wave + second / 520));
    const metricA = Math.max(0.12, Math.min(0.99, voiceScore + wave * 0.6));
    const metricB = Math.max(0.12, Math.min(0.99, textScore + wave * 0.45));

    timeSeries.push({ second, value: Number(trend.toFixed(4)) });
    linkedMetrics.push({
      second,
      metric_a: Number(metricA.toFixed(4)),
      metric_b: Number(metricB.toFixed(4))
    });
    heatmapFrames.push({
      second,
      score: Number((visualScore + wave * 0.5).toFixed(4)),
      image_url: createHeatmapDataUrl(visualScore, second)
    });
  }

  const predictedSales = Math.round(1200 + fusedScore * 7600 + confidence * 1500);
  const conversionRate = Number((0.018 + fusedScore * 0.042).toFixed(4));
  const gmvIndex = Math.round((fusedScore * 100 + confidence * 50) * 1.1);

  let level: "高潜力" | "中潜力" | "待优化" = "待优化";
  if (predictedSales >= 7000) {
    level = "高潜力";
  } else if (predictedSales >= 4200) {
    level = "中潜力";
  }

  return {
    prediction_value: fusedScore,
    confidence,
    time_series: timeSeries,
    linked_metrics: linkedMetrics,
    heatmap_frames: heatmapFrames,
    multi_feature_scores: {
      voice_score: voiceScore,
      text_score: textScore,
      visual_score: visualScore
    },
    sales_forecast: {
      predicted_sales: predictedSales,
      conversion_rate: conversionRate,
      gmv_index: gmvIndex,
      level
    },
    recommendations: [
      "声音活力分偏高，建议在高峰时段增加限时口播和福利强调。",
      "文本表达可再强化促单关键词，提升“限量”“仅此一场”等文案密度。",
      "视觉表现与销量预测正相关，建议优化灯光、画面构图和商品特写切换。"
    ]
  };
}
