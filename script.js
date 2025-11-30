// frontend/script.js - FULLY CORRECTED VERSION

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
const remoteVideoContainer = document.getElementById('remoteVideoContainer');
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
        // Create classic phone ringing sound using Web Audio API
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Create a buffer for the ringing pattern
        const sampleRate = audioContext.sampleRate;
        const ringDuration = 2; // 2 seconds per ring cycle
        const buffer = audioContext.createBuffer(1, sampleRate * ringDuration, sampleRate);
        const data = buffer.getChannelData(0);
        
        // Generate classic dual-tone ring (440Hz + 480Hz)
        for (let i = 0; i < buffer.length; i++) {
            const time = i / sampleRate;
            
            // Ring pattern: 1 second on, 1 second off
            if (time < 1.0) {
                // Mix two frequencies for classic phone ring sound
                const tone1 = Math.sin(2 * Math.PI * 440 * time); // A4 note
                const tone2 = Math.sin(2 * Math.PI * 480 * time); // Close to B4
                
                // Add vibrato effect for more realistic sound
                const vibrato = Math.sin(2 * Math.PI * 2 * time) * 0.1;
                
                // Envelope for smooth attack and decay
                const envelope = Math.sin(Math.PI * time);
                
                data[i] = ((tone1 + tone2) / 2) * envelope * (1 + vibrato) * 0.3;
            } else {
                data[i] = 0; // Silence during off period
            }
        }
        
        // Create source and connect it
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(audioContext.destination);
        source.start(0);
        
        // Store reference for stopping later
        callRinger = { source, audioContext };
    }
}

function stopRinging() {
    if (callRinger) {
        if (callRinger.source) {
            callRinger.source.stop();
            callRinger.audioContext.close();
        }
        callRinger = null;
    }
}

function showVideoArea() {
    if (videoCol) videoCol.style.display = 'flex';
    if (callControlsBar) callControlsBar.hidden = false;
}

function hideVideoArea() {
    // Exit fullscreen if active
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(e => console.warn('Exit fullscreen failed:', e));
    }

    // Hide video elements
    if (localVideo) localVideo.style.display = 'none';
    if (remoteVideo) remoteVideo.style.display = 'none';
    if (videoCol) {
        videoCol.style.display = 'none';
        videoCol.classList.remove('maximized');
    }
    
    if (callControlsBar) callControlsBar.hidden = true;
    if (muteMicButton) muteMicButton.hidden = true;
    if (endCallButton) endCallButton.hidden = true;
    if (maximizeButton) maximizeButton.hidden = true;
    if (flipCameraButton) flipCameraButton.hidden = true;
}

function showCallControls(message) {
    if (callStatusMessage) callStatusMessage.textContent = message;
    if (callControlArea) callControlArea.hidden = false;
    if (btnAudio) btnAudio.disabled = true;
    if (btnVideo) btnVideo.disabled = true;
}

function hideCallControls() {
    if (callControlArea) callControlArea.hidden = true;
    if (btnAudio) btnAudio.disabled = false;
    if (btnVideo) btnVideo.disabled = false;
}

function startTimer() {
    // Don't start timer if not in an active call
    if (!currentCallType) return;
    
    secondsElapsed = 0;
    if (callTimer) callTimer.hidden = false;

    function updateTimer() {
        secondsElapsed++;
        const h = String(Math.floor(secondsElapsed / 3600)).padStart(2, '0');
        const m = String(Math.floor((secondsElapsed % 3600) / 60)).padStart(2, '0');
        const s = String(secondsElapsed % 60).padStart(2, '0');
        if (callTimer) callTimer.textContent = `${h}:${m}:${s}`;
    }

    clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
}

function stopTimer() {
    clearInterval(timerInterval);
    if (callTimer) {
        callTimer.hidden = true;
        callTimer.textContent = '00:00:00';
    }
}

