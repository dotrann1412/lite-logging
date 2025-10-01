from lite_logging.pubsub.v1 import EventPayload as V1EventPayload, EventHandler as V1EventHandler
from lite_logging.pubsub.v2 import EventPayload as V2EventPayload, EventHandler as V2EventHandler
from abc import ABC, abstractmethod
from typing import TypeVar, AsyncGenerator, Any
import httpx
from typing import Callable
import logging
import json
from dataclasses import asdict
from cryptography.hazmat.primitives import serialization
import os

logger = logging.getLogger(__name__)

_HANDLER_TYPE = TypeVar("_HANDLER_TYPE", V1EventHandler, V2EventHandler)
_EVENT_PAYLOAD_TYPE = TypeVar("_EVENT_PAYLOAD_TYPE", V1EventPayload, V2EventPayload)

__all__ = ["V1EventPayload", "V2EventPayload", "V1EventHandler", "V2EventHandler"]

async def v3_generator(
    source: str | _HANDLER_TYPE, 
    channels: list[str] = []
):
    if isinstance(source, str):
        url = f"{source}/subscribe"
        async with httpx.AsyncClient() as client:
            async with client.stream("GET", url, params={"channels": channels}) as response:
                async for line in response.aiter_lines():
                    if line and line.startswith("data: "):
                        yield bytes.fromhex(line[6:])

    else:
        raise Exception("Not supported yet")

async def get_generator(
    source: str | _HANDLER_TYPE, 
    deserializer: Callable[[_EVENT_PAYLOAD_TYPE], str], 
    channels: list[str] = []
) -> AsyncGenerator[_EVENT_PAYLOAD_TYPE, None]:
    if isinstance(source, str):
        url = f"{source}/subscribe"
        async with httpx.AsyncClient() as client:
            async with client.stream("GET", url, params={"channels": channels}) as response:
                async for line in response.aiter_lines():
                    if line and line.startswith("data: "):
                        try:
                            yield deserializer(line[6:])
                        except Exception as e:
                            logger.error(f"Error in deserializer: {e}")

    else:
        raise Exception("Not supported yet")


class LiteLoggingClientBase(ABC):
    def __init__(self, source: str | _HANDLER_TYPE):
        self.source = source.rstrip("/") if isinstance(source, str) else source

    @abstractmethod
    async def async_subscribe(self, *channels: str) -> AsyncGenerator[_EVENT_PAYLOAD_TYPE, None]:
        raise NotImplementedError
    
    async def async_publish(self, channels: list[str], event: _EVENT_PAYLOAD_TYPE) -> bool:
        payload = {
            "params": {"channels": channels},
        }

        if isinstance(event, bytes):
            payload["data"] = event
        else:
            payload["json"] = asdict(event)

        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{self.source}/publish", **payload)
            return resp.status_code == 200

class LiteLoggingClientV1(LiteLoggingClientBase):
    def __init__(self, source: str | _HANDLER_TYPE):
        super().__init__(source)

    async def async_subscribe(self, *channels: str) -> AsyncGenerator[V1EventPayload, None]:
        def deserializer(line: str) -> V1EventPayload:
            data: dict[str, Any] = json.loads(line)
            return V1EventPayload(**data)

        async for event in get_generator(self.source, deserializer, channels=channels):
            yield event

class LiteLoggingClientV2(LiteLoggingClientBase):
    def __init__(self, source: str | _HANDLER_TYPE):
        super().__init__(source)

    async def async_subscribe(self, *channels: str) -> AsyncGenerator[V2EventPayload, None]:
        def deserializer(line: str) -> V2EventPayload:
            data: dict[str, Any] = json.loads(line)
            return V2EventPayload(**data)

        async for event in get_generator(self.source, deserializer, channels={"channels": channels}):
            yield event
            
class LiteLoggingClientV3(LiteLoggingClientBase):
    def __init__(self, source: str | _HANDLER_TYPE):
        super().__init__(source)

    async def async_subscribe(self, *channels: str) -> AsyncGenerator[bytes, None]:
        async for event in v3_generator(self.source, channels=channels):
            yield event
    
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import padding

class LiteLoggingClientV3_AES(LiteLoggingClientV3):
    def __init__(self, source: str | _HANDLER_TYPE, shared_key: str | bytes):
        super().__init__(source)
        self.shared_key = shared_key.encode() if isinstance(shared_key, str) else shared_key

    async def async_subscribe(self, *channels: str) -> AsyncGenerator[bytes, None]:
        async for event in super().async_subscribe(*channels):  
            iv, ciphertext = event[:16], event[16:]
            cipher = Cipher(algorithms.AES(self.shared_key), modes.CBC(iv), backend=default_backend())
            decryptor = cipher.decryptor()
            unpadder = padding.PKCS7(len(self.shared_key) * 8).unpadder()

            try:
                decrypted = decryptor.update(ciphertext) + decryptor.finalize()
                yield unpadder.update(decrypted) + unpadder.finalize()
            except Exception as e:
                logger.error(f"Error while decrypting event: {e}")

    async def async_publish(self, channels: list[str], event: bytes) -> bool:
        iv = os.urandom(16)
        cipher = Cipher(algorithms.AES(self.shared_key), modes.CBC(iv), backend=default_backend())
        encryptor = cipher.encryptor()
        
        padder = padding.PKCS7(len(self.shared_key) * 8).padder()

        try:
            padded_text = padder.update(event) + padder.finalize()
            encrypted = iv + encryptor.update(padded_text) + encryptor.finalize()
        except Exception as e:
            logger.error(f"Error while encrypting event: {e}")
            return False

        return await super().async_publish(channels, encrypted)
