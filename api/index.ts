import "dotenv/config";
import { Server } from "socket.io";

const origins = (process.env.ORIGIN ?? "http://localhost:5175")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const io = new Server({
  cors: { origin: origins }
});

const port = Number(process.env.PORT || 5003);
io.listen(port);
console.log(`Video signaling server running on port ${port}`);

// STUN/TURN configuration - Fixed URLs with proper prefixes
const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },

  {
    urls: "turn:a.relay.metered.ca:80",
    username: "87a4d9d7ddc5f6d9f03c9bb4",
    credential: "hsjVP/FvkB7hGHhA"
  },
  {
    urls: "turn:a.relay.metered.ca:443",
    username: "87a4d9d7ddc5f6d9f03c9bb4",
    credential: "hsjVP/FvkB7hGHhA"
  },
  {
    urls: "turn:a.relay.metered.ca:443?transport=tcp",
    username: "87a4d9d7ddc5f6d9f03c9bb4",
    credential: "hsjVP/FvkB7hGHhA"
  }
];

// Room map: roomId -> array of socket IDs (max 10 per room)
const rooms: { [roomId: string]: string[] } = {};

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle user joining a video room
  socket.on("join-video-room", (roomId: string) => {
    if (!rooms[roomId]) rooms[roomId] = [];
    if (rooms[roomId].length >= 10) {
      socket.emit("roomFull");
      console.log("Room full:", roomId);
      return;
    }

    const existingUsers = [...rooms[roomId]];

    rooms[roomId].push(socket.id);
    socket.join(roomId);
    socket.emit("ice-config", { iceServers });
    console.log(`Joined room ${roomId}, size: ${rooms[roomId].length}`);

    if (existingUsers.length > 0) {
      socket.emit("existing-users", { users: existingUsers });
      console.log(`Sent ${existingUsers.length} existing users to ${socket.id}`);
    }

    socket.to(roomId).emit("user-joined", { userId: socket.id });
  });

  // Relay video offer
  socket.on("video-offer", (data: { offer: any; roomId: string; to: string }) => {
    socket.to(data.to).emit("video-offer", { offer: data.offer, from: socket.id });
    console.log(`Video offer relayed: ${socket.id} -> ${data.to}`);
  });

  // Relay video answer
  socket.on("video-answer", (data: { answer: any; roomId: string; to: string }) => {
    socket.to(data.to).emit("video-answer", { answer: data.answer, from: socket.id });
    console.log(`Video answer relayed: ${socket.id} -> ${data.to}`);
  });

  // Relay ICE candidate
  socket.on("ice-candidate", (data: { candidate: any; roomId: string; to: string }) => {
    socket.to(data.to).emit("ice-candidate", { candidate: data.candidate, from: socket.id });
    console.log(`ICE candidate relayed: ${socket.id} -> ${data.to}`);
  });

  // Handle video toggle
  socket.on("toggle-video", (data: { roomId: string; enabled: boolean }) => {
    socket.to(data.roomId).emit("peer-toggle-video", { peerId: socket.id, enabled: data.enabled });
  });

  // SDP renegotiation
  socket.on("video-renegotiate", (data: { roomId: string; sdp: RTCSessionDescriptionInit; to: string }) => {
    socket.to(data.to).emit("video-renegotiate", { sdp: data.sdp, from: socket.id });
    console.log(`Video renegotiation in ${data.roomId}: ${socket.id} -> ${data.to}`);
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);

    Object.keys(rooms).forEach(roomId => {
      rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
      if (rooms[roomId].length === 0) delete rooms[roomId];
      socket.to(roomId).emit("peer-disconnected", { peerId: socket.id });
    });
  });
});
