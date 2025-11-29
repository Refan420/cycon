import os 
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import random, string, time

# --- Flask & SocketIO Setup ---
# এখানে static_folder='.' ব্যবহার করা হয়েছে, কারণ index.html, style.css, script.js সব রুটে আছে।
app = Flask(__name__, static_folder='.', static_url_path='/')
# SECRET_KEY কে এনভায়রনমেন্ট ভেরিয়েবল থেকে নেওয়ার জন্য os.environ.get ব্যবহার করা ভালো।
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'replace_with_a_random_secret')
socketio = SocketIO(app, cors_allowed_origins="*")

# In-memory sessions: key -> {clients: [sid,...], created}
sessions = {}

def gen_key(length=6):
    chars = string.ascii_uppercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length))

# --- Route for Serving Frontend ---
@app.route('/')
def index():
    # '.' ডিরেক্টরি থেকে 'index.html' ফাইলটি পরিবেশন করা হবে।
    return send_from_directory('.', 'index.html')

# --- Session & Key Handlers ---
@socketio.on('generate_key')
def handle_generate_key():
    key = gen_key(6)
    while key in sessions:
        key = gen_key(6)
    sessions[key] = {'clients': [], 'created': time.time()}
    emit('key_generated', {'key': key})

@socketio.on('join_key')
def handle_join_key(data):
    key = data.get('key')
    sid = request.sid

    if not key or key not in sessions:
        emit('join_error', {'reason': 'invalid_key'})
        return

    clients = sessions[key]['clients']
    if len(clients) >= 2:
        emit('join_error', {'reason': 'room_full'})
        return

    # Add the joining client
    clients.append(sid)
    join_room(key)
    
    # Inform the joining client (Client 2) that they joined
    emit('joined', {'key': key, 'peers': len(clients)})

    if len(clients) == 2:
        # Client 1 (the first client, the host/caller)
        first_client_sid = clients[0]
        # Client 2 (the joining client, the receiver)
        second_client_sid = clients[1]
        
        # 1. Tell Client 1 (the Caller) to start the call
        socketio.emit('start_call', {'peer_sid': second_client_sid}, room=first_client_sid)
        
        # 2. Inform Client 2 (the Receiver) who their peer is.
        socketio.emit('peer_joined', {'peer_sid': first_client_sid}, room=second_client_sid)

@socketio.on('leave_key')
def handle_leave_key(data):
    sid = request.sid
    key = data.get('key')
    if key in sessions and sid in sessions[key]['clients']:
        sessions[key]['clients'].remove(sid)
    leave_room(key)
    
    # Notify the remaining peer that the session is over
    socketio.emit('peer_left', {'sid': sid}, room=key)
    
    # Clean up session if empty
    if key in sessions and len(sessions[key]['clients']) == 0:
        sessions.pop(key, None)

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    to_remove = []
    for key, info in list(sessions.items()):
        if sid in info['clients']:
            info['clients'].remove(sid)
            # Notify the remaining peer
            socketio.emit('peer_left', {'sid': sid}, room=key)
        if len(info['clients']) == 0:
            to_remove.append(key)
    for k in to_remove:
        sessions.pop(k, None)

# --- WebRTC Signaling Handlers (Offer, Answer, ICE) ---
@socketio.on('offer')
def handle_offer(data):
    key = data.get('key')
    sdp = data.get('sdp')
    from_sid = request.sid
    if not key or key not in sessions: return
    # Relays SDP offer to the other peer in the room
    socketio.emit('offer', {'sdp': sdp, 'from': from_sid}, room=key, include_self=False)

@socketio.on('answer')
def handle_answer(data):
    key = data.get('key')
    sdp = data.get('sdp')
    from_sid = request.sid
    if not key or key not in sessions: return
    # Relays SDP answer to the other peer in the room
    socketio.emit('answer', {'sdp': sdp, 'from': from_sid}, room=key, include_self=False)

@socketio.on('ice')
def handle_ice(data):
    key = data.get('key')
    candidate = data.get('candidate')
    from_sid = request.sid
    if not key or key not in sessions: return
    # Relays ICE candidate to the other peer in the room
    socketio.emit('ice', {'candidate': candidate, 'from': from_sid}, room=key, include_self=False)

# --- Call Negotiation Handlers ---
@socketio.on('incoming_call')
def handle_incoming_call(data):
    key = data.get('key')
    callType = data.get('callType')
    if not key or key not in sessions: return
    # Relay the incoming call notification to the other peer
    socketio.emit('incoming_call', {'callType': callType}, room=key, include_self=False)

@socketio.on('accept_call')
def handle_accept_call(data):
    key = data.get('key')
    if not key or key not in sessions: return
    # Relay the acceptance back to the caller
    socketio.emit('accept_call', {}, room=key, include_self=False)

@socketio.on('reject_call')
def handle_reject_call(data):
    key = data.get('key')
    reason = data.get('reason')
    if not key or key not in sessions: return
    # Relay the rejection to the other peer
    socketio.emit('reject_call', {'reason': reason}, room=key, include_self=False)

# --- Soft Call Disconnect Handler ---
@socketio.on('end_call_signal')
def handle_end_call_signal(data):
    """Relays the signal that the media call has ended, but the chat session remains."""
    key = data.get('key')
    if not key or key not in sessions: return
    # Send the signal to all others in the room EXCEPT the sender (the one who hung up)
    socketio.emit('end_call_signal', room=key, include_self=False)


# --- Application Run ---
if __name__ == '__main__':
    # Running locally on port 5000
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)