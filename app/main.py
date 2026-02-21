"""
StreamSnatcher - Lightning Fast P2P File Transfer
FastAPI Backend with WebRTC Signaling Server
Production-Ready Version
"""

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel, Field, field_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import secrets
import qrcode
import io
import re
import base64
import json
import logging
import os
import time
import asyncio
import hashlib
from dotenv import load_dotenv

# ==================== CONFIGURATION ====================
# Load environment variables from .env file (prefer development for local runs)
env_file = '.env.development' if os.path.exists('.env.development') else '.env.production'
load_dotenv(env_file)

ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8000))
MAX_PEERS_PER_SESSION = 2

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

logger.info(f"🚀 Starting StreamSnatcher in {ENVIRONMENT} mode")
logger.info(f"📍 Base URL: {BASE_URL}")

# Rate limiter setup
limiter = Limiter(key_func=get_remote_address)

# CSRF Token generation
def generate_csrf_token():
    """Generate a secure CSRF token"""
    return secrets.token_hex(32)

# HTTPS Redirect Middleware (for production)
class HTTPSRedirectMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if ENVIRONMENT == "production":
            # Skip HTTPS redirect for local development
            host = request.headers.get("host", "")
            if host.startswith("127.0.0.1") or host.startswith("localhost"):
                return await call_next(request)
            # Check if request is not HTTPS
            if request.headers.get("x-forwarded-proto", "http") != "https":
                url = request.url.replace(scheme="https")
                return RedirectResponse(url, status_code=301)
        return await call_next(request)

# ==================== APP INITIALIZATION ====================
app = FastAPI(
    title="StreamSnatcher",
    description="Lightning-fast P2P file transfer powered by WebRTC",
    version="1.0.0",
    docs_url="/api/docs" if ENVIRONMENT == "development" else None,
    redoc_url="/api/redoc" if ENVIRONMENT == "development" else None
)

# CORS configuration
if ENVIRONMENT == "production":
    allowed_origins = [
        "https://streamsnatcher.com",
        "https://www.streamsnatcher.com"
    ]
else:
    allowed_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add HTTPS redirect middleware (only active in production)
app.add_middleware(HTTPSRedirectMiddleware)

# Security headers middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if ENVIRONMENT == "production":
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://pagead2.googlesyndication.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: blob:; "
            "connect-src 'self' wss: ws:; "
            "frame-src https://pagead2.googlesyndication.com;"
        )
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

# Rate limiter state and exception handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Mount static files
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Templates
templates = Jinja2Templates(directory="app/templates")

# Global state
sessions = {}

# ==================== MODELS ====================
class ContactForm(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=3, max_length=254)
    subject: str = Field(..., min_length=1, max_length=200)
    message: str = Field(..., min_length=1, max_length=5000)

    @field_validator('email')
    @classmethod
    def validate_email(cls, v):
        if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', v):
            raise ValueError('Invalid email address')
        return v

class QRRequest(BaseModel):
    url: str

# ==================== HELPER FUNCTIONS ====================
def get_seo(title: str, description: str, keywords: str, canonical: str) -> dict:
    """Generate SEO metadata for templates"""
    return {
        "title": title,
        "description": description,
        "keywords": keywords,
        "author": "StreamSnatcher",
        "site_name": "StreamSnatcher",
        "canonical": canonical
    }

def generate_qr_code(url: str) -> str:
    """Generate base64 encoded QR code image"""
    try:
        # Set version=None to allow auto-sizing based on data length
        qr = qrcode.QRCode(version=None, box_size=10, border=4)
        qr.add_data(url)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        qr_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        return f"data:image/png;base64,{qr_base64}"
    except Exception as e:
        logger.error(f"Failed to generate QR code: {e}")
        return ""

