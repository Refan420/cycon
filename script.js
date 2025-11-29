// frontend/script.js - FIXED VERSION

// =================================================================
// GLOBALS & LANGUAGE 
// =================================================================
const socket = io();
let sessionKey = null;
let pc = null;
let dataChannel = null;
let localStream = null;
let isCaller = false;
let currentCallType = null;
let callRinger = null;
let currentVideoConstraint = 'user';

// Timer Globals
let timerInterval = null;
let secondsElapsed = 0;

const LANG = {
    en: { genKey: "Generate Key", connect: "Connect", leave: "Leave", chat: "Chat 💬", audio: "Audio 🔊", video: "Video 📹", placeholderKey: "Enter key to join", sending: "You: " },
    bn: { genKey: "কি জেনারেট করুন", connect: "সংযুক্ত করুন", leave: "ছেড়ে দিন", chat: "চ্যাট 💬", audio: "অডিও 🔊", video: "ভিডিও 📹", placeholderKey: "যোগদানের জন্য কী লিখুন", sending: "আপনি: " }
};
let curLang = 'en';
function t(k) { return LANG[curLang][k] || k; }

// =================================================================
// UI ELEMENTS
// =================================================================
const genKeyBtn = document.getElementById('genKey');
const joinBtn = document.getElementById('joinBtn');
const keyInput = document.getElementById('keyInput');
const sessionArea = document.getElementById('sessionArea');
const sessionKeySpan = document.getElementById('sessionKey');
const btnChat = document.getElementById('btnChat');
const btnAudio = document.getElementById('btnAudio');
const btnVideo = document.getElementById('btnVideo');
const videoCol = document.querySelector('.video-col');
const btnLeave = document.getElementById('btnLeave');
const chatBox = document.getElementById('chatBox');
const chatMsg = document.getElementById('chatMsg');
const sendMsg = document.getElementById('sendMsg');
const btnReload = document.getElementById('btnReload');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const copyKeyBtn = document.getElementById('copyKeyBtn');
const callControlArea = document.getElementById('callControlArea');
const callStatusMessage = document.getElementById('callStatusMessage');
const btnReceiveCall = document.getElementById('btnReceiveCall');
const btnRejectCall = document.getElementById('btnRejectCall');
const flipCameraButton = document.getElementById('flip-camera-button');
const muteMicButton = document.getElementById('mute-mic-button');
const endCallButton = document.getElementById('end-call-button');
const maximizeButton = document.getElementById('maximize-button');
const callControlsBar = document.getElementById('callControlsBar');
const callTimer = document.getElementById('callTimer');

// =================================================================
// UI & Call Control Helpers
// =================================================================

function startRinging() {
    if (!callRinger) {
        callRinger = new Audio('ringing.mp3');
        callRinger.loop = true;
        callRinger.play().catch(e => console.warn("Ringing failed:", e));
    }
}

function stopRinging() {
    if (callRinger) {
        callRinger.pause();
        callRinger.currentTime = 0;
        callRinger = null;
    }
}

function showVideoArea() {
    if (videoCol) videoCol.style.display = 'flex';
    if (callControlsBar) callControlsBar.hidden = false;
}

function hideVideoArea() {
    if (videoCol) videoCol.style.display = 'none';
    if (callControlsBar) callControlsBar.hidden = true;
    if (muteMicButton) muteMicButton.hidden = true;
    if (endCallButton) endCallButton.hidden = true;
    if (maximizeButton) maximizeButton.hidden = true;
    if (flipCameraButton) flipCameraButton.hidden = true;
    if (videoCol) videoCol.classList.remove('maximized');
}

function showCallControls(message) {
    callStatusMessage.textContent = message;
    callControlArea.hidden = false;
    btnAudio.disabled = true;
    btnVideo.disabled = true;
}

function hideCallControls() {
    callControlArea.hidden = true;
    btnAudio.disabled = false;
    btnVideo.disabled = false;
}

function startTimer() {
    secondsElapsed = 0;
    callTimer.hidden = false;

    function updateTimer() {
        secondsElapsed++;
        const h = String(Math.floor(secondsElapsed / 3600)).padStart(2, '0');
        const m = String(Math.floor((secondsElapsed % 3600) / 60)).padStart(2, '0');
        const s = String(secondsElapsed % 60).padStart(2, '0');
        callTimer.textContent = `${h}:${m}:${s}`;
    }

    clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
}

function stopTimer() {
    clearInterval(timerInterval);
    callTimer.hidden = true;
    callTimer.textContent = '00:00:00';
}

