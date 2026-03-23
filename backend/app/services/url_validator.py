import ipaddress
import socket
from urllib.parse import urlparse

from app.core.config import settings


class UrlValidationError(ValueError):
    pass


def _is_private_ip(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_multicast


def validate_video_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise UrlValidationError("Only http/https URLs are allowed")
    if not parsed.netloc:
        raise UrlValidationError("Invalid URL host")

    host = parsed.hostname
    if not host:
        raise UrlValidationError("Invalid URL host")

    host_lower = host.lower()
    if host_lower in {"localhost"}:
        raise UrlValidationError("Localhost is not allowed")

    if settings.allowed_domains and host_lower not in settings.allowed_domains:
        raise UrlValidationError("Domain is not in allowlist")

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise UrlValidationError("Host is not resolvable") from exc

    for info in infos:
        ip = info[4][0]
        if _is_private_ip(ip):
            raise UrlValidationError("Private/internal IP targets are not allowed")
