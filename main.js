import "./style.css";

const servers = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

const baseUrl = "https://192.168.1.25:5217";

// Global State
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;

// HTML elements
const webcamButton = document.getElementById("webcamButton");
const webcamVideo = document.getElementById("webcamVideo");
const callButton = document.getElementById("callButton");
const callInput = document.getElementById("callInput");
const answerButton = document.getElementById("answerButton");
const remoteVideo = document.getElementById("remoteVideo");
const hangupButton = document.getElementById("hangupButton");

// 1. Setup media sources

webcamButton.onclick = async () => {
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

  webcamVideo.srcObject = localStream;
  webcamVideo.muted = true;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
};

// 2. Create an offer
callButton.onclick = async () => {
  const callId = generateUniqueCallId();
  const saveCandidateUrl = `${baseUrl}/api/Call/SaveCandidate`;

  // Get candidates for caller, save to db
  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      const candidateData = {
        CallId: callId,
        Type: "Offer",
        CandidateData: JSON.stringify(event.candidate),
      };

      await fetch(saveCandidateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(candidateData),
      });
    }
  };

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    CallId: callId,
    OfferSdp: offerDescription.sdp,
    AnswerSdp: null,
  };

  await fetch(`${baseUrl}/api/Call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(offer),
  });

  callInput.value = callId;

  hangupButton.disabled = false;

  pollForAnswer(callId);
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;

  // Fetch the call data from the server
  const response = await fetch(`${baseUrl}/api/Call/${callId}`);
  const callData = await response.json();

  if (!callData || !callData.offerSdp) {
    console.error("No offer found for this call ID.");
    return;
  }

  // Set the remote description using the offer SDP
  const offerDescription = new RTCSessionDescription({
    sdp: callData.offerSdp,
    type: "offer",
  });
  await pc.setRemoteDescription(offerDescription);

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  // Save the answer SDP to the server
  const answer = {
    CallId: callId,
    AnswerSdp: answerDescription.sdp,
  };

  await fetch(`${baseUrl}/api/Call/${callId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(answer),
  });

  // Poll for offer ICE candidates and add them to the peer connection
  pollForIceCandidates(callId, "offer");
};

function generateUniqueCallId() {
  // Implement a function to generate a unique ID for the call
  // This can be a GUID or another unique identifier
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function pollForAnswer(callId) {
  while (!pc.currentRemoteDescription) {
    const response = await fetch(`${baseUrl}/api/Call/${callId}`);
    const data = await response.json();

    if (data.answerSdp) {
      const answerDescription = new RTCSessionDescription({
        sdp: data.answerSdp,
        type: "answer",
      });
      await pc.setRemoteDescription(answerDescription);
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll every second
  }
}

// Polling function for ICE candidates
async function pollForIceCandidates(callId, type) {
  const fetchedCandidates = new Set();

  while (true) {
    const response = await fetch(`${baseUrl}/api/Call/${callId}/${type}`);
    const candidates = await response.json();

    candidates.forEach((candidate) => {
      if (!fetchedCandidates.has(candidate.id)) {
        const iceCandidate = new RTCIceCandidate(
          JSON.parse(candidate.candidateData)
        );
        pc.addIceCandidate(iceCandidate);
        fetchedCandidates.add(candidate.id);
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll every second
  }
}

