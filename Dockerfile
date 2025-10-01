from python:3.12-alpine

copy requirements.txt requirements.txt
run --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

workdir /workspace

copy lite_logging lite_logging
copy lite_logging_server lite_logging_server
copy public public
copy server.py server.py

entrypoint ["uvicorn", "server:server_app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--log-level", "warning"]
