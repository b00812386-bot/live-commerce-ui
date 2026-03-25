from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile

from app.routers.videos import _validate_video_file


def _make_upload(filename: str, content_type: str) -> UploadFile:
    return UploadFile(file=BytesIO(b"fake-bytes"), filename=filename, headers={"content-type": content_type})


def test_validate_video_file_accepts_mp4_file() -> None:
    file = _make_upload("input.mp4", "video/mp4")
    _validate_video_file(file)


def test_validate_video_file_accepts_mov_file() -> None:
    file = _make_upload("input.mov", "video/quicktime")
    _validate_video_file(file)


def test_validate_video_file_rejects_wrong_extension() -> None:
    file = _make_upload("input.avi", "video/mp4")
    with pytest.raises(HTTPException):
        _validate_video_file(file)


def test_validate_video_file_rejects_wrong_content_type() -> None:
    file = _make_upload("input.mp4", "application/json")
    with pytest.raises(HTTPException):
        _validate_video_file(file)