# ==================== ROUTES ====================
@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """Homepage route"""
    return templates.TemplateResponse("index.html", {
        "request": request,
        "show_cta": False,
        "page_class": "page-home",
        "breadcrumbs": None,
        "timestamp": int(time.time()),
        "seo": get_seo(
            "StreamSnatcher - Lightning Fast P2P File Transfer",
            "Transfer files at lightning speed with zero storage. Direct peer-to-peer file sharing powered by WebRTC. No limits, completely free.",
            "p2p file transfer, webrtc, peer to peer, file sharing, fast transfer, direct transfer",
            f"{BASE_URL}/"
        )
    })

@app.get("/about", response_class=HTMLResponse)
async def about(request: Request):
    """About page route"""
    return templates.TemplateResponse("about.html", {
        "request": request,
        "show_cta": True,
        "page_class": "page-about",
        "breadcrumbs": [
            {"name": "Home", "url": "/"},
            {"name": "About", "url": "/about"}
        ],
        "timestamp": int(time.time()),
        "seo": get_seo(
            "About StreamSnatcher - Fast & Private P2P File Transfer",
            "Learn about StreamSnatcher and our mission to provide fast, secure, and accessible peer-to-peer file transfers for everyone.",
            "about streamsnatcher, p2p technology, webrtc file transfer, privacy focused",
            f"{BASE_URL}/about"
        )
    })

@app.get("/how-it-works", response_class=HTMLResponse)
async def how_it_works(request: Request):
    """How It Works page route"""
    return templates.TemplateResponse("how-it-works.html", {
        "request": request,
        "show_cta": True,
        "page_class": "page-how-it-works",
        "breadcrumbs": [
            {"name": "Home", "url": "/"},
            {"name": "How It Works", "url": "/how-it-works"}
        ],
        "timestamp": int(time.time()),
        "seo": get_seo(
            "How StreamSnatcher Works - P2P File Transfer Explained",
            "Understand how StreamSnatcher uses WebRTC technology to enable direct peer-to-peer file transfers at maximum speed.",
            "how webrtc works, p2p file transfer explained, direct file sharing, webrtc technology",
            f"{BASE_URL}/how-it-works"
        )
    })

@app.get("/contact", response_class=HTMLResponse)
async def contact(request: Request):
    """Contact page route"""
    return templates.TemplateResponse("contact.html", {
        "request": request,
        "show_cta": True,
        "page_class": "page-contact",
        "breadcrumbs": [
            {"name": "Home", "url": "/"},
            {"name": "Contact", "url": "/contact"}
        ],
        "timestamp": int(time.time()),
        "seo": get_seo(
            "Contact StreamSnatcher - Support & Inquiries",
            "Get in touch with the StreamSnatcher team for support, feedback, or business inquiries.",
            "contact streamsnatcher, support, help, feedback",
            f"{BASE_URL}/contact"
        )
    })

@app.get("/privacy-policy", response_class=HTMLResponse)
async def privacy_policy(request: Request):
    """Privacy Policy page route"""
    return templates.TemplateResponse("privacy-policy.html", {
        "request": request,
        "show_cta": False,
        "page_class": "page-legal",
        "breadcrumbs": [
            {"name": "Home", "url": "/"},
            {"name": "Privacy Policy", "url": "/privacy-policy"}
        ],
        "timestamp": int(time.time()),
        "seo": get_seo(
            "Privacy Policy - StreamSnatcher",
            "StreamSnatcher's privacy policy explains how we handle your data and protect your privacy during file transfers.",
            "privacy policy, data protection, user privacy",
            f"{BASE_URL}/privacy-policy"
        )
    })

@app.get("/terms-of-service", response_class=HTMLResponse)
async def terms_of_service(request: Request):
    """Terms of Service page route"""
    return templates.TemplateResponse("terms-of-service.html", {
        "request": request,
        "show_cta": False,
        "page_class": "page-legal",
        "breadcrumbs": [
            {"name": "Home", "url": "/"},
            {"name": "Terms of Service", "url": "/terms-of-service"}
        ],
        "timestamp": int(time.time()),
        "seo": get_seo(
            "Terms of Service - StreamSnatcher",
            "Read StreamSnatcher's terms of service to understand your rights and responsibilities when using our platform.",
            "terms of service, user agreement, legal terms",
            f"{BASE_URL}/terms-of-service"
        )
    })

