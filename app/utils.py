from typing import Generator, AsyncGenerator, Callable, Tuple, List, Union
from functools import wraps, partial
from hashlib import md5
from concurrent.futures import ProcessPoolExecutor
from starlette.concurrency import run_in_threadpool
from asyncio import Semaphore as AsyncSemaphore
import asyncio
import os
import re

def batching(data: Generator, batch_size = 1):
    for i in range(0, len(data), batch_size):
        yield data[i:i + batch_size]

async def async_batching(data: AsyncGenerator, batch_size=1):
    current_batch = []
    
    async for item in data:
        current_batch.append(item)
            
        if len(current_batch) == batch_size:
            yield current_batch
            current_batch = []
            
    if len(current_batch) > 0:
        yield current_batch

def get_hash(*items):
    return md5("".join(items).encode()).hexdigest()

def sync2async(sync_func: Callable):
    async def async_func(*args, **kwargs):
        return await run_in_threadpool(partial(sync_func, *args, **kwargs))
    return async_func if not asyncio.iscoroutinefunction(sync_func) else sync_func

def sync2async_in_subprocess(sync_func: Callable):
    async def async_func(*args, **kwargs):
        wrapper = partial(sync_func, *args, **kwargs)

        with ProcessPoolExecutor(max_workers=1) as executor:
            return await asyncio.get_event_loop().run_in_executor(
                executor, wrapper
            )

    return async_func if not asyncio.iscoroutinefunction(sync_func) else sync_func    

def limit_asyncio_concurrency(num_of_concurrent_calls: int):
    semaphore = AsyncSemaphore(num_of_concurrent_calls)

    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            async with semaphore:
                return await func(*args, **kwargs)                
        return wrapper
    return decorator

def random_payload(length: int) -> str:
    return os.urandom(length // 2).hex()

def get_tmp_directory():
    return os.path.join(os.getcwd(), '.tmp', random_payload(20))

def is_async_func(func: Callable) -> bool:
    return asyncio.iscoroutinefunction(func)

def background_task_error_handle(handler: Callable):
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                res = handler(*args, e, **kwargs)

                if is_async_func(handler):
                    return await res

        return wrapper
    return decorator

def mask_rtsp_url(rtsp_url: str) -> str:
    """
    Mask the rtsp url by replacing the password with asterisks
    """
    
    pat = re.compile(r"rtsp://(.*):(.*)@(.*)")
    match = pat.match(rtsp_url)

    if match:
        return f"rtsp://{match.group(1)}:********@{match.group(3)}"

    return rtsp_url

async def check_output(command: Union[str, List[str]], timeout: int = -1) -> Tuple[str, str]:
    """
    Check the output of a command
    """

    if isinstance(command, list):
        command = " ".join(command)

    proc = await asyncio.create_subprocess_shell(
        command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )

    try:
        future = proc.communicate()

        if timeout == -1:
            stdout, stderr = await future
        else:
            stdout, stderr = await asyncio.wait_for(future, timeout=timeout)

    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise

    return stdout.decode().strip(), stderr.decode().strip()