async function disconnectCall(sendSignal = true) {
    stopTimer();
    stopRinging();

    // Stop and remove local tracks
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
        });
        localStream = null;
    }

    // Clear video elements
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;

    currentCallType = null;
    hideVideoArea();
    
    if (btnAudio) btnAudio.disabled = false;
    if (btnVideo) btnVideo.disabled = false;

    // Send signal to peer before closing PC
    if (sendSignal && sessionKey) {
        socket.emit('end_call_signal', { key: sessionKey });
    }

    // Note: We DON'T close the PeerConnection here to keep DataChannel alive
    // Only close PC when leaving the session entirely
    appendSystem('Call ended. Chat is still available.');
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
            const wasMuted = localStream.getAudioTracks()[0] ? !localStream.getAudioTracks()[0].enabled : false;
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
        if (muteMicButton) muteMicButton.textContent = audioTrack.enabled ? 'Mute Mic' : 'Unmute Mic';
        appendSystem(audioTrack.enabled ? 'Microphone Unmuted.' : 'Microphone Muted.');
    }
}

function handleMaximize() {
    if (!remoteVideoContainer) {
        appendSystem('Error: Video container not found.');
        return;
    }

    const isFullscreen = document.fullscreenElement;

    if (isFullscreen) {
        document.exitFullscreen().catch(err => {
            appendSystem('Failed to exit fullscreen: ' + err.message);
        });
    } else {
        remoteVideoContainer.requestFullscreen().then(() => {
            appendSystem('Video maximized (Fullscreen mode).');
        }).catch(err => {
            appendSystem('Failed to enter Fullscreen: ' + err.message);
        });
    }
}

// Update button text when fullscreen changes
document.addEventListener('fullscreenchange', () => {
    const isFullscreen = document.fullscreenElement;
    if (maximizeButton) maximizeButton.textContent = isFullscreen ? 'Minimize' : 'Maximize';
    if (videoCol) {
        if (isFullscreen) {
            videoCol.classList.add('maximized');
        } else {
            videoCol.classList.remove('maximized');
        }
    }
});

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
            // Audio call: hide videos
            if (localVideo) localVideo.style.display = 'none';
            if (remoteVideo) remoteVideo.style.display = 'none';
            if (muteMicButton) muteMicButton.hidden = false;
            if (endCallButton) endCallButton.hidden = false;
            if (maximizeButton) maximizeButton.hidden = true;
            if (flipCameraButton) flipCameraButton.hidden = true;
        } else {
            // Video call: show videos
            if (localVideo) localVideo.style.display = 'block';
            if (remoteVideo) remoteVideo.style.display = 'block';
            if (muteMicButton) muteMicButton.hidden = false;
            if (endCallButton) endCallButton.hidden = false;
            if (maximizeButton) maximizeButton.hidden = false;
            if (flipCameraButton) flipCameraButton.hidden = false;
        }

        if (muteMicButton) muteMicButton.textContent = 'Mute Mic';
        showVideoArea();

        return true;
    } catch (err) {
        console.error('Media error:', err);
        appendSystem('Media error: ' + err.message);
        hideVideoArea();
        return false;
    }
}

