from lite_logging.pubsub.v1 import EventPayload as V1EventPayload, EventHandler as V1EventHandler
from lite_logging.pubsub.v2 import EventPayload as V2EventPayload, EventHandler as V2EventHandler
from abc import ABC, abstractmethod
from typing import TypeVar, AsyncGenerator, Any, Callable, Literal
import httpx
import logging
import json
from dataclasses import asdict
import os
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import padding
from dataclasses import dataclass, field

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
        async with httpx.AsyncClient(timeout=None) as client:
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
    
    async def async_publish(self, event: _EVENT_PAYLOAD_TYPE, *channels: str) -> bool:
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
        super().__init__(source.rstrip("/") + "/v1" if isinstance(source, str) else source)

    async def async_subscribe(self, *channels: str) -> AsyncGenerator[V1EventPayload, None]:
        def deserializer(line: str) -> V1EventPayload:
            data: dict[str, Any] = json.loads(line)
            return V1EventPayload(**data)

        async for event in get_generator(self.source, deserializer, channels=channels):
            yield event

class LiteLoggingClientV2(LiteLoggingClientBase):
    def __init__(self, source: str | _HANDLER_TYPE):
        super().__init__(source.rstrip("/") + "/v2" if isinstance(source, str) else source)

    async def async_subscribe(self, *channels: str) -> AsyncGenerator[V2EventPayload, None]:
        def deserializer(line: str) -> V2EventPayload:
            data: dict[str, Any] = json.loads(line)
            return V2EventPayload(**data)

        async for event in get_generator(self.source, deserializer, channels=channels):
            yield event
  

@dataclass
class V2EventPayload_AES:
    payload: str = ""
    tags: list[str] = field(default_factory=list)
    original_format: Literal["json", "str"] = "json"

    @classmethod
    def from_event(cls, event: V2EventPayload, shared_key: str | bytes) -> "V2EventPayload_AES":
        iv = os.urandom(16)
        cipher = Cipher(algorithms.AES(shared_key), modes.CBC(iv), backend=default_backend())
        encryptor = cipher.encryptor()
        padder = padding.PKCS7(len(shared_key) * 8).padder()

        if isinstance(event.payload, str):
            original_text = event.payload.encode()
        else:
            original_text = json.dumps(event.payload).encode()

        padded_text = padder.update(original_text) + padder.finalize()
        encrypted = iv + encryptor.update(padded_text) + encryptor.finalize()

        return cls(
            payload=encrypted.hex(), 
            tags=event.tags, 
            original_format="str" if isinstance(event.payload, str) else "json"
        )

    def to_event(self, shared_key: str | bytes) -> V2EventPayload:
        buffer = bytes.fromhex(self.payload)

        iv, ciphertext = buffer[:16], buffer[16:]
        cipher = Cipher(algorithms.AES(shared_key), modes.CBC(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        unpadder = padding.PKCS7(len(shared_key) * 8).unpadder()
        decrypted = decryptor.update(ciphertext) + decryptor.finalize()
        unpadded = unpadder.update(decrypted) + unpadder.finalize()
        original_text = unpadded.decode()

        if self.original_format == "json":
            original_text = json.loads(original_text)

        return V2EventPayload(payload=original_text, tags=self.tags)
  
class LiteLoggingClientV2_AES(LiteLoggingClientV2):
    def __init__(self, source: str | _HANDLER_TYPE, shared_key: str | bytes):
        super().__init__(source)
        self.shared_key = bytes.fromhex(shared_key) if isinstance(shared_key, str) else shared_key

    async def async_subscribe(self, *channels: str) -> AsyncGenerator[V2EventPayload, None]:
        def deserializer(line: str) -> V2EventPayload:
            data: dict[str, Any] = json.loads(line)
            return V2EventPayload_AES(**data).to_event(self.shared_key)

        async for event in get_generator(self.source, deserializer, channels=channels):
            yield event

    async def async_publish(self, event: V2EventPayload, *channels: str) -> bool:
        try:
            encrypted_event = V2EventPayload_AES.from_event(event, self.shared_key)
        except Exception as e:
            logger.error(f"Error while encrypting event: {e}")
            return False

        return await super().async_publish(encrypted_event, *channels)

class LiteLoggingClientV3(LiteLoggingClientBase):
    def __init__(self, source: str | _HANDLER_TYPE):
        super().__init__(source.rstrip("/") + "/v3" if isinstance(source, str) else source)

    async def async_subscribe(self, *channels: str) -> AsyncGenerator[bytes, None]:
        async for event in v3_generator(self.source, channels=channels):
            yield event

class LiteLoggingClientV3_AES(LiteLoggingClientV3):
    def __init__(self, source: str | _HANDLER_TYPE, shared_key: str | bytes):
        super().__init__(source)
        self.shared_key = bytes.fromhex(shared_key) if isinstance(shared_key, str) else shared_key

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

    async def async_publish(self, event: bytes, *channels: str) -> bool:
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

        return await super().async_publish(encrypted, *channels)

class LiteLoggingClientV3_AES_PROMAX(LiteLoggingClientV3_AES):
    async def async_subscribe(self, *channels: str) -> AsyncGenerator[V2EventPayload, None]:
        async for event in super().async_subscribe(*channels):
            try:
                res = V2EventPayload(**json.loads(event))
                yield res
            except Exception as e:
                logger.error(f"Error while deserializing event: {e}")

    async def async_publish(self, event: V2EventPayload, *channels: str) -> bool:
        return await super().async_publish(json.dumps(asdict(event)).encode(), *channels)