async function disconnectCall(sendSignal = true) {
    if (!pc) return;

    stopTimer();
    stopRinging();

    // Stop local tracks
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
        });
        localStream = null;
    }

    // Clear video elements
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;

    currentCallType = null;
    hideVideoArea();
    appendSystem('Call ended. Chat connection maintained.');
    btnAudio.disabled = false;
    btnVideo.disabled = false;

    if (sendSignal && sessionKey) {
        socket.emit('end_call_signal', { key: sessionKey });
    }
}

// =================================================================
// ESSENTIAL UI CONTROL FUNCTIONS
// =================================================================

async function flipCamera() {
    if (!pc || !localStream || currentCallType !== 'video') {
        appendSystem('Cannot flip camera: Not in a video call.');
        return;
    }

    currentVideoConstraint = (currentVideoConstraint === 'user') ? 'environment' : 'user';
    appendSystem(`Switching to ${currentVideoConstraint === 'user' ? 'Front' : 'Rear'} camera...`);

    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: { facingMode: currentVideoConstraint }
        });

        const videoTrack = newStream.getVideoTracks()[0];
        const audioTrack = newStream.getAudioTracks()[0];

        // Replace tracks in peer connection
        const senders = pc.getSenders();
        const videoSender = senders.find(sender => sender.track && sender.track.kind === 'video');
        const audioSender = senders.find(sender => sender.track && sender.track.kind === 'audio');

        if (videoSender && videoTrack) {
            await videoSender.replaceTrack(videoTrack);
        }

        if (audioSender && audioTrack) {
            const wasMuted = !localStream.getAudioTracks()[0].enabled;
            await audioSender.replaceTrack(audioTrack);
            audioTrack.enabled = !wasMuted;
        }

        // Stop old tracks
        localStream.getTracks().forEach(track => track.stop());
        localStream = newStream;
        localVideo.srcObject = localStream;

        appendSystem('Camera successfully flipped.');
    } catch (err) {
        appendSystem('Failed to flip camera: ' + err.message);
        currentVideoConstraint = (currentVideoConstraint === 'user') ? 'environment' : 'user';
    }
}

function handleMuteMic() {
    if (!localStream || localStream.getAudioTracks().length === 0) {
        appendSystem('Error: Not currently transmitting audio.');
        return;
    }
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        muteMicButton.textContent = audioTrack.enabled ? 'Mute Mic' : 'Unmute Mic';
        appendSystem(audioTrack.enabled ? 'Microphone Unmuted.' : 'Microphone Muted.');
    }
}

function handleMaximize() {
    if (videoCol.style.display === 'flex') {
        videoCol.classList.toggle('maximized');
        maximizeButton.textContent = videoCol.classList.contains('maximized') ? 'Minimize' : 'Maximize';
        appendSystem(videoCol.classList.contains('maximized') ? 'Video maximized.' : 'Video minimized.');
    }
}

if (flipCameraButton) flipCameraButton.onclick = flipCamera;
if (muteMicButton) muteMicButton.onclick = handleMuteMic;
if (maximizeButton) maximizeButton.onclick = handleMaximize;
if (endCallButton) endCallButton.onclick = () => disconnectCall(true);

// =================================================================
// CORE WEB-RTC AND MEDIA LOGIC
// =================================================================

async function getLocalMedia(constraints) {
    try {
        const mediaConstraints = constraints.video
            ? { audio: true, video: { facingMode: currentVideoConstraint } }
            : { audio: true, video: false };

        const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        localStream = stream;
        localVideo.srcObject = stream;

        if (!constraints.video) {
            localVideo.style.display = 'none';
            remoteVideo.style.display = 'none';
            if (muteMicButton) muteMicButton.hidden = false;
            if (endCallButton) endCallButton.hidden = false;
            if (maximizeButton) maximizeButton.hidden = true;
            if (flipCameraButton) flipCameraButton.hidden = true;
        } else {
            localVideo.style.display = 'block';
            remoteVideo.style.display = 'block';
            if (muteMicButton) muteMicButton.hidden = false;
            if (endCallButton) endCallButton.hidden = false;
            if (maximizeButton) maximizeButton.hidden = false;
            if (flipCameraButton) flipCameraButton.hidden = false;
        }

        if (muteMicButton) muteMicButton.textContent = 'Mute Mic';
        showVideoArea();

        return true;
    } catch (err) {
        alert('Media error: ' + err.message);
        hideVideoArea();
        return false;
    }
}

