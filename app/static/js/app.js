// ==================== CONFIGURATION ====================
const CHUNK_SIZE = 262144; // 256KB chunks (larger = fewer messages = faster)
const MAX_BUFFER_AMOUNT = 4194304; // 4MB high water mark
const LOW_BUFFER_THRESHOLD = 524288; // 512KB low water mark
const MERGE_THRESHOLD = 33554432; // 32MB — merge chunks into Blob to free ArrayBuffer memory
const MAX_PEERS = 2;
const ICE_SERVERS = [
    // STUN servers (free, for NAT discovery)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    // TURN servers (free tier from Open Relay Project - for restrictive networks)
    {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    }
];

// ==================== SECURITY HELPERS ====================
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==================== GLOBAL STATE ====================
// WebSocket & Session
let ws = null;
let sessionId = null;
let joinToken = null;
let isSessionCreator = false;
let myPeerId = generateId();

// Mesh Network
let peerConnections = new Map();

// File Transfer
let fileQueue = [];
let currentTransfer = null;
let receivingFiles = new Map();
let receivedFiles = {};
let announcedQueue = new Set();

// Transfer Tracking
let transferSpeed = 0;
let transferStartTime = 0;
let lastTransferredBytes = 0;
let isCancelling = false;

// Session Statistics
let sessionFilesCount = 0;
let sessionTotalData = 0;
let sessionStartTime = null;
let durationInterval = null;

// Status
let currentPeerCount = 0;
let isPageVisible = true;
let keepAliveInterval = null;

// ==================== DOM ELEMENTS ====================
const heroCreateBtn = document.getElementById('hero-create-btn');
const sessionStart = document.getElementById('session-start');
const sessionActive = document.getElementById('session-active');
const createSessionBtn = document.getElementById('create-session-btn');
const reconnectBtn = document.getElementById('reconnect-btn');
const terminateBtn = document.getElementById('terminate-btn');
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const qrCodeDisplay = document.getElementById('qr-code-display');
const sessionUrlInput = document.getElementById('session-url');
const copyUrlBtn = document.getElementById('copy-url-btn');
const fileList = document.getElementById('file-list');
const historyList = document.getElementById('history-list');

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupPageVisibility();
    setupCTAButtons();

    const pathParts = window.location.pathname.split('/');
    if (pathParts[1] === 'session' && pathParts[2]) {
        sessionId = pathParts[2];
        // Extract join token from URL params
        const urlParams = new URLSearchParams(window.location.search);
        joinToken = urlParams.get('token');
        joinSession(sessionId);
    }
});

function setupEventListeners() {
    if (heroCreateBtn) heroCreateBtn.addEventListener('click', createSession);
    if (createSessionBtn) createSessionBtn.addEventListener('click', createSession);
    if (reconnectBtn) reconnectBtn.addEventListener('click', reconnect);
    if (terminateBtn) terminateBtn.addEventListener('click', terminateSession);
    if (copyUrlBtn) copyUrlBtn.addEventListener('click', copySessionUrl);

    if (uploadZone) {
        uploadZone.addEventListener('click', () => fileInput.click());
        uploadZone.addEventListener('dragover', handleDragOver);
        uploadZone.addEventListener('dragleave', handleDragLeave);
        uploadZone.addEventListener('drop', handleDrop);
    }

    if (fileInput) fileInput.addEventListener('change', handleFileSelect);
}

function setupCTAButtons() {
    const ctaBtn = document.getElementById('cta-start-btn');

    if (ctaBtn) {
        ctaBtn.addEventListener('click', (e) => {
            e.preventDefault();
            ctaBtn.style.transform = 'scale(0.95)';
            setTimeout(() => createSession(), 150);
        });
    }

    if (heroCreateBtn) {
        heroCreateBtn.addEventListener('click', (e) => {
            e.preventDefault();
            heroCreateBtn.style.transform = 'scale(0.95)';
            setTimeout(() => createSession(), 150);
        });
    }
}

// ==================== PAGE VISIBILITY ====================
function setupPageVisibility() {
    document.addEventListener('visibilitychange', () => {
        isPageVisible = !document.hidden;

        if (isPageVisible) {
            const warning = document.getElementById('visibility-warning');
            if (warning) warning.remove();

            if (fileQueue.length > 0 && !currentTransfer) {
                processQueue();
            }
        } else if (currentTransfer) {
            showVisibilityWarning();
        }
    });
}

function showVisibilityWarning() {
    if (document.getElementById('visibility-warning')) return;

    const warning = document.createElement('div');
    warning.className = 'page-hidden-warning';
    warning.id = 'visibility-warning';
    warning.innerHTML = '⚠️ Transfer may slow down when tab is inactive';
    document.body.appendChild(warning);
}

// ==================== SESSION MANAGEMENT ====================
function showSessionStart() {
    document.querySelector('.hero-section').style.display = 'none';
    document.querySelectorAll('.features-showcase').forEach(el => el.style.display = 'none');
    const howItWorks = document.querySelector('.how-it-works');
    if (howItWorks) howItWorks.style.display = 'none';
    const ctaSection = document.querySelector('.cta-section');
    if (ctaSection) ctaSection.style.display = 'none';
    sessionStart.classList.remove('hidden');
}

// Flag to prevent double submission
let isCreatingSession = false;

async function createSession() {
    if (isCreatingSession) return;
    isCreatingSession = true;

    try {
        // Show loading state
        const heroCreateBtn = document.getElementById('hero-create-btn');
        if (heroCreateBtn) {
            heroCreateBtn.disabled = true;
            heroCreateBtn.innerHTML = '<span>Creating...</span>';
        }

        const response = await fetch('/api/create-session', { method: 'POST' });
        const data = await response.json();

        sessionId = data.session_id;
        joinToken = data.join_token;
        isSessionCreator = true;
        sessionUrlInput.value = data.session_url;
        qrCodeDisplay.innerHTML = `<img src="${data.qr_code}" alt="Session QR">`;

        // Hide hero content and other marketing sections
        const heroContent = document.querySelector('.hero-content');
        const heroVisual = document.querySelector('.hero-visual');
        const howItWorks = document.querySelector('.how-it-works');
        const ctaSection = document.querySelector('.cta-section');

        if (heroContent) heroContent.style.display = 'none';
        if (heroVisual) heroVisual.style.display = 'none';
        document.querySelectorAll('.features-showcase').forEach(el => el.style.display = 'none');
        if (howItWorks) howItWorks.style.display = 'none';
        if (ctaSection) ctaSection.style.display = 'none';

        // Show session UI inside hero section
        sessionActive.classList.remove('hidden');
        sessionActive.style.animation = 'fadeIn 0.3s ease-out';

        // Move session-active into hero section for proper layout
        const heroSection = document.querySelector('.hero-section');
        if (heroSection && sessionActive.parentElement !== heroSection) {
            heroSection.appendChild(sessionActive);
        }

        startSessionTimer();
        resetSessionStats();
        connectWebSocket();

        console.log('✓ Session created:', sessionId);
    } catch (error) {
        console.error('❌ Failed to create session:', error);
        alert('Failed to create session. Please try again.');

        // Reset button
        const heroCreateBtn = document.getElementById('hero-create-btn');
        if (heroCreateBtn) {
            heroCreateBtn.disabled = false;
            heroCreateBtn.innerHTML = '<span>Start Transfer</span>';
        }
        isCreatingSession = false;
    }
}