@app.get("/disclaimer", response_class=HTMLResponse)
async def disclaimer(request: Request):
    """Disclaimer page route"""
    return templates.TemplateResponse("disclaimer.html", {
        "request": request,
        "show_cta": False,
        "page_class": "page-legal",
        "breadcrumbs": [
            {"name": "Home", "url": "/"},
            {"name": "Disclaimer", "url": "/disclaimer"}
        ],
        "timestamp": int(time.time()),
        "seo": get_seo(
            "Disclaimer - StreamSnatcher",
            "Important disclaimers regarding the use of StreamSnatcher's peer-to-peer file transfer service.",
            "disclaimer, legal notice, service limitations, user responsibility",
            f"{BASE_URL}/disclaimer"
        )
    })

@app.get("/use-cases", response_class=HTMLResponse)
async def use_cases(request: Request):
    """Use Cases page route"""
    return templates.TemplateResponse("use-cases.html", {
        "request": request,
        "show_cta": True,
        "page_class": "page-use-cases",
        "breadcrumbs": [
            {"name": "Home", "url": "/"},
            {"name": "Use Cases", "url": "/use-cases"}
        ],
        "timestamp": int(time.time()),
        "seo": get_seo(
            "Use Cases - StreamSnatcher",
            "Discover how professionals, businesses, and individuals use StreamSnatcher for secure file transfer.",
            "use cases, examples, business use, professional file transfer",
            f"{BASE_URL}/use-cases"
        )
    })

@app.get("/faq", response_class=HTMLResponse)
async def faq(request: Request):
    """FAQ page route"""
    return templates.TemplateResponse("faq.html", {
        "request": request,
        "show_cta": True,
        "page_class": "page-faq",
        "breadcrumbs": [
            {"name": "Home", "url": "/"},
            {"name": "FAQ", "url": "/faq"}
        ],
        "timestamp": int(time.time()),
        "seo": get_seo(
            "FAQ - StreamSnatcher | Common Questions About P2P File Transfer",
            "Find answers to frequently asked questions about StreamSnatcher's peer-to-peer file transfers, privacy, performance, and browser compatibility.",
            "faq, frequently asked questions, p2p file transfer help, webrtc support, file sharing questions",
            f"{BASE_URL}/faq"
        )
    })

@app.get("/blog", response_class=HTMLResponse)
async def blog_index(request: Request):
    """Blog landing page route"""
    return templates.TemplateResponse("blog.html", {
        "request": request,
        "show_cta": True,
        "page_class": "page-blog",
        "breadcrumbs": [
            {"name": "Home", "url": "/"},
            {"name": "Blog", "url": "/blog"}
        ],
        "timestamp": int(time.time()),
        "seo": get_seo(
            "Blog - StreamSnatcher | WebRTC, Privacy & P2P File Transfer",
            "In-depth articles about WebRTC technology, peer-to-peer file transfer, privacy-first sharing, and how StreamSnatcher works.",
            "blog, webrtc articles, p2p file transfer, privacy file sharing, technology blog",
            f"{BASE_URL}/blog"
        )
    })