async function createPeerConnection(mode) {
    pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    pc.onicecandidate = e => {
        if (e.candidate) {
            socket.emit('ice', { key: sessionKey, candidate: e.candidate });
        }
    };

    pc.ontrack = e => {
        console.log('Received remote track:', e.track.kind);
        if (e.streams && e.streams[0]) {
            remoteVideo.srcObject = e.streams[0];
            if (!timerInterval) {
                startTimer();
            }
            appendSystem('Remote stream connected.');
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log('ICE Connection State:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
            appendSystem('Connection failed. Please try again.');
        }
    };

    if (mode === 'caller') {
        dataChannel = pc.createDataChannel('chat');
        setupDataChannel();
    } else {
        pc.ondatachannel = e => {
            dataChannel = e.channel;
            setupDataChannel();
        };
    }

    return pc;
}

function setupDataChannel() {
    if (!dataChannel) return;
    dataChannel.onopen = () => appendSystem('Chat ready.');
    dataChannel.onmessage = ev => appendChat(ev.data, false);
    dataChannel.onerror = e => console.error('Data Channel Error:', e);
    dataChannel.onclose = () => appendSystem('Chat closed.');
}

// =================================================================
// SOCKET HANDLERS
// =================================================================

genKeyBtn.onclick = () => socket.emit('generate_key');

socket.on('key_generated', d => {
    sessionKey = d.key;
    sessionKeySpan.textContent = sessionKey;
    sessionArea.hidden = false;
    socket.emit('join_key', { key: sessionKey });
});

joinBtn.onclick = () => {
    const key = keyInput.value.trim().toUpperCase();
    if (!key) return appendSystem('Error: Enter key');
    sessionKey = key;
    socket.emit('join_key', { key });
};

socket.on('join_error', d => appendSystem('Join error: ' + (d.reason || 'unknown')));

socket.on('joined', async d => {
    sessionKeySpan.textContent = sessionKey;
    sessionArea.hidden = false;
    appendSystem('Connected to session: ' + sessionKey);

    if (!pc) {
        isCaller = d.peers === 1;
        await createPeerConnection(isCaller ? 'caller' : 'receiver');
        appendSystem(isCaller ? 'You are the host.' : 'Joined as peer.');
    }
});

socket.on('peer_joined', () => appendSystem('Peer joined.'));

socket.on('start_call', async () => {
    appendSystem('Initializing connection...');
    if (pc && isCaller) {
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { key: sessionKey, sdp: pc.localDescription });
        } catch (e) {
            console.error('Offer creation failed:', e);
        }
    }
});

socket.on('offer', async d => {
    if (!d.sdp || !pc) return;
    
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
        
        // Add local tracks if we have them
        if (localStream) {
            localStream.getTracks().forEach(track => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === track.kind);
                if (!sender) {
                    pc.addTrack(track, localStream);
                }
            });
        }
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { key: sessionKey, sdp: pc.localDescription });
        appendSystem('Answered call.');
    } catch (e) {
        console.error('Error handling offer:', e);
    }
});

socket.on('answer', async d => {
    if (!d.sdp || !pc) return;
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
        appendSystem('Connection established.');
    } catch (e) {
        console.error('Error handling answer:', e);
    }
});

socket.on('ice', async d => {
    if (d.candidate && pc) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(d.candidate));
        } catch (e) {
            console.warn('ICE candidate error:', e);
        }
    }
});

socket.on('peer_left', () => {
    appendSystem('Peer left.');
    disconnectCall(false);
    if (pc) {
        pc.close();
        pc = null;
        dataChannel = null;
    }
    sessionArea.hidden = true;
    sessionKey = null;
});

socket.on('end_call_signal', () => {
    appendSystem('Peer ended the call.');
    stopRinging();
    disconnectCall(false);
});

socket.on('incoming_call', async d => {
    if (localStream) {
        socket.emit('reject_call', { key: sessionKey, reason: 'busy' });
        return;
    }

    currentCallType = d.callType;
    const message = d.callType === 'video' ? 'Incoming Video Call...' : 'Incoming Audio Call...';
    showCallControls(message);
    appendSystem(message);
    startRinging();
});

socket.on('accept_call', async () => {
    appendSystem('Call accepted. Starting...');
    hideCallControls();
    
    const success = await getLocalMedia({ 
        audio: true, 
        video: currentCallType === 'video' 
    });
    
    if (success && localStream) {
        // Add tracks to peer connection
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
        
        // Create and send offer
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { key: sessionKey, sdp: pc.localDescription });
        } catch (e) {
            console.error('Failed to create offer:', e);
            disconnectCall(true);
        }
    } else {
        disconnectCall(true);
    }
});

socket.on('reject_call', d => {
    appendSystem(`Call rejected: ${d.reason || 'No reason'}`);
    hideCallControls();
    btnAudio.disabled = false;
    btnVideo.disabled = false;
    currentCallType = null;
    stopRinging();
});