async function joinSession(id) {
    sessionId = id;
    isSessionCreator = false;

    // Generate session URL and QR code for receivers
    const currentUrl = window.location.origin;
    const sessionUrl = `${currentUrl}/session/${sessionId}`;

    // Set session URL in all inputs
    if (sessionUrlInput) sessionUrlInput.value = sessionUrl;

    const sessionUrlSidebar = document.getElementById('session-url-sidebar');
    if (sessionUrlSidebar) sessionUrlSidebar.value = sessionUrl;

    // Generate QR code using client-side library
    // Generate QR code using server-side API (avoids CSP issues)
    if (qrCodeDisplay) {
        try {
            const qrResponse = await fetch('/api/generate-qr', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url: sessionUrl })
            });
            const qrData = await qrResponse.json();

            if (qrData.qr_code) {
                qrCodeDisplay.innerHTML = `<img src="${qrData.qr_code}" alt="Session QR">`;
            }
        } catch (error) {
            console.error('❌ Failed to generate QR code:', error);
            qrCodeDisplay.innerHTML = '<p class="text-sm text-error">Failed to load QR</p>';
        }
    }

    // Hide hero content and other marketing sections
    const heroContent = document.querySelector('.hero-content');
    const heroVisual = document.querySelector('.hero-visual');
    const howItWorks = document.querySelector('.how-it-works');
    const ctaSection = document.querySelector('.cta-section');

    if (heroContent) heroContent.style.display = 'none';
    if (heroVisual) heroVisual.style.display = 'none';
    document.querySelectorAll('.features-showcase').forEach(el => el.style.display = 'none');
    if (howItWorks) howItWorks.style.display = 'none';
    if (ctaSection) ctaSection.style.display = 'none';

    // Show session UI inside hero section
    sessionActive.classList.remove('hidden');
    sessionActive.style.animation = 'fadeIn 0.3s ease-out';

    // Move session-active into hero section for proper layout
    const heroSection = document.querySelector('.hero-section');
    if (heroSection && sessionActive.parentElement !== heroSection) {
        heroSection.appendChild(sessionActive);
    }

    startSessionTimer();
    resetSessionStats();
    connectWebSocket();

    console.log('✓ Joined session:', sessionId);
}

function terminateSession() {
    if (!confirm('Are you sure you want to end this session?')) return;

    for (const [peerId, conn] of peerConnections) {
        conn.peerConnection.close();
    }
    peerConnections.clear();

    if (ws) ws.close();
    stopKeepAlive();
    stopSessionTimer();
    resetSessionStats();

    window.location.href = '/';
}

function reconnect() {
    console.log('🔄 Reconnecting...');
    if (ws) ws.close();
    connectWebSocket();
}

// ==================== SESSION TIMER ====================
function startSessionTimer() {
    sessionStartTime = Date.now();

    if (durationInterval) clearInterval(durationInterval);

    durationInterval = setInterval(() => {
        const elapsed = Date.now() - sessionStartTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);

        const durationEl = document.getElementById('session-duration');
        if (durationEl) {
            durationEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }

        updateSidebarStats();
    }, 1000);
}

function stopSessionTimer() {
    if (durationInterval) {
        clearInterval(durationInterval);
        durationInterval = null;
    }
}

// ==================== SESSION STATISTICS ====================
function updateSessionStats(fileSize) {
    sessionFilesCount++;
    sessionTotalData += fileSize;

    console.log(`📊 Stats updated: ${sessionFilesCount} files, ${formatFileSize(sessionTotalData)}`);

    // Update main stats
    const filesCountEl = document.getElementById('files-count');
    const totalDataEl = document.getElementById('total-data');

    if (filesCountEl) filesCountEl.textContent = sessionFilesCount;
    if (totalDataEl) totalDataEl.textContent = formatFileSize(sessionTotalData);

    // Update sidebar stats
    updateSidebarStats();
}

function resetSessionStats() {
    sessionFilesCount = 0;
    sessionTotalData = 0;

    const filesCountEl = document.getElementById('files-count');
    const totalDataEl = document.getElementById('total-data');
    const durationEl = document.getElementById('session-duration');

    if (filesCountEl) filesCountEl.textContent = '0';
    if (totalDataEl) totalDataEl.textContent = '0 MB';
    if (durationEl) durationEl.textContent = '00:00';

    updateSidebarStats();
}

function updateSidebarStats() {
    const sidebarDuration = document.getElementById('sidebar-duration');
    const sidebarFiles = document.getElementById('sidebar-files');
    const sidebarData = document.getElementById('sidebar-data');

    // Get values from main stats or use session variables
    if (sidebarFiles) {
        sidebarFiles.textContent = sessionFilesCount;
    }

    if (sidebarData) {
        sidebarData.textContent = formatFileSize(sessionTotalData);
    }

    // Update duration
    if (sessionStartTime && sidebarDuration) {
        const elapsed = Date.now() - sessionStartTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        sidebarDuration.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

// ==================== WEBSOCKET CONNECTION ====================
// Helper to safely send message when connection is open
function safeSend(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    } else {
        console.log('⏳ Waiting for WebSocket to open...');
        setTimeout(() => safeSend(message), 500);
    }
}

function connectWebSocket() {
    // Prevent multiple connections
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        console.log('⚠️ WebSocket already connecting or connected');
        return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${protocol}//${window.location.host}/ws/${sessionId}`;
    if (joinToken) {
        wsUrl += `?token=${encodeURIComponent(joinToken)}`;
    }

    console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('✓ WebSocket connected');
        updateStatus('connecting', 'Connected to signaling server');

        // Send registration with peer ID using safe sender
        safeSend({
            type: 'register',
            peerId: myPeerId
        });

        startKeepAlive();
    };

    ws.onmessage = async (event) => {
        try {
            const message = JSON.parse(event.data);
            await handleSignalingMessage(message);
        } catch (error) {
            console.error('❌ WebSocket message error:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        updateStatus('error', 'Connection error');
    };

    ws.onclose = () => {
        console.log('⚠️ WebSocket disconnected');
        updateStatus('error', 'Disconnected from signaling server');
        stopKeepAlive();

        // Auto-reconnect after delay
        setTimeout(connectWebSocket, 3000);
    };
}

function startKeepAlive() {
    keepAliveInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            safeSend({ type: 'ping' });
        }
    }, 30000);
}

