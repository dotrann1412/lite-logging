import httpx
import os
from enum import Enum
import json
from typing import Union

class ContentType(str, Enum):
    TEXT = "text"
    JSON = "json"

DEFAULT_TIMEOUT = 60
SERVER_URL = os.getenv("LITE_LOGGING_BASE_URL", "http://localhost:8080")

async def async_log(
    message: Union[str, dict], 
    tags: list[str] = [], 
    channel: str = "logs", 
    content_type: ContentType = ContentType.TEXT, 
    server_url: str = SERVER_URL
):
    if isinstance(message, dict):
        message = json.dumps(message)

    payload = {
        "data": {
            "data": message,
            "tags": tags,
            "type": content_type
        },
        "channel": channel,
        "type": "message"
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(DEFAULT_TIMEOUT)) as client:
        resp = await client.post(f"{server_url}/api/publish", json=payload)

    return resp.status_code == 200

def sync_log(
    message: Union[str, dict],
    tags: list[str] = [],
    channel: str = "logs",
    content_type: ContentType = ContentType.TEXT,
    server_url: str = SERVER_URL
):
    if isinstance(message, dict):
        message = json.dumps(message)

    payload = {
        "data": message,
        "tags": tags,
        "channel": channel,
        "content_type": content_type
    }
    
    with httpx.Client(timeout=httpx.Timeout(DEFAULT_TIMEOUT)) as client:
        resp = client.post(f"{server_url}/api/publish", json=payload)

    return resp.status_code == 200