// =================================================================
// UI HANDLERS
// =================================================================

if (btnReceiveCall) {
    btnReceiveCall.onclick = async () => {
        if (!currentCallType) return;
        stopRinging();
        
        const success = await getLocalMedia({
            audio: true,
            video: currentCallType === 'video'
        });
        
        if (success && localStream) {
            // Add tracks
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
            
            socket.emit('accept_call', { key: sessionKey });
            hideCallControls();
            appendSystem('Accepting call...');
        } else {
            socket.emit('reject_call', { key: sessionKey, reason: 'media_failure' });
            currentCallType = null;
        }
    };
}

if (btnRejectCall) {
    btnRejectCall.onclick = () => {
        if (currentCallType) {
            socket.emit('reject_call', { key: sessionKey, reason: 'user_rejected' });
            appendSystem('Call rejected.');
            hideCallControls();
            stopRinging();
            currentCallType = null;
        }
    };
}

document.getElementById('lang-en').onclick = () => switchLang('en');
document.getElementById('lang-bn').onclick = () => switchLang('bn');

function switchLang(l) {
    curLang = l;
    document.getElementById('lang-en').classList.toggle('active', l === 'en');
    document.getElementById('lang-bn').classList.toggle('active', l === 'bn');
    genKeyBtn.textContent = t('genKey');
    joinBtn.textContent = t('connect');
    keyInput.placeholder = t('placeholderKey');
    btnChat.textContent = t('chat');
    btnAudio.textContent = t('audio');
    btnVideo.textContent = t('video');
    btnLeave.textContent = t('leave');
}
switchLang('en');

btnReload.onclick = () => window.location.reload();

keyInput.addEventListener('input', function() {
    this.value = this.value.toUpperCase();
});

if (copyKeyBtn) {
    copyKeyBtn.onclick = () => {
        if (sessionKey) {
            navigator.clipboard.writeText(sessionKey).then(() => {
                appendSystem('Key copied!');
            }).catch(err => console.error('Copy failed:', err));
        }
    };
}

btnChat.onclick = () => {
    if (!dataChannel || dataChannel.readyState !== 'open') {
        appendSystem('Chat not ready.');
    } else {
        appendSystem('Chat is active.');
    }
};

btnAudio.onclick = async () => {
    if (pc && sessionKey && isCaller && !localStream) {
        currentCallType = 'audio';
        appendSystem('Calling...');
        socket.emit('incoming_call', { key: sessionKey, callType: 'audio' });
        btnAudio.disabled = true;
        btnVideo.disabled = true;
    } else if (localStream) {
        appendSystem('Call already in progress.');
    } else if (!isCaller) {
        appendSystem('Only host can start calls.');
    }
};

btnVideo.onclick = async () => {
    if (pc && sessionKey && isCaller && !localStream) {
        currentCallType = 'video';
        appendSystem('Calling...');
        socket.emit('incoming_call', { key: sessionKey, callType: 'video' });
        btnAudio.disabled = true;
        btnVideo.disabled = true;
    } else if (localStream) {
        appendSystem('Call already in progress.');
    } else if (!isCaller) {
        appendSystem('Only host can start calls.');
    }
};

btnLeave.onclick = () => {
    disconnectCall(true);
    if (pc) {
        pc.close();
        pc = null;
        dataChannel = null;
    }
    hideVideoArea();
    hideCallControls();
    stopRinging();
    stopTimer();
    currentCallType = null;
    
    if (sessionKey) {
        socket.emit('leave_key', { key: sessionKey });
        sessionKey = null;
        sessionArea.hidden = true;
        appendSystem('Left session.');
    }
};

sendMsg.onclick = () => {
    const v = chatMsg.value.trim();
    if (!v || !dataChannel) return;
    if (dataChannel.readyState === 'open') {
        dataChannel.send(v);
        appendChat(v, true);
        chatMsg.value = '';
    } else {
        appendSystem('Chat not ready.');
    }
};

chatMsg.addEventListener('keydown', e => e.key === 'Enter' && sendMsg.click());

function appendChat(text, me) {
    const div = document.createElement('div');
    div.className = 'chat-msg' + (me ? ' me' : '');
    div.textContent = (me ? t('sending') : '') + text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function appendSystem(text) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.style.opacity = '0.6';
    div.textContent = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

window.addEventListener('beforeunload', () => {
    try {
        if (sessionKey) {
            disconnectCall(false);
            socket.emit('leave_key', { key: sessionKey });
        }
        socket.close();
    } catch (e) {}
});