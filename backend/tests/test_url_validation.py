import socket

import pytest

from app.services.url_validator import UrlValidationError, validate_video_url


def test_validate_video_url_accepts_public_http(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args, **kwargs: [(0, 0, 0, "", ("93.184.216.34", 0))])
    validate_video_url("https://example.com/video.mp4")


def test_validate_video_url_rejects_private_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args, **kwargs: [(0, 0, 0, "", ("127.0.0.1", 0))])
    with pytest.raises(UrlValidationError):
        validate_video_url("https://example.com/video.mp4")


def test_validate_video_url_rejects_non_http_scheme() -> None:
    with pytest.raises(UrlValidationError):
        validate_video_url("ftp://example.com/video.mp4")
