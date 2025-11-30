import os 
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import random, string, time

# --- Flask & SocketIO Setup ---
app = Flask(__name__, static_folder='.', static_url_path='/')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'replace_with_a_random_secret')

# IMPORTANT: For production deployment
socketio = SocketIO(
    app, 
    cors_allowed_origins="*",
    async_mode='eventlet',  # Important for production
    logger=True,
    engineio_logger=True
)

# In-memory sessions: key -> {clients: [sid,...], created}
sessions = {}

def gen_key(length=6):
    chars = string.ascii_uppercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length))

# --- Route for Serving Frontend ---
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

# Serve static files (CSS, JS)
@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

# --- Session & Key Handlers ---
@socketio.on('generate_key')
def handle_generate_key():
    key = gen_key(6)
    while key in sessions:
        key = gen_key(6)
    sessions[key] = {'clients': [], 'created': time.time()}
    print(f"Generated key: {key}")
    emit('key_generated', {'key': key})

@socketio.on('join_key')
def handle_join_key(data):
    key = data.get('key')
    sid = request.sid

    print(f"Client {sid} trying to join key: {key}")

    if not key or key not in sessions:
        print(f"Invalid key: {key}")
        emit('join_error', {'reason': 'invalid_key'})
        return

    clients = sessions[key]['clients']
    if len(clients) >= 2:
        print(f"Room {key} is full")
        emit('join_error', {'reason': 'room_full'})
        return

    clients.append(sid)
    join_room(key)
    
    print(f"Client {sid} joined room {key}. Total clients: {len(clients)}")
    emit('joined', {'key': key, 'peers': len(clients)})

    if len(clients) == 2:
        first_client_sid = clients[0]
        second_client_sid = clients[1]
        
        print(f"Room {key} has 2 clients. Starting call setup.")
        socketio.emit('start_call', {'peer_sid': second_client_sid}, room=first_client_sid)
        socketio.emit('peer_joined', {'peer_sid': first_client_sid}, room=second_client_sid)

@socketio.on('leave_key')
def handle_leave_key(data):
    sid = request.sid
    key = data.get('key')
    
    print(f"Client {sid} leaving key: {key}")
    
    if key in sessions and sid in sessions[key]['clients']:
        sessions[key]['clients'].remove(sid)
    leave_room(key)
    
    socketio.emit('peer_left', {'sid': sid}, room=key)
    
    if key in sessions and len(sessions[key]['clients']) == 0:
        print(f"Removing empty session: {key}")
        sessions.pop(key, None)

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    print(f"Client disconnected: {sid}")
    
    to_remove = []
    for key, info in list(sessions.items()):
        if sid in info['clients']:
            info['clients'].remove(sid)
            socketio.emit('peer_left', {'sid': sid}, room=key)
        if len(info['clients']) == 0:
            to_remove.append(key)
    for k in to_remove:
        sessions.pop(k, None)

# --- WebRTC Signaling Handlers ---
@socketio.on('offer')
def handle_offer(data):
    key = data.get('key')
    sdp = data.get('sdp')
    from_sid = request.sid
    
    if not key or key not in sessions: 
        print(f"Offer failed: Invalid key {key}")
        return
    
    print(f"Relaying offer from {from_sid} in room {key}")
    socketio.emit('offer', {'sdp': sdp, 'from': from_sid}, room=key, include_self=False)

@socketio.on('answer')
def handle_answer(data):
    key = data.get('key')
    sdp = data.get('sdp')
    from_sid = request.sid
    
    if not key or key not in sessions:
        print(f"Answer failed: Invalid key {key}")
        return
    
    print(f"Relaying answer from {from_sid} in room {key}")
    socketio.emit('answer', {'sdp': sdp, 'from': from_sid}, room=key, include_self=False)

@socketio.on('ice')
def handle_ice(data):
    key = data.get('key')
    candidate = data.get('candidate')
    from_sid = request.sid
    
    if not key or key not in sessions: return
    
    socketio.emit('ice', {'candidate': candidate, 'from': from_sid}, room=key, include_self=False)

# --- Call Negotiation Handlers ---
@socketio.on('incoming_call')
def handle_incoming_call(data):
    key = data.get('key')
    callType = data.get('callType')
    
    if not key or key not in sessions: return
    
    print(f"Incoming {callType} call in room {key}")
    socketio.emit('incoming_call', {'callType': callType}, room=key, include_self=False)

@socketio.on('accept_call')
def handle_accept_call(data):
    key = data.get('key')
    
    if not key or key not in sessions: return
    
    print(f"Call accepted in room {key}")
    socketio.emit('accept_call', {}, room=key, include_self=False)

@socketio.on('reject_call')
def handle_reject_call(data):
    key = data.get('key')
    reason = data.get('reason')
    
    if not key or key not in sessions: return
    
    print(f"Call rejected in room {key}: {reason}")
    socketio.emit('reject_call', {'reason': reason}, room=key, include_self=False)

@socketio.on('end_call_signal')
def handle_end_call_signal(data):
    key = data.get('key')
    
    if not key or key not in sessions: return
    
    print(f"Call ended in room {key}")
    socketio.emit('end_call_signal', room=key, include_self=False)

# --- Application Run ---
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=False)