@app.get("/blog/webrtc-file-transfer-guide", response_class=HTMLResponse)
async def blog_webrtc_guide(request: Request):
    """Blog post: WebRTC File Transfer Guide"""
    return templates.TemplateResponse("blog-webrtc-guide.html", {
        "request": request,
        "show_cta": True,
        "page_class": "page-blog-post",
        "breadcrumbs": [
            {"name": "Home", "url": "/"},
            {"name": "Blog", "url": "/blog"},
            {"name": "WebRTC File Transfer Guide", "url": "/blog/webrtc-file-transfer-guide"}
        ],
        "timestamp": int(time.time()),
        "seo": get_seo(
            "WebRTC File Transfer: A Complete Guide - StreamSnatcher",
            "A comprehensive guide to how WebRTC enables direct browser-to-browser file transfers, covering data channels, DTLS encryption, NAT traversal, and practical considerations.",
            "webrtc file transfer, webrtc data channels, browser file transfer, peer to peer guide, DTLS encryption",
            f"{BASE_URL}/blog/webrtc-file-transfer-guide"
        )
    })

@app.get("/blog/privacy-first-file-sharing", response_class=HTMLResponse)
async def blog_privacy_p2p(request: Request):
    """Blog post: Privacy-First File Sharing"""
    return templates.TemplateResponse("blog-privacy-p2p.html", {
        "request": request,
        "show_cta": True,
        "page_class": "page-blog-post",
        "breadcrumbs": [
            {"name": "Home", "url": "/"},
            {"name": "Blog", "url": "/blog"},
            {"name": "Privacy-First File Sharing", "url": "/blog/privacy-first-file-sharing"}
        ],
        "timestamp": int(time.time()),
        "seo": get_seo(
            "Privacy-First File Sharing: Why P2P Matters in 2026 - StreamSnatcher",
            "An in-depth analysis of why peer-to-peer architecture provides stronger privacy guarantees than cloud storage for file sharing.",
            "privacy file sharing, p2p privacy, zero knowledge transfer, GDPR file sharing, encrypted file transfer",
            f"{BASE_URL}/blog/privacy-first-file-sharing"
        )
    })

@app.get("/blog/p2p-vs-cloud-storage", response_class=HTMLResponse)
async def blog_p2p_vs_cloud(request: Request):
    """Blog post: P2P vs Cloud Storage"""
    return templates.TemplateResponse("blog-p2p-vs-cloud.html", {
        "request": request,
        "show_cta": True,
        "page_class": "page-blog-post",
        "breadcrumbs": [
            {"name": "Home", "url": "/"},
            {"name": "Blog", "url": "/blog"},
            {"name": "P2P vs Cloud Storage", "url": "/blog/p2p-vs-cloud-storage"}
        ],
        "timestamp": int(time.time()),
        "seo": get_seo(
            "P2P vs. Cloud Storage: Which Is Better for File Transfer? - StreamSnatcher",
            "A detailed comparison of peer-to-peer and cloud-based file transfer across speed, privacy, cost, file size limits, and real-world use cases.",
            "p2p vs cloud storage, file transfer comparison, peer to peer vs cloud, best file sharing method",
            f"{BASE_URL}/blog/p2p-vs-cloud-storage"
        )
    })

@app.get("/session/{session_id}", response_class=HTMLResponse)
async def session_page(request: Request, session_id: str):
    """Session page route - loads the app with session context"""
    # Validate session_id format to prevent injection
    if not re.match(r'^[a-zA-Z0-9_-]{8,64}$', session_id):
        return JSONResponse(status_code=400, content={"error": "Invalid session ID"})
    return templates.TemplateResponse("index.html", {
        "request": request,
        "show_cta": False,
        "page_class": "page-session",
        "session_id": session_id,
        "breadcrumbs": None,
        "timestamp": int(time.time()),
        "seo": get_seo(
            f"Session {session_id[:8]} - StreamSnatcher",
            "Active file transfer session. Join to send and receive files.",
            f"file transfer session, share files",
            f"{BASE_URL}/session/{session_id}"
        )
    })

