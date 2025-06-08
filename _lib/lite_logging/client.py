import httpx
import os

DEFAULT_TIMEOUT = 60
SERVER_URL = os.getenv("LITE_LOGGING_BASE_URL", "http://localhost:8080")

async def async_log(message: str, tags: list[str] = [], channel: str = "logs", server_url: str = SERVER_URL):
    async with httpx.AsyncClient(timeout=httpx.Timeout(DEFAULT_TIMEOUT)) as client:
        resp = await client.post(f"{server_url}/logs", json={"message": message, "tags": tags, "channel": channel})

    return resp.status_code == 200

def sync_log(message: str, tags: list[str] = [], channel: str = "logs", server_url: str = SERVER_URL):
    with httpx.Client(timeout=httpx.Timeout(DEFAULT_TIMEOUT)) as client:
        resp = client.post(f"{server_url}/logs", json={"message": message, "tags": tags, "channel": channel})

    return resp.status_code == 200