function stopKeepAlive() {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
}

async function handleSignalingMessage(message) {
    const { type, from, data, peer_count } = message;

    switch (type) {
        case 'register':
            // Ignore register messages from other peers
            break;

        case 'peer-joined':
            console.log(`👤 Peer count: ${peer_count}/${MAX_PEERS}`);
            updatePeerCount(peer_count);

            if (peer_count > 1 && peerConnections.size === 0) {
                setTimeout(() => {
                    console.log('🔗 Attempting to create peer connection...');
                    initiatePeerConnection();
                }, 1000);
            }
            break;

        case 'peer-left':
            console.log(`👤 Peer left. Count: ${peer_count}`);
            updatePeerCount(peer_count);
            break;

        case 'offer':
            console.log('📥 Received offer from:', from);
            await handleOffer(from, data);
            break;

        case 'answer':
            console.log('📥 Received answer from:', from);
            await handleAnswer(from, data);
            break;

        case 'ice-candidate':
            await handleIceCandidate(from, data);
            break;

        case 'pong':
            // Heartbeat response - ignore
            break;

        default:
            console.warn('⚠️ Unknown message type:', type);
    }

    updateOverallConnectionStatus();
}

function sendSignalingMessage(type, targetPeerId, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('❌ WebSocket not connected');
        return;
    }

    const message = {
        type,
        from: myPeerId,
        data
    };

    safeSend(message);
}

// ==================== WEBRTC PEER CONNECTIONS ====================
async function initiatePeerConnection() {
    // Don't create duplicate connections
    if (peerConnections.size > 0) {
        console.log('⚠️ Peer connection already exists');
        return;
    }

    const peerId = generateId();
    console.log('🔗 Creating peer connection:', peerId);

    const peerConnection = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
    });

    const dataChannel = peerConnection.createDataChannel('fileTransfer', {
        ordered: true,
        maxRetransmits: 3
    });

    setupDataChannel(dataChannel, peerId);
    setupPeerConnectionEvents(peerConnection, peerId);

    peerConnections.set(peerId, { peerConnection, dataChannel });

    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        sendSignalingMessage('offer', null, offer);
        console.log('📤 Sent offer');
    } catch (error) {
        console.error('❌ Failed to create offer:', error);
        peerConnections.delete(peerId);
    }
}

async function handleOffer(peerId, offer) {
    // Don't accept offers if we already have a connection
    if (peerConnections.has(peerId)) {
        console.log('⚠️ Already connected to this peer');
        return;
    }

    console.log('📥 Processing offer from:', peerId);

    const peerConnection = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
    });

    peerConnection.ondatachannel = (event) => {
        const dataChannel = event.channel;
        console.log('📨 Data channel received');
        setupDataChannel(dataChannel, peerId);
        peerConnections.set(peerId, { peerConnection, dataChannel });
    };

    setupPeerConnectionEvents(peerConnection, peerId);

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        sendSignalingMessage('answer', null, answer);
        console.log('📤 Sent answer');
    } catch (error) {
        console.error('❌ Failed to handle offer:', error);
    }
}

async function handleAnswer(peerId, answer) {
    // Find any peer connection waiting for an answer
    for (const [id, conn] of peerConnections) {
        if (conn.peerConnection.signalingState === 'have-local-offer') {
            try {
                await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                console.log('✓ Set remote description');
                return;
            } catch (error) {
                console.error('❌ Failed to set remote description:', error);
            }
        }
    }
    console.warn('⚠️ No peer connection waiting for answer');
}

async function handleIceCandidate(peerId, candidate) {
    // Add ICE candidate to any connected peer
    for (const [id, conn] of peerConnections) {
        try {
            await conn.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('✓ Added ICE candidate');
            return;
        } catch (error) {
            console.error('❌ Failed to add ICE candidate:', error);
        }
    }
}

function setupPeerConnectionEvents(peerConnection, peerId) {
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignalingMessage('ice-candidate', peerId, event.candidate);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log(`🔗 Connection state (${peerId}):`, peerConnection.connectionState);

        if (peerConnection.connectionState === 'failed' ||
            peerConnection.connectionState === 'disconnected') {
            setTimeout(() => {
                if (peerConnection.connectionState === 'failed' ||
                    peerConnection.connectionState === 'disconnected') {
                    peerConnections.delete(peerId);
                    updateOverallConnectionStatus();
                }
            }, 5000);
        }

        updateOverallConnectionStatus();
    };
}

// ==================== DATA CHANNEL ====================
function setupDataChannel(dataChannel, peerId) {
    dataChannel.binaryType = 'arraybuffer';

    dataChannel.onopen = () => {
        console.log(`✓ Data channel opened: ${peerId}`);
        updateOverallConnectionStatus();

        // Show transfer area when connected
        const transferArea = document.getElementById('transfer-area');
        if (transferArea) transferArea.classList.remove('hidden');

        // Announce queued files
        announceQueuedFiles(dataChannel);

        // Process queue if not already processing
        if (fileQueue.length > 0 && !currentTransfer) {
            processQueue();
        }
    };

    dataChannel.onclose = () => {
        console.log(`⚠️ Data channel closed: ${peerId}`);
        peerConnections.delete(peerId);
        updateOverallConnectionStatus();
    };

    dataChannel.onerror = (error) => {
        console.error(`❌ Data channel error (${peerId}):`, error);
    };

    dataChannel.onmessage = (event) => {
        handleDataChannelMessage(event.data, peerId);
    };
}

function handleDataChannelMessage(data, peerId) {
    if (typeof data === 'string') {
        try {
            const message = JSON.parse(data);
            handleControlMessage(message, peerId);
        } catch (error) {
            console.error('❌ Failed to parse message:', error);
        }
    } else {
        handleFileChunk(data, peerId);
    }
}

// ==================== FILE HANDLING ====================
function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    addFilesToQueue(files);
    event.target.value = '';
}

function handleDragOver(event) {
    event.preventDefault();
    uploadZone.classList.add('drag-over');
}

