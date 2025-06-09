from .client import async_log, sync_log, ContentType, async_subscribe, sync_subscribe

# Version will be synced with pyproject.toml during build
try:
    import importlib.metadata
    __version__ = importlib.metadata.version("lite-logging-client")
except ImportError:
    # Fallback for older Python versions
    try:
        import pkg_resources
        __version__ = pkg_resources.get_distribution("lite-logging-client").version
    except Exception:
        __version__ = "unknown"

__all__ = ["async_log", "sync_log", "ContentType", "async_subscribe", "sync_subscribe", "__version__"]