async function createPeerConnection(mode) {
    const iceServers = {
        iceServers: [
            // STUN servers (for discovering public IP)
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            
            // TURN servers (for relaying media when direct connection fails)
            // Free Metered TURN servers
            {
                urls: 'turn:a.relay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:a.relay.metered.ca:80?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:a.relay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:a.relay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            
            // Twilio STUN
            { urls: 'stun:global.stun.twilio.com:3478' }
        ],
        iceCandidatePoolSize: 10
    };

    pc = new RTCPeerConnection(iceServers);

    pc.onicecandidate = e => {
        if (e.candidate) {
            socket.emit('ice', { key: sessionKey, candidate: e.candidate });
        }
    };

    pc.ontrack = e => {
        console.log('Received remote track:', e.track.kind);
        if (e.streams && e.streams[0]) {
            remoteVideo.srcObject = e.streams[0];
            
            // Only start timer if we're in an actual call (audio or video)
            if (!timerInterval && currentCallType && (currentCallType === 'audio' || currentCallType === 'video')) {
                startTimer();
            }
            appendSystem('Remote stream connected.');
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log('ICE Connection State:', pc.iceConnectionState);
        appendSystem('Connection: ' + pc.iceConnectionState);
        
        if (pc.iceConnectionState === 'failed') {
            appendSystem('Connection failed. Trying TURN relay...');
            // ICE restart to try TURN servers
            if (pc.restartIce) {
                pc.restartIce();
            }
        } else if (pc.iceConnectionState === 'disconnected') {
            appendSystem('Connection lost. Attempting to reconnect...');
        } else if (pc.iceConnectionState === 'connected') {
            appendSystem('Successfully connected!');
        }
    };
    
    // Log ICE candidates to see if TURN is being used
    pc.onicecandidate = e => {
        if (e.candidate) {
            console.log('ICE Candidate Type:', e.candidate.type, '| Protocol:', e.candidate.protocol);
            if (e.candidate.type === 'relay') {
                appendSystem('Using TURN relay server (for long distance)');
            }
            socket.emit('ice', { key: sessionKey, candidate: e.candidate });
        } else {
            console.log('All ICE candidates sent');
        }
    };

    pc.onsignalingstatechange = () => {
        console.log('Signaling State:', pc.signalingState);
    };
    
    // Monitor ICE gathering state
    pc.onicegatheringstatechange = () => {
        console.log('ICE Gathering State:', pc.iceGatheringState);
        if (pc.iceGatheringState === 'complete') {
            appendSystem('Network discovery complete.');
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
    
    dataChannel.onopen = () => {
        console.log('Data channel opened');
        appendSystem('Chat ready.');
    };
    
    dataChannel.onmessage = ev => {
        appendChat(ev.data, false);
    };
    
    dataChannel.onerror = e => {
        console.error('Data Channel Error:', e);
        appendSystem('Chat error occurred.');
    };
    
    dataChannel.onclose = () => {
        console.log('Data channel closed');
        appendSystem('Chat closed.');
    };
}

// =================================================================
// SOCKET HANDLERS
// =================================================================

if (genKeyBtn) {
    genKeyBtn.onclick = () => socket.emit('generate_key');
}

socket.on('key_generated', d => {
    sessionKey = d.key;
    if (sessionKeySpan) sessionKeySpan.textContent = sessionKey;
    if (sessionArea) sessionArea.hidden = false;
    socket.emit('join_key', { key: sessionKey });
});

if (joinBtn) {
    joinBtn.onclick = () => {
        const key = keyInput.value.trim().toUpperCase();
        if (!key) return appendSystem('Error: Enter key');
        sessionKey = key;
        socket.emit('join_key', { key });
    };
}

socket.on('join_error', d => {
    appendSystem('Join error: ' + (d.reason || 'unknown'));
});

socket.on('joined', async d => {
    if (sessionKeySpan) sessionKeySpan.textContent = sessionKey;
    if (sessionArea) sessionArea.hidden = false;
    appendSystem('Connected to session: ' + sessionKey);

    if (!pc) {
        isCaller = d.peers === 1;
        await createPeerConnection(isCaller ? 'caller' : 'receiver');
        appendSystem(isCaller ? 'You are the host.' : 'Joined as peer.');
    }
});

socket.on('peer_joined', () => {
    appendSystem('Peer joined.');
});

socket.on('start_call', async () => {
    appendSystem('Peer ready. Establishing data channel...');
    if (pc && isCaller && dataChannel) {
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { key: sessionKey, sdp: pc.localDescription });
            console.log('Initial offer sent');
        } catch (e) {
            console.error('Offer creation failed:', e);
            appendSystem('Failed to create connection offer.');
        }
    }
});

socket.on('offer', async d => {
    if (!d.sdp || !pc) return;
    
    try {
        console.log('Received offer, setting remote description');
        await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
        
        // Add local tracks if available
        if (localStream) {
            localStream.getTracks().forEach(track => {
                const senders = pc.getSenders();
                const exists = senders.find(s => s.track && s.track.kind === track.kind);
                if (!exists) {
                    pc.addTrack(track, localStream);
                    console.log('Added', track.kind, 'track to PC');
                }
            });
        }
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { key: sessionKey, sdp: pc.localDescription });
        console.log('Answer sent');
        appendSystem('Connection answer sent.');
    } catch (e) {
        console.error('Error handling offer:', e);
        appendSystem('Error processing connection offer.');
    }
});

socket.on('answer', async d => {
    if (!d.sdp || !pc) return;
    
    try {
        console.log('Received answer');
        await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
        appendSystem('Connection established.');
    } catch (e) {
        console.error('Error handling answer:', e);
        appendSystem('Error processing connection answer.');
    }
});

socket.on('ice', async d => {
    if (d.candidate && pc) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(d.candidate));
            console.log('ICE candidate added');
        } catch (e) {
            console.warn('ICE candidate error:', e);
        }
    }
});

