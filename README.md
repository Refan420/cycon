P2P Video Call Signaling Server (Flask & WebRTC)

🌟 Project Overview

This project implements a simple, two-peer WebRTC application for direct video and audio calls, utilizing Flask and Flask-SocketIO as the signaling server. The application is designed to be easily deployable, handling peer discovery and connection negotiation entirely through a shared session key.

Key Technologies:

Backend: Python, Flask, Flask-SocketIO, Eventlet

Frontend: HTML, CSS, JavaScript (WebRTC API, Socket.IO Client)

✨ Features

Session Management: Users can generate a unique 6-character key to create a private session.

Two-Peer Limit: Sessions are strictly limited to two clients (Host and Joiner).

WebRTC Signaling: Relays critical signaling messages:

SDP Offers and Answers (offer, answer)

ICE Candidates (ice)

Connection Lifecycle: Handles join/leave events and notifies the remaining peer when a session or call ends.

📁 Project Structure

The project uses a clean separation between the server logic and the client assets, which is correctly configured in backend/app.py.

.
├── backend/
│ └── app.py # Flask/SocketIO signaling server logic.
├── frontend/
│ ├── index.html # Main HTML page and client layout.
│ ├── style.css # Client-side styling.
│ └── script.js # Core WebRTC connection and SocketIO client logic.
├── requirements.txt # Python dependency list.
└── Procfile # Deployment startup command for Render/Heroku.

🛠️ Local Setup and Installation

Follow these steps to run the application locally for testing:

1. Prerequisites

You must have Python 3 installed on your machine.

2. Clone Repository (if applicable)

# Clone your repository

git clone <your-repo-url>
cd <your-repo-name>

3. Install Dependencies

Install all necessary Python packages using the provided requirements.txt:

pip install -r requirements.txt

4. Run the Server

Navigate to the root directory and execute the app.py file inside the backend folder. We use the standard Flask-SocketIO command which leverages eventlet for local testing:

# Note: You run the file from the root directory

python backend/app.py

The server will start, typically on http://127.0.0.1:5000.

🚀 Deployment (Recommended: Render)

This application is configured for a robust deployment using Render, thanks to the Procfile and requirements.txt.

1. Connect to Render

Push all your files (Procfile, requirements.txt, backend/, frontend/) to a GitHub repository.

Log in to Render and create a new Web Service.

Connect it to your repository.

2. Configuration Settings

Setting

Value

Notes

Environment

Python 3

Build Command

pip install -r requirements.txt

Installs dependencies.

Start Command

eventlet -w 1 backend.app:socketio

CRITICAL: Uses eventlet and correctly points to the socketio object in backend/app.py.

3. Security (Environment Variable)

You must set the SECRET_KEY environment variable on Render for security.

Key: SECRET_KEY

Value: Any long, randomly generated string.

💡 Usage

Open in Two Tabs: Open the deployed URL (or http://127.0.0.1:5000 locally) in two separate browser tabs (or on two different devices).

Host: In the first tab, click the "Create Session" button to generate a 6-character key.

Share: Copy the generated key.

Joiner: In the second tab, paste the key into the input field and click "Join Session".

Call Initiation: Once the second peer joins, the signaling server notifies the host to immediately start the WebRTC connection process (sending the SDP Offer).

Connection: The browsers will exchange SDP and ICE candidates until a direct, P2P media connection is established.
