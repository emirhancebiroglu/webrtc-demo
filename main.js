import "./style.css";
import { v4 as uuidv4 } from "uuid";

const servers = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
let pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;
let socket;
let offerTimeout = null;
let answerTimeout = null;
let localMediaRecorder = null;
let remoteMediaRecorder = null;
let localAudioRecorder = null;
let remoteAudioRecorder = null;
let callId;
let candidateQueue = [];
let messageQueue = [];

// HTML elements
const webcamVideo = document.getElementById("webcamVideo");
const callButton = document.getElementById("callButton");
const answerButton = document.getElementById("answerButton");
const remoteVideo = document.getElementById("remoteVideo");
const hangupButton = document.getElementById("hangupButton");
const incomingCallNotification = document.getElementById(
  "incomingCallNotification"
);

initiateWebSocket();

// 2. Create an offer
callButton.onclick = async () => {
  callButton.disabled = true;
  await setMedia();
  webcamVideo.srcObject = localStream;

  generateAndSendCallId();

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(JSON.stringify({ candidate: event.candidate }));
    }
  };

  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  socket.send(JSON.stringify({ offer: pc.localDescription }));
  hangupButton.disabled = false;

  // Set a timeout to wait for the answer
  offerTimeout = setTimeout(() => {
    console.log("No answer received. Cancelling the offer.");
    resetPeers();
  }, 10000); // 10 seconds timeout
};

// 3. Answer the call
answerButton.onclick = async () => {
  if (offerTimeout) {
    clearTimeout(offerTimeout);
  }

  if (answerTimeout) {
    clearTimeout(answerTimeout);
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(JSON.stringify({ candidate: event.candidate }));
    }
  };

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  socket.send(JSON.stringify({ answer: pc.localDescription }));

  candidateQueue.forEach(async (candidate) => {
    await pc.addIceCandidate(candidate);
  });

  candidateQueue = [];

  incomingCallNotification.style.display = "none";
  hangupButton.disabled = false;
  answerButton.disabled = true;

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  // Start recording both streams once the call is answered
  startRecordingVideoStreams();
  startRecordingAudioStreams();
};

// 5. Hangup the call
hangupButton.onclick = () => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "hangup" }));
  }

  resetPeers();

  if (socket) {
    socket.close();
  }
};

function generateAndSendCallId() {
  if (callId == undefined) {
    callId = uuidv4();
  }

  const id = {
    type: "callId",
    callId: callId,
  };

  socket.send(JSON.stringify(id));
}

async function setMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  remoteStream = new MediaStream();

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  webcamVideo.muted = true;
  answerButton.disabled = false;
}

function startRecordingVideoStreams() {
  if (localStream && localStream.getTracks().length > 0) {
    const videoStream = new MediaStream(localStream.getVideoTracks());

    localMediaRecorder = new MediaRecorder(videoStream, {
      mimeType: "video/webm; codecs=vp9",
    });

    localMediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const arrayBuffer = reader.result;
          const base64String = arrayBufferToBase64(arrayBuffer);

          const message = {
            type: "callerVideo",
            data: base64String,
            id: callId,
          };

          sendMessage(message);
        };
        reader.readAsArrayBuffer(event.data);
      }
    };
    localMediaRecorder.start(3000);
  }

  if (remoteStream && remoteStream.getTracks().length > 0) {
    const videoStream = new MediaStream(remoteStream.getVideoTracks());

    remoteMediaRecorder = new MediaRecorder(videoStream, {
      mimeType: "video/webm; codecs=vp9",
    });
    remoteMediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const arrayBuffer = reader.result;
          const base64String = arrayBufferToBase64(arrayBuffer);

          const message = {
            type: "calleeVideo",
            data: base64String,
            id: callId,
          };

          sendMessage(message);
        };
        reader.readAsArrayBuffer(event.data);
      }
    };
    remoteMediaRecorder.start(3000);
  }
}