socket.on('peer_left', () => {
    appendSystem('Peer left the session.');
    
    // Clean up everything
    disconnectCall(false);
    
    if (pc) {
        pc.close();
        pc = null;
        dataChannel = null;
    }
    
    if (sessionArea) sessionArea.hidden = true;
    sessionKey = null;
    isCaller = false;
});

socket.on('end_call_signal', () => {
    appendSystem('Peer ended the call.');
    stopRinging();
    disconnectCall(false);
});

socket.on('incoming_call', async d => {
    // Check if already in a call
    if (localStream) {
        socket.emit('reject_call', { key: sessionKey, reason: 'busy' });
        return;
    }
    
    // Ensure peer connection exists
    if (!pc) {
        isCaller = false;
        await createPeerConnection('receiver');
    }

    currentCallType = d.callType;
    const message = d.callType === 'video' ? 'Incoming Video Call...' : 'Incoming Audio Call...';
    showCallControls(message);
    appendSystem(message);
    startRinging();
});

socket.on('accept_call', async () => {
    appendSystem('Call accepted. Starting media...');
    hideCallControls();
    
    const success = await getLocalMedia({ 
        audio: true, 
        video: currentCallType === 'video' 
    });
    
    if (success && localStream && pc) {
        // Add tracks to peer connection
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
            console.log('Added', track.kind, 'track after acceptance');
        });
        
        // Create and send offer with media
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { key: sessionKey, sdp: pc.localDescription });
            console.log('Media offer sent');
        } catch (e) {
            console.error('Failed to create media offer:', e);
            appendSystem('Failed to establish media connection.');
            disconnectCall(true);
        }
    } else {
        appendSystem('Failed to access camera/microphone.');
        disconnectCall(true);
    }
});