function handleDragLeave(event) {
    event.preventDefault();
    uploadZone.classList.remove('drag-over');
}

function handleDrop(event) {
    event.preventDefault();
    uploadZone.classList.remove('drag-over');

    const files = Array.from(event.dataTransfer.files);
    addFilesToQueue(files);
}

function addFilesToQueue(files) {
    files.forEach(file => {
        const fileId = generateId();
        fileQueue.push({ id: fileId, file, progress: 0, status: 'queued' });
        addFileToUI(fileId, file);
    });

    updateQueueBadge();

    if (!currentTransfer) {
        processQueue();
    }
}

function addFileToUI(fileId, file) {
    const emptyMsg = fileList.querySelector('.file-list-empty');
    if (emptyMsg) emptyMsg.remove();

    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.id = `file-${fileId}`;
    fileItem.innerHTML = `
        <div class="file-info">
            <div class="file-icon">${getFileIcon(file.name)}</div>
            <div class="file-details">
                <div class="file-name">${escapeHtml(file.name)}</div>
                <div class="file-size">${formatFileSize(file.size)}</div>
            </div>
        </div>
        <div class="file-actions">
            <div class="file-status">Queued</div>
            <button class="btn-cancel" onclick="cancelTransfer('${fileId}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        </div>
    `;

    fileList.appendChild(fileItem);
}

// ==================== FILE QUEUE PROCESSING ====================
// Resolve functions for pending ready-to-receive signals
let pendingReadyResolve = null;

async function processQueue() {
    if (currentTransfer || fileQueue.length === 0) return;

    const connectedPeers = Array.from(peerConnections.values()).filter(
        conn => conn.dataChannel && conn.dataChannel.readyState === 'open'
    );

    if (connectedPeers.length === 0) {
        console.log('⚠️ No connected peers to send files');
        return;
    }

    const nextFile = fileQueue.find(f => f.status === 'queued');
    if (!nextFile) return;

    currentTransfer = nextFile;
    nextFile.status = 'sending';

    const fileElement = document.getElementById(`file-${nextFile.id}`);
    if (fileElement) {
        const statusEl = fileElement.querySelector('.file-status');
        if (statusEl) statusEl.textContent = 'Waiting for receiver...';
    }

    // Announce file to all peers
    const fileMetadata = {
        type: 'file-metadata',
        fileId: nextFile.id,
        name: nextFile.file.name,
        size: nextFile.file.size,
        mimeType: nextFile.file.type
    };

    connectedPeers.forEach(({ dataChannel }) => {
        if (dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify(fileMetadata));
        }
    });

    // Wait for receiver to pick save location (ready-to-receive signal)
    console.log('⏳ Waiting for receiver to choose save location...');
    await new Promise(resolve => {
        pendingReadyResolve = resolve;
        // Timeout after 2 minutes — receiver may not respond
        setTimeout(() => {
            if (pendingReadyResolve === resolve) {
                console.log('⏳ Ready timeout — starting transfer anyway');
                pendingReadyResolve = null;
                resolve();
            }
        }, 120000);
    });

    if (fileElement) {
        const statusEl = fileElement.querySelector('.file-status');
        if (statusEl) statusEl.textContent = 'Sending...';
    }

    // Start sending file chunks
    await sendFileChunks(nextFile, connectedPeers);
}

async function sendFileChunks(fileTransfer, connectedPeers) {
    const { id, file } = fileTransfer;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let offset = 0;
    let chunkIndex = 0;

    transferStartTime = Date.now();
    lastTransferredBytes = 0;
    let lastUpdateTime = Date.now();

    const fileElement = document.getElementById(`file-${id}`);

    while (offset < file.size && !isCancelling) {
        for (const { dataChannel } of connectedPeers) {
            if (isCancelling) break;
            if (dataChannel.readyState !== 'open') continue;

            // Wait for buffer to drain using event (not polling)
            while (dataChannel.bufferedAmount > MAX_BUFFER_AMOUNT && !isCancelling) {
                await new Promise(resolve => {
                    dataChannel.bufferedAmountLowThreshold = LOW_BUFFER_THRESHOLD;
                    const checkCancel = setInterval(() => {
                        if (isCancelling) {
                            clearInterval(checkCancel);
                            dataChannel.onbufferedamountlow = null;
                            resolve();
                        }
                    }, 100);
                    dataChannel.onbufferedamountlow = () => {
                        clearInterval(checkCancel);
                        dataChannel.onbufferedamountlow = null;
                        resolve();
                    };
                });
            }

            if (isCancelling) break;

            const end = Math.min(offset + CHUNK_SIZE, file.size);
            const chunk = file.slice(offset, end);
            const arrayBuffer = await chunk.arrayBuffer();

            // Send with retry on queue-full
            try {
                dataChannel.send(arrayBuffer);
            } catch (sendError) {
                if (isCancelling) break;
                // Queue full — wait for drain and retry
                await new Promise(resolve => {
                    dataChannel.bufferedAmountLowThreshold = LOW_BUFFER_THRESHOLD;
                    const checkCancel = setInterval(() => {
                        if (isCancelling) {
                            clearInterval(checkCancel);
                            dataChannel.onbufferedamountlow = null;
                            resolve();
                        }
                    }, 100);
                    dataChannel.onbufferedamountlow = () => {
                        clearInterval(checkCancel);
                        dataChannel.onbufferedamountlow = null;
                        resolve();
                    };
                });
                if (!isCancelling) dataChannel.send(arrayBuffer);
            }

            offset += arrayBuffer.byteLength;
            chunkIndex++;

            const now = Date.now();
            if (now - lastUpdateTime > 250) {
                const progress = Math.round((offset / file.size) * 100);
                fileTransfer.progress = progress;

                const timeElapsed = (now - transferStartTime) / 1000;
                transferSpeed = offset / timeElapsed;

                if (fileElement) {
                    updateFileProgress(fileElement, progress, offset, file.size);
                }

                lastUpdateTime = now;
            }
        }
    }

    if (isCancelling) {
        isCancelling = false;
        fileTransfer.status = 'cancelled';
        console.log(`🚫 Transfer cancelled: ${file.name}`);
        if (fileElement) fileElement.remove();
    } else {
        // Send completion message
        connectedPeers.forEach(({ dataChannel }) => {
            if (dataChannel.readyState === 'open') {
                dataChannel.send(JSON.stringify({
                    type: 'file-complete',
                    fileId: id
                }));
            }
        });

        fileTransfer.status = 'completed';

        // Update statistics BEFORE adding to history
        updateSessionStats(file.size);

        // Add to history
        addToHistory(file.name, file.size, 'sent');

        if (fileElement) {
            const statusEl = fileElement.querySelector('.file-status');
            if (statusEl) {
                statusEl.textContent = '✓ Sent';
                statusEl.style.color = 'var(--success)';
            }
        }
    }

    // Remove from queue and process next
    fileQueue = fileQueue.filter(f => f.id !== id);
    currentTransfer = null;
    updateQueueBadge();

    setTimeout(() => {
        if (fileElement) fileElement.remove();
        processQueue();
    }, 2000);
}