# ==================== API ENDPOINTS ====================
@app.post("/api/create-session")
@limiter.limit("5/minute")
async def create_session(request: Request):
    """Create a new transfer session with unique ID and QR code"""
    try:
        session_id = secrets.token_urlsafe(16)
        join_token = secrets.token_urlsafe(16)
        sessions[session_id] = {"connections": [], "join_token": join_token, "created_at": time.time()}
        
        # Always use BASE_URL for production deployment
        session_url = f"{BASE_URL}/session/{session_id}?token={join_token}"
        
        qr_code = generate_qr_code(session_url)
        
        logger.info(f"✓ Session created: {session_id}")
        logger.info(f"📍 Session URL: {session_url}")
        
        return {
            "session_id": session_id,
            "session_url": session_url,
            "qr_code": qr_code,
            "join_token": join_token
        }
    except Exception as e:
        logger.error(f"❌ Failed to create session: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to create session"}
        )

@app.post("/api/generate-qr")
@limiter.limit("20/minute")
async def generate_qr(request: Request, qr_data: QRRequest):
    """Generate QR code for any URL (used by receivers)"""
    try:
        # Validate URL starts with BASE_URL to prevent open redirect / phishing
        if not qr_data.url.startswith(BASE_URL):
            return JSONResponse(
                status_code=400,
                content={"error": "Invalid URL — QR codes can only be generated for this site"}
            )
        qr_code = generate_qr_code(qr_data.url)
        return {"qr_code": qr_code}
    except Exception as e:
        logger.error(f"❌ Failed to generate QR code: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to generate QR code"}
        )

@app.post("/api/contact")
@limiter.limit("3/minute")
async def submit_contact(request: Request, form: ContactForm):
    """Handle contact form submissions"""
    try:
        logger.info(f"📧 Contact form: {form.name[:50]} ({form.email[:50]}) - {form.subject[:50]}")
        
        # TODO: Implement email sending (SendGrid, AWS SES, etc.)
        # TODO: Store in database if needed
        
        return {
            "status": "success",
            "message": "Thank you for contacting us! We'll respond shortly."
        }
    except Exception as e:
        logger.error(f"❌ Contact form error: {e}")
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": "Failed to send message"}
        )

