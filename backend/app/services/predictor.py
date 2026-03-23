import hashlib
from pathlib import Path

from app.core.config import settings


def _seed_from_file(video_path: str) -> int:
    path = Path(video_path)
    digest = hashlib.sha256(path.read_bytes()[:1024 * 1024]).hexdigest()
    return int(digest[:8], 16)


def _render_heatmap_svg(score: float) -> str:
    red = int(255 * score)
    green = int(255 * (1 - score))
    return (
        "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'>"
        f"<rect width='320' height='180' fill='rgb({red},{green},64)'/>"
        "<text x='20' y='40' fill='white' font-size='20'>Heatmap Overlay</text>"
        f"<text x='20' y='80' fill='white' font-size='16'>score={score:.2f}</text>"
        "</svg>"
    )


def run_prediction(video_path: str, task_id: str) -> dict:
    seed = _seed_from_file(video_path)
    base = (seed % 1000) / 1000
    prediction = round(0.35 + base * 0.6, 4)
    confidence = round(0.6 + (base * 0.35), 4)

    time_series = []
    linked_metrics = []
    heatmap_frames = []

    for second in range(0, 60, 5):
        value = round(max(0.0, min(1.0, prediction + ((second - 30) / 300))), 4)
        metric_a = round(max(0.0, min(1.0, value * 0.9 + 0.05)), 4)
        metric_b = round(max(0.0, min(1.0, 1 - value * 0.75)), 4)

        time_series.append({"second": second, "value": value})
        linked_metrics.append({"second": second, "metric_a": metric_a, "metric_b": metric_b})

        frame_score = round(max(0.0, min(1.0, value)), 4)
        frame_path = settings.artifact_dir / f"{task_id}_{second}.svg"
        frame_path.write_text(_render_heatmap_svg(frame_score), encoding="utf-8")
        heatmap_frames.append(
            {
                "second": second,
                "image_url": f"/artifacts/{frame_path.name}",
                "score": frame_score,
            }
        )

    recommendations = [
        "重点关注分值高峰时段（20s-40s）对应的关键帧。",
        "建议结合业务阈值设置告警线并持续观测趋势。",
        "若置信度低于0.7，建议补充更多样本后再做自动决策。",
    ]

    return {
        "prediction_value": prediction,
        "confidence": confidence,
        "time_series": time_series,
        "linked_metrics": linked_metrics,
        "heatmap_frames": heatmap_frames,
        "recommendations": recommendations,
    }