socket.on('reject_call', d => {
    appendSystem(`Call rejected: ${d.reason || 'No reason'}`);
    hideCallControls();
    if (btnAudio) btnAudio.disabled = false;
    if (btnVideo) btnVideo.disabled = false;
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
        appendSystem('Accepting call...');
        
        const success = await getLocalMedia({
            audio: true,
            video: currentCallType === 'video'
        });
        
        if (success && localStream && pc) {
            // Add tracks to peer connection
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
                console.log('Added', track.kind, 'track');
            });
            
            socket.emit('accept_call', { key: sessionKey });
            hideCallControls();
        } else {
            socket.emit('reject_call', { key: sessionKey, reason: 'media_failure' });
            appendSystem('Failed to access media devices.');
            currentCallType = null;
            hideCallControls();
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

// Language switching
const langEnBtn = document.getElementById('lang-en');
const langBnBtn = document.getElementById('lang-bn');

if (langEnBtn) langEnBtn.onclick = () => switchLang('en');
if (langBnBtn) langBnBtn.onclick = () => switchLang('bn');

function switchLang(l) {
    curLang = l;
    if (langEnBtn) langEnBtn.classList.toggle('active', l === 'en');
    if (langBnBtn) langBnBtn.classList.toggle('active', l === 'bn');
    if (genKeyBtn) genKeyBtn.textContent = t('genKey');
    if (joinBtn) joinBtn.textContent = t('connect');
    if (keyInput) keyInput.placeholder = t('placeholderKey');
    if (btnChat) btnChat.textContent = t('chat');
    if (btnAudio) btnAudio.textContent = t('audio');
    if (btnVideo) btnVideo.textContent = t('video');
    if (btnLeave) btnLeave.textContent = t('leave');
}
switchLang('en');

if (btnReload) {
    btnReload.onclick = () => window.location.reload();
}

if (keyInput) {
    keyInput.addEventListener('input', function() {
        this.value = this.value.toUpperCase();
    });
}

if (copyKeyBtn) {
    copyKeyBtn.onclick = () => {
        if (sessionKey) {
            navigator.clipboard.writeText(sessionKey).then(() => {
                appendSystem('Session key copied to clipboard!');
            }).catch(err => {
                console.error('Copy failed:', err);
                appendSystem('Failed to copy key.');
            });
        }
    };
}

if (btnChat) {
    btnChat.onclick = () => {
        if (!dataChannel || dataChannel.readyState !== 'open') {
            appendSystem('Chat not ready. Establish connection first.');
        } else {
            appendSystem('Chat is active and ready.');
        }
    };
}

if (btnAudio) {
    btnAudio.onclick = async () => {
        if (!pc || !sessionKey) {
            appendSystem('Please join a session first.');
            return;
        }
        
        if (!isCaller) {
            appendSystem('Only the host can initiate calls.');
            return;
        }
        
        if (localStream) {
            appendSystem('Call already in progress.');
            return;
        }
        
        currentCallType = 'audio';
        appendSystem('Initiating audio call...');
        socket.emit('incoming_call', { key: sessionKey, callType: 'audio' });
        btnAudio.disabled = true;
        btnVideo.disabled = true;
    };
}

if (btnVideo) {
    btnVideo.onclick = async () => {
        if (!pc || !sessionKey) {
            appendSystem('Please join a session first.');
            return;
        }
        
        if (!isCaller) {
            appendSystem('Only the host can initiate calls.');
            return;
        }
        
        if (localStream) {
            appendSystem('Call already in progress.');
            return;
        }
        
        currentCallType = 'video';
        appendSystem('Initiating video call...');
        socket.emit('incoming_call', { key: sessionKey, callType: 'video' });
        btnAudio.disabled = true;
        btnVideo.disabled = true;
    };
}

if (btnLeave) {
    btnLeave.onclick = () => {
        // End call first
        disconnectCall(true);
        
        // Then close everything
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
        isCaller = false;
        
        if (sessionKey) {
            socket.emit('leave_key', { key: sessionKey });
            sessionKey = null;
            if (sessionArea) sessionArea.hidden = true;
            appendSystem('Left session.');
        }
    };
}

if (sendMsg) {
    sendMsg.onclick = () => {
        const v = chatMsg.value.trim();
        if (!v) return;
        
        if (!dataChannel || dataChannel.readyState !== 'open') {
            appendSystem('Chat not ready. Data channel is closed.');
            return;
        }
        
        try {
            dataChannel.send(v);
            appendChat(v, true);
            chatMsg.value = '';
        } catch (e) {
            console.error('Failed to send message:', e);
            appendSystem('Failed to send message.');
        }
    };
}

if (chatMsg) {
    chatMsg.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (sendMsg) sendMsg.click();
        }
    });
}

// UI Helper Functions
function appendChat(text, me) {
    if (!chatBox) return;
    
    const div = document.createElement('div');
    div.className = 'chat-msg' + (me ? ' me' : '');
    div.textContent = (me ? t('sending') : '') + text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function appendSystem(text) {
    if (!chatBox) return;
    
    const div = document.createElement('div');
    div.className = 'chat-msg system';
    div.style.opacity = '0.6';
    div.style.fontStyle = 'italic';
    div.textContent = '• ' + text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    
    console.log('[System]', text);
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    try {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        if (sessionKey) {
            socket.emit('leave_key', { key: sessionKey });
        }
        if (pc) {
            pc.close();
        }
        socket.close();
    } catch (e) {
        console.error('Cleanup error:', e);
    }
});