function startRecordingAudioStreams() {
  if (localStream && localStream.getTracks().length > 0) {
    const audioStream = new MediaStream(localStream.getAudioTracks());

    localAudioRecorder = new MediaRecorder(audioStream, {
      mimeType: "audio/webm; codecs=opus",
    });

    localAudioRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const arrayBuffer = reader.result;
          const base64String = arrayBufferToBase64(arrayBuffer);

          const message = {
            type: "callerAudio",
            data: base64String,
            id: callId,
          };

          sendMessage(message);
        };
        reader.readAsArrayBuffer(event.data);
      }
    };
    localAudioRecorder.start(3000);
  }

  if (remoteStream && remoteStream.getTracks().length > 0) {
    const audioStream = new MediaStream(remoteStream.getAudioTracks());

    remoteAudioRecorder = new MediaRecorder(audioStream, {
      mimeType: "audio/webm; codecs=opus",
    });
    remoteAudioRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const arrayBuffer = reader.result;
          const base64String = arrayBufferToBase64(arrayBuffer);

          const message = {
            type: "calleeAudio",
            data: base64String,
            id: callId,
          };

          sendMessage(message);
        };
        reader.readAsArrayBuffer(event.data);
      }
    };
    remoteAudioRecorder.start(3000);
  }
}

function stopRecordingVideoStreams() {
  if (localMediaRecorder) {
    localMediaRecorder.stop();
  }
  if (remoteMediaRecorder) {
    remoteMediaRecorder.stop();
  }
}

function stopRecordingAudioStreams() {
  if (localAudioRecorder) {
    localAudioRecorder.stop();
  }
  if (remoteMediaRecorder) {
    remoteAudioRecorder.stop();
  }
}

function sendMessage(message) {
  if (socket.readyState == WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  } else {
    messageQueue.push(message);
  }
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function initiateWebSocket() {
  socket = new WebSocket("wss://192.168.1.25:5217/wss");

  socket.onopen = async () => {
    if (messageQueue.length > 0) {
      callButton.disabled = true;
      messageQueue.forEach((message) => {
        sendMessage(message);
      });
      messageQueue = [];
    }

    callButton.disabled = false;
    callId = undefined;
  };

  socket.onclose = async () => {
    initiateWebSocket();
  };

  socket.onmessage = async (message) => {
    if (typeof message.data === "string") {
      // Handle JSON messages (offer/answer/candidates)
      const data = JSON.parse(message.data);

      if (data.offer) {
        await setMedia();
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        incomingCallNotification.style.display = "block";
        answerButton.disabled = false;

        // Set a timeout to hide the incoming call notification if not answered
        answerTimeout = setTimeout(() => {
          console.log("No answer from callee. Hiding the notification.");
          incomingCallNotification.style.display = "none";
          resetPeers();
        }, 10000); // 10 seconds timeout
      } else if (data.answer) {
        remoteVideo.srcObject = remoteStream;
        if (offerTimeout) {
          clearTimeout(offerTimeout);
        }
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } else if (data.candidate) {
        const candidate = new RTCIceCandidate(data.candidate);
        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidate);
        } else {
          // Queue the candidate if remote description is not set
          candidateQueue.push(candidate);
        }
      } else if (data.type === "hangup") {
        resetPeers();

        if (socket) {
          socket.close();
        }
      } else if (data.type === "callId") {
        callId = data.callId;
      }
    }
  };
}

function resetPeers() {
  stopRecordingVideoStreams();
  stopRecordingAudioStreams();

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
  }
  if (remoteStream) {
    remoteStream.getTracks().forEach((track) => track.stop());
  }

  if (pc) {
    pc.close();
  }

  webcamVideo.srcObject = null;
  remoteVideo.srcObject = null;

  localStream = null;
  remoteStream = null;

  pc = new RTCPeerConnection(servers);

  hangupButton.disabled = true;
  callButton.disabled = false;
}
