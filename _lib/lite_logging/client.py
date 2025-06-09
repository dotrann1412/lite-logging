import httpx
import os
from enum import Enum
import json
from typing import Union
from typing import AsyncGenerator, Generator

class ContentType(str, Enum):
    TEXT = "text"
    JSON = "json"

DEFAULT_TIMEOUT = 60
SERVER_URL = os.getenv("LITE_LOGGING_BASE_URL", "http://localhost:8080")

async def async_log(
    message: Union[str, dict], 
    tags: list[str] = [], 
    channel: str = "default", 
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
    channel: str = "default",
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


def decode_message(message: str):
    _type, _payload = message.split(": ", maxsplit=1)
    return _type, _payload

async def async_subscribe(
    channel: str,
    server_url: str = SERVER_URL,
    no_except: bool = True
) -> AsyncGenerator[dict, None]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(DEFAULT_TIMEOUT)) as client:
        async with client.stream("GET", f"{server_url}/api/subscribe?channels={channel}") as response:
            async for line in response.aiter_lines():
                if line:
                    _type, _payload = decode_message(line)

                    if _type == "data":
                        try:
                            yield json.loads(_payload)

                        except json.JSONDecodeError as err:
                            if not no_except:
                                raise json.JSONDecodeError(f"Invalid JSON: {_payload!r} ({str(err)})")

def sync_subscribe(
    channel: str,
    server_url: str = SERVER_URL,
    no_except: bool = True
) -> Generator[dict, None, None]:
    with httpx.Client(timeout=httpx.Timeout(DEFAULT_TIMEOUT)) as client:
        with client.stream("GET", f"{server_url}/api/subscribe?channels={channel}") as response:
            for line in response.iter_lines():
                if line:
                    _type, _payload = decode_message(line)

                    if _type == "data":
                        try:
                            yield json.loads(_payload)

                        except json.JSONDecodeError as err:
                            if not no_except:
                                raise json.JSONDecodeError(f"Invalid JSON: {_payload!r} ({str(err)})")