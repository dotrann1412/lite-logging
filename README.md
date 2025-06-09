# 🚀 Lite Logging

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.68+-00a393.svg)](https://fastapi.tiangolo.com/)

A **lightweight, real-time logging system** with a beautiful web interface and powerful Python client. Perfect for development, debugging, and production monitoring.

A public server for everyone: `http://14.225.217.119`

## ✨ Features

### 🌐 **Web Interface**
- **Real-time log streaming** with Server-Sent Events (SSE)
- **Multi-channel support** with channel switching and history
- **Smart auto-reconnection** with exponential backoff
- **Advanced filtering** by keywords, tags, and log types
- **Expandable logs** with JSON formatting and text selection
- **Persistent storage** - saves up to 1000 logs per channel locally
- **Keyboard shortcuts** for power users
- **Mobile-responsive** design
- **Dark/light theme** support

### 🐍 **Python Client Library**
- **Synchronous & asynchronous** logging methods
- **Multiple content types** (plain text, JSON)
- **Channel-based organization**
- **Tag support** for categorization
- **Environment-based configuration**
- **Error handling** and retries

### ⚡ **Server Features**
- **FastAPI-powered** for high performance
- **CORS-enabled** for cross-origin requests
- **Health check endpoints**
- **Request logging** with timing
- **Docker support**
- **SPA routing** with 404 fallbacks

---

## 🚀 Quick Start

### 1. **Clone & Install**

```bash
git clone https://github.com/dotrann1412/lite-logging.git
cd lite-logging
pip install -r requirements.txt
```

### 2. **Start the Server**

```bash
python server.py
```

🌐 **Web Interface**: http://localhost:80  
📡 **API Docs**: http://localhost:80/docs

### 3. **Send Your First Log**

```python
from lite_logging import sync_log

# publish a message to channel 'default'
sync_log("Hello from Lite Logging! 🎉", 
         tags=["welcome", "first-log"], 
         server_url="http://localhost")
```

---

## 📖 Usage Guide

### 🌐 Web Interface

The web interface provides a powerful, real-time log viewing experience:
- Realtime monitoring 
- Log filtering


### 🐍 Python Client

#### **Installation**

```bash
pip install git+https://github.com/dotrann1412/lite-logging.git
```

#### **Usages**

- Synchronous-based:

```python
from lite_logging import sync_log, async_log, ContentType

# Simple text logging
sync_log("Application started", channel="app")

# With tags for categorization
sync_log("User login successful", 
         tags=["auth", "success"], 
         channel="security")

# JSON structured logging
sync_log({"user_id": 123, "action": "login", "ip": "192.168.1.1"}, 
         channel="audit", 
         content_type=ContentType.JSON)
```

- Asynchronous-based:

```python
import asyncio
from lite_logging import async_log, ContentType

async def log_async_operation():
    await async_log("Async operation completed", 
                   tags=["async", "performance"], 
                   channel="operations")

# Run in async context
asyncio.run(log_async_operation())
```

#### **Configuration**

- Set the server URL via environment variable:

```bash
export LITE_LOGGING_BASE_URL="http://your-server:8080"
```

- Or programmatically:

```python
import os
os.environ["LITE_LOGGING_BASE_URL"] = "http://your-server:8080"
```

---

## 🔧 API Reference

### **POST** `/api/publish`

Send a log message to the server.

**Request Body:**
```json
{
  "data": {
    "data": "Your log message or JSON object",
    "tags": ["tag1", "tag2"],
    "type": "text"
  },
  "type": "message"
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Log published"
}
```

### **GET** `/api/subscribe?channels={channel}`

Subscribe to real-time log streams via Server-Sent Events.

**Parameters:**
- `channels`: list of channels to subscribe to

**Response:** Server-Sent Events stream

---

## 🐳 Deployment

### **Using Dockerfile**

```bash
docker build -t lite-logging .
docker run -p 8080:80 lite-logging
```

---

## 🛠️ Development

### **Project Structure**

```
lite-logging/
├── _lib/lite_logging/          # Python client library
│   ├── __init__.py
│   └── client.py
├── app/                        # FastAPI application
│   └── apis/
├── public/                     # Web interface
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── server.py                   # Main server entry point
├── requirements.txt
├── pyproject.toml
└── Dockerfile
```

### **Environment Variables**

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `80` | Server port |
| `LITE_LOGGING_BASE_URL` | `http://localhost:8080` | Client server URL |

### **Local Development**

```bash
# Install dependencies
pip install -r requirements.txt

# Start development server
python server.py

# The server will run on http://localhost:80
```

---

## 📝 Use Cases

### **🔧 Development & Debugging**
- Real-time application debugging
- API request/response monitoring
- Performance tracking
- Error logging and analysis

### **🏗️ CI/CD Pipelines**
- Build process monitoring
- Test execution logging
- Deployment status tracking
- Integration testing

### **📊 Production Monitoring**
- Application health monitoring
- User activity tracking
- System performance metrics
- Security event logging

### **🎯 Microservices**
- Service communication tracking
- Distributed tracing
- Cross-service debugging
- Performance bottleneck identification

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Built with [FastAPI](https://fastapi.tiangolo.com/) for the backend
- Uses [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) for real-time streaming
- Styled with modern CSS and responsive design principles
- Inspired by modern logging solutions and developer experience best practices

---

<div align="center">

**⭐ Star this repo if you find it useful! ⭐**

</div>