function updateFileProgress(fileElement, progress, transferred, total) {
    let progressBar = fileElement.querySelector('.file-progress');

    if (!progressBar) {
        const fileInfo = fileElement.querySelector('.file-info');
        progressBar = document.createElement('div');
        progressBar.className = 'file-progress';
        progressBar.innerHTML = `
            <div class="progress-bar">
                <div class="progress-fill" style="width: 0%"></div>
            </div>
            <div class="progress-info">
                <span class="progress-percent">0%</span>
                <span class="progress-speed">0 MB/s</span>
                <span class="progress-transferred">0 / 0</span>
            </div>
        `;
        fileInfo.after(progressBar);
    }

    const progressFill = progressBar.querySelector('.progress-fill');
    const progressPercent = progressBar.querySelector('.progress-percent');
    const progressSpeed = progressBar.querySelector('.progress-speed');
    const progressTransferred = progressBar.querySelector('.progress-transferred');

    if (progressFill) progressFill.style.width = `${progress}%`;
    if (progressPercent) progressPercent.textContent = `${progress}%`;
    if (progressSpeed) progressSpeed.textContent = formatSpeed(transferSpeed);
    if (progressTransferred) {
        progressTransferred.textContent = `${formatFileSize(transferred)} / ${formatFileSize(total)}`;
    }
}

function calculateTransferSpeed(currentBytes) {
    const now = Date.now();
    const timeDiff = (now - transferStartTime) / 1000;
    const bytesDiff = currentBytes - lastTransferredBytes;

    if (timeDiff > 0) {
        transferSpeed = bytesDiff / timeDiff;
    }

    lastTransferredBytes = currentBytes;
}

// ==================== FILE RECEIVING ====================
function handleControlMessage(message, peerId) {
    const { type } = message;

    switch (type) {
        case 'file-metadata':
            handleFileMetadata(message, peerId);
            break;

        case 'file-chunk':
            // Legacy chunk header — no longer sent in optimized mode
            break;

        case 'file-complete':
            handleFileComplete(message.fileId);
            break;

        case 'ready-to-receive':
            console.log(`✓ Receiver is ready for: ${message.fileId}`);
            if (pendingReadyResolve) {
                const resolve = pendingReadyResolve;
                pendingReadyResolve = null;
                resolve();
            }
            break;

        case 'file-queue':
            console.log(`📋 Peer ${peerId} has ${message.count} files queued`);
            break;

        case 'cancel-transfer':
            handleCancelTransfer(message.fileId);
            break;

        default:
            console.warn('Unknown control message:', type);
    }
}

async function handleFileMetadata(metadata, peerId) {
    const { fileId, name, size, mimeType } = metadata;

    if (receivingFiles.has(fileId)) return;

    console.log(`📥 Incoming file: ${name} (${formatFileSize(size)})`);

    const fileEntry = {
        name,
        size,
        mimeType: mimeType || 'application/octet-stream',
        chunks: [],
        mergedBlobs: [],
        pendingChunkSize: 0,
        receivedSize: 0,
        progress: 0,
        writable: null,
        streamingToDisk: false
    };

    // Warn iOS users about large files (no File System Access API)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS && size > 1024 * 1024 * 1024) {
        console.warn('⚠️ Large file on iOS — memory may be limited');
    }

    receivingFiles.set(fileId, fileEntry);
    addReceivingFileToUI(fileId, name, size);

    // Show accept modal — user MUST click to trigger Save As (browser requires user gesture)
    if ('showSaveFilePicker' in window) {
        const accepted = await showFileAcceptModal(fileId, name, size, mimeType, fileEntry);
        if (!accepted) {
            console.log('⚠️ User skipped save dialog — using in-memory mode');
        }
    }

    // Tell sender we're ready to receive chunks
    const readyMsg = JSON.stringify({
        type: 'ready-to-receive',
        fileId: fileId
    });
    for (const [, conn] of peerConnections) {
        if (conn.dataChannel && conn.dataChannel.readyState === 'open') {
            conn.dataChannel.send(readyMsg);
        }
    }
    console.log('✓ Sent ready-to-receive signal');
}