# ==================== WEBSOCKET - SIGNALING SERVER ====================
ALLOWED_WS_TYPES = {"register", "offer", "answer", "ice-candidate", "ping", "request-peer-count"}
MAX_WS_MESSAGE_SIZE = 65536  # 64KB limit for signaling messages

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket signaling server for WebRTC peer connections"""
    
    # Validate session_id format
    if not re.match(r'^[a-zA-Z0-9_-]{8,64}$', session_id):
        await websocket.close(code=1008, reason="Invalid session ID")
        return
    
    # Check if session is full before accepting
    if session_id in sessions and len(sessions[session_id]["connections"]) >= MAX_PEERS_PER_SESSION:
        await websocket.close(code=1008, reason="Session full")
        logger.warning(f"⚠️ Session {session_id} full, connection rejected")
        return
    
    # Accept connection first (required before any send/close in FastAPI)
    await websocket.accept()
    
    # Authenticate with join token
    token = websocket.query_params.get("token")
    session = sessions.get(session_id)
    if session and session.get("join_token") and token != session.get("join_token"):
        logger.warning(f"⚠️ Unauthorized WebSocket attempt for session {session_id}")
        await websocket.close(code=1008, reason="Unauthorized")
        return

    # Initialize session if not exists
    if session_id not in sessions:
        sessions[session_id] = {"connections": [], "created_at": time.time()}
    sessions[session_id]["connections"].append(websocket)
    
    # Get total count
    peer_count = len(sessions[session_id]["connections"])
    logger.info(f"✓ Peer joined session {session_id}. Total: {peer_count}/{MAX_PEERS_PER_SESSION}")
    
    # Send count to the NEW peer immediately
    try:
        await websocket.send_json({
            "type": "peer-joined",
            "peer_count": peer_count,
            "max_peers": MAX_PEERS_PER_SESSION
        })
    except Exception as e:
        logger.error(f"❌ Failed to send to new peer: {e}")
    
    # Notify ALL other peers
    for conn in sessions[session_id]["connections"]:
        if conn != websocket:
            try:
                await conn.send_json({
                    "type": "peer-joined",
                    "peer_count": peer_count,
                    "max_peers": MAX_PEERS_PER_SESSION
                })
            except:
                pass
    
    try:
        while True:
            data = await websocket.receive_text()
            
            # M1: Reject oversized messages
            if len(data) > MAX_WS_MESSAGE_SIZE:
                logger.warning(f"⚠️ Oversized message rejected from session {session_id}")
                continue
            
            message = json.loads(data)
            msg_type = message.get("type")
            
            # Handle ping
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            
            # Handle peer count requests
            if msg_type == "request-peer-count":
                await websocket.send_json({
                    "type": "peer-joined",
                    "peer_count": len(sessions[session_id]["connections"]),
                    "max_peers": MAX_PEERS_PER_SESSION
                })
                continue
            
            # H1: Only relay allowed message types
            if msg_type not in ALLOWED_WS_TYPES:
                logger.warning(f"⚠️ Rejected unknown message type: {msg_type}")
                continue
            
            # Relay to all other peers
            for conn in sessions[session_id]["connections"]:
                if conn != websocket:
                    try:
                        await conn.send_text(data)
                    except Exception as e:
                        logger.error(f"❌ Failed to relay message: {e}")
                    
    except WebSocketDisconnect:
        # Remove disconnected peer
        if websocket in sessions[session_id]["connections"]:
            sessions[session_id]["connections"].remove(websocket)
        
        remaining = len(sessions[session_id]["connections"])
        logger.info(f"⚠️ Peer left session {session_id}. Remaining: {remaining}")
        
        # Notify remaining peers
        for conn in sessions[session_id]["connections"]:
            try:
                await conn.send_json({
                    "type": "peer-left",
                    "peer_count": remaining
                })
            except:
                pass
        
        # Clean up empty sessions
        if remaining == 0:
            del sessions[session_id]
            logger.info(f"🗑️ Session {session_id} cleaned up (empty)")
    
    except Exception as e:
        logger.error(f"❌ WebSocket error in session {session_id}: {e}")
        if websocket in sessions[session_id]["connections"]:
            sessions[session_id]["connections"].remove(websocket)

# ==================== SEO & METADATA ====================
@app.get("/ads.txt", response_class=HTMLResponse)
async def ads_txt():
    """Serve ads.txt for AdSense verification"""
    ads_path = os.path.join("app", "static", "ads.txt")
    if os.path.exists(ads_path):
        with open(ads_path, "r") as f:
            return Response(content=f.read(), media_type="text/plain")
    return Response(content="", media_type="text/plain")

@app.get("/robots.txt", response_class=HTMLResponse)
async def robots():
    """Robots.txt for search engine crawlers"""
    domain = BASE_URL.replace("http://", "").replace("https://", "")
    return f"""User-agent: *
Allow: /
Disallow: /session/
Disallow: /api/

