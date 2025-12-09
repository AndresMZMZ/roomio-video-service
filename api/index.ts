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

// STUN/TURN configuration from environment variables
const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  ...(process.env.TURN_URL
    ? [
        {
          urls: process.env.TURN_URL,
          username: process.env.TURN_USER,
          credential: process.env.TURN_PASS
        }
      ]
    : [])
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

    // Step 1: Save existing users before adding the new one
    const existingUsers = [...rooms[roomId]];

    // Step 2: Add new user to room
    rooms[roomId].push(socket.id);
    socket.join(roomId);
    socket.emit("ice-config", { iceServers });
    console.log(`Joined room ${roomId}, size: ${rooms[roomId].length}`);

    // Step 3: Send list of existing users to the new user
    if (existingUsers.length > 0) {
      socket.emit("existing-users", { users: existingUsers });
      console.log(`Sent ${existingUsers.length} existing users to ${socket.id}`);
    }

    // Step 4: Notify other users that someone new joined
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