function showFileAcceptModal(fileId, name, size, mimeType, fileEntry) {
    return new Promise((resolve) => {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.id = `accept-modal-${fileId}`;
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
            display: flex; align-items: center; justify-content: center;
            z-index: 10000; animation: fadeIn 0.2s ease;
        `;

        const icon = getFileIcon(name);
        const modal = document.createElement('div');
        modal.style.cssText = `
            background: var(--bg-secondary, #1e1e2e); border-radius: 16px;
            padding: 32px; max-width: 420px; width: 90%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            text-align: center; color: var(--text-primary, #fff);
        `;
        modal.innerHTML = `
            <div style="font-size: 48px; margin-bottom: 16px;">${icon}</div>
            <h3 style="margin: 0 0 8px; font-size: 18px; word-break: break-word;">${escapeHtml(name)}</h3>
            <p style="margin: 0 0 24px; color: var(--text-secondary, #aaa); font-size: 14px;">
                ${formatFileSize(size)}
            </p>
            <button id="accept-save-btn-${fileId}" style="
                background: linear-gradient(135deg, #6366f1, #8b5cf6);
                color: white; border: none; padding: 14px 32px;
                border-radius: 12px; font-size: 16px; font-weight: 600;
                cursor: pointer; width: 100%; margin-bottom: 12px;
                transition: transform 0.1s, box-shadow 0.2s;
                box-shadow: 0 4px 15px rgba(99,102,241,0.4);
            ">
                💾 Choose Save Location
            </button>
            <button id="accept-skip-btn-${fileId}" style="
                background: transparent; color: var(--text-secondary, #aaa);
                border: 1px solid var(--border, #333); padding: 10px 24px;
                border-radius: 12px; font-size: 14px; cursor: pointer; width: 100%;
            ">
                Skip (use memory — not recommended for large files)
            </button>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // "Choose Save Location" button — this is the user gesture
        const saveBtn = document.getElementById(`accept-save-btn-${fileId}`);
        saveBtn.onmouseenter = () => { saveBtn.style.transform = 'scale(1.02)'; };
        saveBtn.onmouseleave = () => { saveBtn.style.transform = 'scale(1)'; };
        saveBtn.onclick = async () => {
            try {
                const ext = name.includes('.') ? name.split('.').pop() : '';
                const handle = await window.showSaveFilePicker({
                    suggestedName: name,
                    types: ext ? [{
                        description: `${ext.toUpperCase()} file`,
                        accept: { [mimeType || 'application/octet-stream']: [`.${ext}`] }
                    }] : []
                });
                const writable = await handle.createWritable();
                fileEntry.writable = writable;
                fileEntry.streamingToDisk = true;

                // Write any chunks that arrived while modal was showing
                for (const chunk of fileEntry.chunks) {
                    await writable.write(chunk);
                }
                fileEntry.chunks = [];

                console.log(`✓ Save location chosen. Streaming to disk for: ${name}`);

                // Update file item status
                const fileElement = document.getElementById(`file-${fileId}`);
                if (fileElement) {
                    const statusEl = fileElement.querySelector('.file-status');
                    if (statusEl) statusEl.textContent = 'Saving to disk...';
                }

                overlay.remove();
                resolve(true);
            } catch (err) {
                if (err.name === 'AbortError') {
                    // User cancelled the Save As dialog — let them try again
                    console.log('⚠️ Save dialog cancelled, modal still showing');
                } else {
                    console.error('❌ Save dialog error:', err);
                    overlay.remove();
                    resolve(false);
                }
            }
        };

        // "Skip" button — fallback to in-memory mode
        const skipBtn = document.getElementById(`accept-skip-btn-${fileId}`);
        skipBtn.onclick = () => {
            overlay.remove();
            resolve(false);
        };
    });
}

function handleFileChunk(arrayBuffer, peerId) {
    // Find the file that's currently receiving
    for (const [fileId, fileData] of receivingFiles.entries()) {
        if (fileData.receivedSize < fileData.size) {
            fileData.receivedSize += arrayBuffer.byteLength;

            if (fileData.streamingToDisk && fileData.writable) {
                // Stream directly to disk — no RAM accumulation
                fileData.writable.write(new Blob([arrayBuffer])).catch(err => {
                    console.error('❌ Disk write failed:', err);
                    fileData.streamingToDisk = false;
                    fileData.chunks.push(arrayBuffer);
                    fileData.pendingChunkSize += arrayBuffer.byteLength;
                });
            } else {
                // Accumulate in memory with periodic merging
                fileData.chunks.push(arrayBuffer);
                fileData.pendingChunkSize += arrayBuffer.byteLength;

                // Merge chunks into intermediate Blob every 32MB to free ArrayBuffer memory
                if (fileData.pendingChunkSize >= MERGE_THRESHOLD) {
                    const mergedBlob = new Blob(fileData.chunks, { type: 'application/octet-stream' });
                    fileData.mergedBlobs.push(mergedBlob);
                    fileData.chunks = []; // Free all ArrayBuffer references
                    fileData.pendingChunkSize = 0;
                }
            }

            const progress = Math.round((fileData.receivedSize / fileData.size) * 100);
            fileData.progress = progress;

            // Update UI with progress
            updateReceivingProgress(fileId, progress, fileData.receivedSize, fileData.size);

            // Check if complete
            if (fileData.receivedSize >= fileData.size) {
                completeFileReceive(fileId, fileData);
            }

            break;
        }
    }
}

function handleFileComplete(fileId) {
    const fileData = receivingFiles.get(fileId);
    if (!fileData) return;

    completeFileReceive(fileId, fileData);
}

async function completeFileReceive(fileId, fileData) {
    const fileElement = document.getElementById(`file-${fileId}`);

    if (fileData.streamingToDisk && fileData.writable) {
        // ============ STREAMING MODE: File already on disk ============
        try {
            await fileData.writable.close();
            console.log(`✓ File saved to disk: ${fileData.name} (${formatFileSize(fileData.receivedSize)})`);
        } catch (err) {
            console.error('❌ Failed to close file:', err);
        }

        receivingFiles.delete(fileId);

        if (fileElement) {
            const statusEl = fileElement.querySelector('.file-status');
            if (statusEl) {
                statusEl.textContent = '✓ Saved to disk';
                statusEl.style.color = 'var(--success)';
            }

            const progressBar = fileElement.querySelector('.file-progress');
            if (progressBar) progressBar.remove();

            // Remove the "Save to..." button
            const saveToBtn = fileElement.querySelector(`#save-to-${fileId}`);
            if (saveToBtn) saveToBtn.remove();

            const actionsDiv = fileElement.querySelector('.file-actions');
            if (actionsDiv) {
                const doneLabel = document.createElement('span');
                doneLabel.className = 'btn-download';
                doneLabel.style.opacity = '0.6';
                doneLabel.style.pointerEvents = 'none';
                doneLabel.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 6L9 17l-5-5"/>
                    </svg>
                    Saved ✓
                `;
                actionsDiv.appendChild(doneLabel);
            }
        }

        addToHistory(fileData.name, fileData.size, 'received');
        updateSessionStats(fileData.size);
        return;
    }

    // ============ IN-MEMORY MODE: Create blob and offer download ============
    // Combine intermediate merged blobs with any remaining chunks
    const blobParts = [...(fileData.mergedBlobs || []), ...fileData.chunks];
    const blob = new Blob(blobParts, { type: fileData.mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    console.log(`✓ File received (in-memory): ${fileData.name} — Blob: ${formatFileSize(blob.size)}`);

    receivedFiles[fileId] = {
        blob,
        url,
        name: fileData.name,
        size: fileData.size
    };
    receivingFiles.delete(fileId);
    fileData.chunks = null; // Free chunk memory
    fileData.mergedBlobs = null; // Free merged blob references

    if (fileElement) {
        const statusEl = fileElement.querySelector('.file-status');
        if (statusEl) {
            statusEl.textContent = '✓ Received';
            statusEl.style.color = 'var(--success)';
        }

        const progressBar = fileElement.querySelector('.file-progress');
        if (progressBar) progressBar.remove();

        // Remove save-to button if present
        const saveToBtn = fileElement.querySelector(`#save-to-${fileId}`);
        if (saveToBtn) saveToBtn.remove();

        const actionsDiv = fileElement.querySelector('.file-actions');
        if (actionsDiv) {
            const cancelBtn = actionsDiv.querySelector('.btn-cancel');
            if (cancelBtn) cancelBtn.remove();

            // Native <a> download link
            const downloadLink = document.createElement('a');
            downloadLink.href = url;
            downloadLink.download = fileData.name;
            downloadLink.className = 'btn-download';
            downloadLink.style.textDecoration = 'none';
            downloadLink.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
                Download
            `;
            downloadLink.addEventListener('click', () => {
                console.log('📥 Download link clicked for:', fileData.name);
                addToHistory(fileData.name, fileData.size, 'received');
                setTimeout(() => {
                    downloadLink.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 6L9 17l-5-5"/>
                        </svg>
                        Downloaded
                    `;
                    downloadLink.style.opacity = '0.6';
                    downloadLink.style.pointerEvents = 'none';
                }, 500);
            });
            actionsDiv.appendChild(downloadLink);
        }
    }

    // Auto-download for smaller files only (< 500 MB)
    if (blob.size < 500 * 1024 * 1024) {
        try {
            const autoLink = document.createElement('a');
            autoLink.href = url;
            autoLink.download = fileData.name;
            autoLink.style.display = 'none';
            document.body.appendChild(autoLink);
            autoLink.click();
            setTimeout(() => document.body.removeChild(autoLink), 1000);
            console.log('✓ Auto-download triggered');
        } catch (err) {
            console.warn('⚠️ Auto-download failed:', err.message);
        }
    }

    updateSessionStats(fileData.size);
}

function addReceivingFileToUI(fileId, name, size) {
    const emptyMsg = fileList.querySelector('.file-list-empty');
    if (emptyMsg) emptyMsg.remove();

    const fileItem = document.createElement('div');
    fileItem.className = 'file-item receiving';
    fileItem.id = `file-${fileId}`;
    fileItem.innerHTML = `
        <div class="file-info">
            <div class="file-icon">${getFileIcon(name)}</div>
            <div class="file-details">
                <div class="file-name">${escapeHtml(name)}</div>
                <div class="file-size">${formatFileSize(size)}</div>
            </div>
        </div>
        <div class="file-actions">
            <div class="file-status">Receiving...</div>
        </div>
    `;

    fileList.appendChild(fileItem);
}

function updateReceivingProgress(fileId, progress, received, total) {
    const fileElement = document.getElementById(`file-${fileId}`);
    if (!fileElement) return;

    let progressBar = fileElement.querySelector('.file-progress');

    if (!progressBar) {
        const fileInfo = fileElement.querySelector('.file-info');
        progressBar = document.createElement('div');
        progressBar.className = 'file-progress';
        progressBar.innerHTML = `
            <div class="progress-bar">
                <div class="progress-fill" style="width: 0%"></div>
            </div>
            <div class="progress-info">
                <span class="progress-percent">0%</span>
                <span class="progress-transferred">0 / 0</span>
            </div>
        `;
        fileInfo.after(progressBar);
    }

    const progressFill = progressBar.querySelector('.progress-fill');
    const progressPercent = progressBar.querySelector('.progress-percent');
    const progressTransferred = progressBar.querySelector('.progress-transferred');

    if (progressFill) {
        progressFill.style.width = `${progress}%`;
        // Add animation
        progressFill.style.transition = 'width 0.3s ease';
    }

    if (progressPercent) {
        progressPercent.textContent = `${progress}%`;
    }

    if (progressTransferred) {
        progressTransferred.textContent = `${formatFileSize(received)} / ${formatFileSize(total)}`;
    }

    // Update status text
    const statusEl = fileElement.querySelector('.file-status');
    if (statusEl) {
        statusEl.textContent = `Receiving... ${progress}%`;
    }
}

// ==================== UI UPDATES ====================
function updateStatus(state, text) {
    const statusText = document.getElementById('status-text');
    const connectionRing = document.querySelector('.connection-ring');
    const connectionDot = document.querySelector('.connection-dot');

    if (statusText) {
        statusText.textContent = text;
        statusText.className = 'status-message';
        if (state === 'connected') statusText.classList.add('connected');
        if (state === 'connecting') statusText.classList.add('connecting');
        if (state === 'error') statusText.classList.add('error');
    }

    if (connectionRing && connectionDot) {
        switch (state) {
            case 'connected':
                connectionRing.style.borderColor = 'var(--success)';
                connectionDot.style.background = 'var(--success)';
                break;
            case 'connecting':
                connectionRing.style.borderColor = 'var(--warning)';
                connectionDot.style.background = 'var(--warning)';
                break;
            case 'error':
                connectionRing.style.borderColor = 'var(--danger)';
                connectionDot.style.background = 'var(--danger)';
                break;
            default:
                connectionRing.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                connectionDot.style.background = 'rgba(255, 255, 255, 0.3)';
        }
    }
}

function updatePeerCount(count) {
    // Show total participants in session (backend already sends correct count)
    const totalInSession = count;

    const peerCountEl = document.getElementById('peer-count');
    const peerCountDisplay = document.getElementById('peer-count-display');

    if (peerCountEl) {
        peerCountEl.textContent = `${totalInSession}/${MAX_PEERS} peers`;
    }

    if (peerCountDisplay) {
        const othersConnected = Math.max(0, totalInSession - 1);
        if (othersConnected === 0) {
            peerCountDisplay.textContent = `Waiting for peers to join...`;
        } else {
            peerCountDisplay.textContent = `${othersConnected} other peer${othersConnected !== 1 ? 's' : ''} connected`;
        }
    }

    currentPeerCount = totalInSession;

    console.log(`👥 Total in session: ${totalInSession}/${MAX_PEERS}`);
}

function updateOverallConnectionStatus() {
    const connectedCount = Array.from(peerConnections.values()).filter(
        conn => conn.peerConnection.connectionState === 'connected' &&
            conn.dataChannel && conn.dataChannel.readyState === 'open'
    ).length;

    currentPeerCount = connectedCount;

    if (connectedCount > 0) {
        updateStatus('connected', `Connected to ${connectedCount} peer${connectedCount !== 1 ? 's' : ''}`);
        showConnectedState();
    } else {
        updateStatus('connecting', 'Waiting for peers...');
    }

    const peerCountEl = document.getElementById('peer-count');
    if (peerCountEl) {
        peerCountEl.textContent = `${connectedCount}/2 peers`;
    }

    updateSidebarStats();
}

function showConnectedState() {
    const waitingState = document.getElementById('waiting-state');
    const connectedState = document.getElementById('connected-state');

    if (waitingState && !waitingState.classList.contains('hidden')) {
        waitingState.classList.add('hidden');
    }

    if (connectedState && connectedState.classList.contains('hidden')) {
        connectedState.classList.remove('hidden');

        // Copy session URL to sidebar
        const sessionUrlMain = document.getElementById('session-url');
        const sessionUrlSidebar = document.getElementById('session-url-sidebar');

        if (sessionUrlMain && sessionUrlSidebar) {
            sessionUrlSidebar.value = sessionUrlMain.value;
        }

        // Initialize QR modal
        initQRModal();

        // Setup sidebar copy button
        setupSidebarCopyButton();
    }
}

function setupSidebarCopyButton() {
    const copySidebarBtn = document.getElementById('copy-url-sidebar');
    if (!copySidebarBtn) return;

    copySidebarBtn.addEventListener('click', () => {
        const urlInput = document.getElementById('session-url-sidebar');
        if (urlInput) {
            urlInput.select();
            document.execCommand('copy');

            const originalHTML = copySidebarBtn.innerHTML;
            copySidebarBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';

            setTimeout(() => {
                copySidebarBtn.innerHTML = originalHTML;
            }, 2000);
        }
    });
}

function updateQueueBadge() {
    const queueCount = document.getElementById('queue-count');
    if (queueCount) {
        const count = fileQueue.filter(f => f.status === 'queued').length;
        queueCount.textContent = count;
    }
}

// ==================== QR MODAL ====================
function initQRModal() {
    const showQRBtn = document.getElementById('show-qr-modal');
    const closeQRBtn = document.getElementById('close-qr-modal');
    const qrModal = document.getElementById('qr-modal');
    const qrModalOverlay = document.querySelector('.qr-modal-overlay');
    const copyModalBtn = document.getElementById('copy-url-modal');

    if (showQRBtn) {
        showQRBtn.addEventListener('click', () => {
            const qrMain = document.getElementById('qr-code-display');
            const qrModalDiv = document.getElementById('qr-code-modal');
            const sessionUrlMain = document.getElementById('session-url');
            const sessionUrlModal = document.getElementById('session-url-modal');

            if (qrMain && qrModalDiv) {
                qrModalDiv.innerHTML = qrMain.innerHTML;
            }

            if (sessionUrlMain && sessionUrlModal) {
                sessionUrlModal.value = sessionUrlMain.value;
            }

            qrModal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        });
    }

    if (closeQRBtn) closeQRBtn.addEventListener('click', closeQRModal);
    if (qrModalOverlay) qrModalOverlay.addEventListener('click', closeQRModal);

    if (copyModalBtn) {
        copyModalBtn.addEventListener('click', () => {
            const urlInput = document.getElementById('session-url-modal');
            if (urlInput) {
                urlInput.select();
                document.execCommand('copy');

                const originalText = copyModalBtn.innerHTML;
                copyModalBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Copied!';
                copyModalBtn.style.background = 'var(--success)';

                setTimeout(() => {
                    copyModalBtn.innerHTML = originalText;
                    copyModalBtn.style.background = '';
                }, 2000);
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeQRModal();
    });
}

function closeQRModal() {
    const qrModal = document.getElementById('qr-modal');
    if (qrModal) {
        qrModal.classList.add('hidden');
        document.body.style.overflow = '';
    }
}

// ==================== TRANSFER HISTORY ====================
function addToHistory(filename, size, direction, fileId = null) {
    const emptyMsg = historyList.querySelector('.history-list-empty');
    if (emptyMsg) emptyMsg.remove();

    const historyItem = document.createElement('div');
    historyItem.className = 'file-item history-item';

    let actionButton = '';
    if (direction === 'received' && fileId && receivedFiles[fileId]) {
        actionButton = `
            <button class="btn-download-small" onclick="downloadFile('${fileId}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
            </button>
        `;
    }

    historyItem.innerHTML = `
        <div class="file-info">
            <div class="file-icon">${direction === 'sent' ? '📤' : '📥'}</div>
            <div class="file-details">
                <div class="file-name">${escapeHtml(filename)}</div>
                <div class="file-size">${formatFileSize(size)} - ${escapeHtml(direction)}</div>
            </div>
        </div>
        <div class="file-timestamp">
            ${new Date().toLocaleTimeString()}
            ${actionButton}
        </div>
    `;

    historyList.appendChild(historyItem);
    // Note: Stats are updated in sendFile/receiveFile before calling addToHistory
}

// ==================== HELPER FUNCTIONS ====================
function copySessionUrl() {
    sessionUrlInput.select();
    document.execCommand('copy');

    const originalText = copyUrlBtn.innerHTML;
    copyUrlBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Copied';

    setTimeout(() => {
        copyUrlBtn.innerHTML = originalText;
    }, 2000);
}

function cancelTransfer(fileId) {
    const fileIndex = fileQueue.findIndex(f => f.id === fileId);
    if (fileIndex === -1) return;

    if (currentTransfer && currentTransfer.id === fileId) {
        isCancelling = true;

        // Notify peers
        peerConnections.forEach(({ dataChannel }) => {
            if (dataChannel.readyState === 'open') {
                dataChannel.send(JSON.stringify({
                    type: 'cancel-transfer',
                    fileId
                }));
            }
        });
    } else {
        fileQueue.splice(fileIndex, 1);
        const fileElement = document.getElementById(`file-${fileId}`);
        if (fileElement) fileElement.remove();
        updateQueueBadge();
    }
}

function handleCancelTransfer(fileId) {
    receivingFiles.delete(fileId);
    const fileElement = document.getElementById(`file-${fileId}`);
    if (fileElement) fileElement.remove();
}

function announceQueuedFiles(dataChannel) {
    if (dataChannel.readyState !== 'open') return;

    const queuedCount = fileQueue.filter(f => f.status === 'queued').length;
    if (queuedCount > 0) {
        dataChannel.send(JSON.stringify({
            type: 'file-queue',
            count: queuedCount
        }));
    }
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const iconMap = {
        pdf: '📄', doc: '📄', docx: '📄', txt: '📄',
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️',
        mp4: '🎬', avi: '🎬', mov: '🎬', mkv: '🎬',
        mp3: '🎵', wav: '🎵', flac: '🎵', m4a: '🎵',
        zip: '📦', rar: '📦', '7z': '📦', tar: '📦',
        exe: '⚙️', app: '⚙️', dmg: '⚙️'
    };
    return iconMap[ext] || '📎';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatSpeed(bytesPerSecond) {
    return `${formatFileSize(bytesPerSecond)}/s`;
}

function generateId() {
    const array = new Uint8Array(12);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// ==================== CLEANUP ====================
window.addEventListener('beforeunload', () => {
    if (currentTransfer) {
        return 'File transfer in progress. Are you sure you want to leave?';
    }
});

console.log('🚀 StreamSnatcher initialized');