Sitemap: {BASE_URL}/sitemap.xml"""

@app.get("/sitemap.xml")
async def sitemap():
    """XML sitemap for search engines"""
    content = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>{BASE_URL}/</loc>
        <lastmod>2026-02-21</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
    <url>
        <loc>{BASE_URL}/about</loc>
        <lastmod>2026-02-21</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>
    <url>
        <loc>{BASE_URL}/how-it-works</loc>
        <lastmod>2026-02-21</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>
    <url>
        <loc>{BASE_URL}/use-cases</loc>
        <lastmod>2026-02-21</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.7</priority>
    </url>
    <url>
        <loc>{BASE_URL}/faq</loc>
        <lastmod>2026-02-21</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.7</priority>
    </url>
    <url>
        <loc>{BASE_URL}/contact</loc>
        <lastmod>2026-02-21</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.7</priority>
    </url>
    <url>
        <loc>{BASE_URL}/blog</loc>
        <lastmod>2026-02-21</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.8</priority>
    </url>
    <url>
        <loc>{BASE_URL}/blog/webrtc-file-transfer-guide</loc>
        <lastmod>2026-02-21</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.7</priority>
    </url>
    <url>
        <loc>{BASE_URL}/blog/privacy-first-file-sharing</loc>
        <lastmod>2026-02-21</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.7</priority>
    </url>
    <url>
        <loc>{BASE_URL}/blog/p2p-vs-cloud-storage</loc>
        <lastmod>2026-02-21</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.7</priority>
    </url>
    <url>
        <loc>{BASE_URL}/privacy-policy</loc>
        <lastmod>2026-02-21</lastmod>
        <changefreq>yearly</changefreq>
        <priority>0.5</priority>
    </url>
    <url>
        <loc>{BASE_URL}/terms-of-service</loc>
        <lastmod>2026-02-21</lastmod>
        <changefreq>yearly</changefreq>
        <priority>0.5</priority>
    </url>
    <url>
        <loc>{BASE_URL}/disclaimer</loc>
        <lastmod>2026-02-21</lastmod>
        <changefreq>yearly</changefreq>
        <priority>0.5</priority>
    </url>
</urlset>"""
    return Response(content=content, media_type="application/xml")

# ==================== HEALTH CHECK ====================
@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring"""
    if ENVIRONMENT == "production":
        return {"status": "healthy"}
    return {
        "status": "healthy",
        "environment": ENVIRONMENT,
        "active_sessions": len(sessions),
        "total_connections": sum(len(s["connections"]) for s in sessions.values())
    }

@app.get("/api/stats")
async def get_stats():
    """Get server statistics"""
    if ENVIRONMENT == "development":
        return {
            "total_sessions": len(sessions),
            "active_connections": sum(len(s["connections"]) for s in sessions.values()),
            "sessions": {sid: len(s["connections"]) for sid, s in sessions.items()}
        }
    return {"status": "disabled in production"}

# ==================== STARTUP & SHUTDOWN ====================
@app.on_event("startup")
async def startup_event():
    """Application startup"""
    logger.info("=" * 60)
    logger.info("🚀 StreamSnatcher Server Started")
    logger.info(f"📍 Environment: {ENVIRONMENT}")
    logger.info(f"🌐 Base URL: {BASE_URL}")
    logger.info(f"👥 Max peers per session: {MAX_PEERS_PER_SESSION}")
    logger.info("=" * 60)
    # Start session cleanup task
    asyncio.create_task(cleanup_stale_sessions())

async def cleanup_stale_sessions():
    """Remove sessions older than 1 hour, force-close after 2 hours"""
    while True:
        await asyncio.sleep(300)  # Check every 5 minutes
        now = time.time()
        to_delete = []
        for sid, s in sessions.items():
            age = now - s.get("created_at", 0)
            # Force-close sessions older than 2 hours regardless of connections
            if age > 7200:
                for conn in s["connections"]:
                    try:
                        await conn.close(code=1001, reason="Session expired")
                    except Exception:
                        pass
                to_delete.append(sid)
            elif age > 3600 and len(s["connections"]) == 0:
                to_delete.append(sid)
        for sid in to_delete:
            del sessions[sid]
            logger.info(f"🗑️ Expired stale session: {sid}")
        if to_delete:
            logger.info(f"📊 Cleaned up {len(to_delete)} stale sessions")

@app.on_event("shutdown")
async def shutdown_event():
    """Application shutdown"""
    logger.info("🛑 StreamSnatcher server shutting down")
    logger.info(f"📊 Active sessions at shutdown: {len(sessions)}")

# ==================== MAIN ====================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=HOST,
        port=PORT,
        reload=(ENVIRONMENT == "development"),
        log_level="info"
    )
