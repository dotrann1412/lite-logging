from python:3.12-alpine

copy requirements.txt requirements.txt
run --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

workdir /workspace

copy app app
copy public public
copy server.py server.py 
expose 80

entrypoint ["python", "server.py"]