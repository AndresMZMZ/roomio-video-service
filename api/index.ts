import "dotenv/config";
import { Server } from "socket.io";

const origins = (process.env.ORIGIN ?? "http://localhost:5175").split(",").map(s => s.trim()).filter(Boolean);

const io = new Server({
  cors: { origin: origins }
});

const port = Number(process.env.PORT || 5003);
io.listen(port);
console.log(`🎥 Video signaling server running on port ${port}`);

// Config STUN/TURN desde .env
const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' }, // STUN 1
  { urls: 'stun:stun1.l.google.com:19302' }, // STUN 2 (segundo independiente para video)
  ...(process.env.TURN_URL ? [{ urls: process.env.TURN_URL, username: process.env.TURN_USER, credential: process.env.TURN_PASS }] : [])
];

// Mapa de rooms: roomId -> array de socket IDs (máx 10)
const rooms: { [roomId: string]: string[] } = {};

io.on("connection", (socket) => {
  console.log(`🔵 User connected: ${socket.id}`);

  // Join room
  socket.on("join-video-room", (roomId: string) => {
    if (!rooms[roomId]) rooms[roomId] = [];
    if (rooms[roomId].length >= 10) {
      socket.emit("roomFull");
      console.log("❌ Room full:", roomId);
      return;
    }
    rooms[roomId].push(socket.id);
    socket.join(roomId);
    socket.emit("ice-config", { iceServers }); // Envía STUN/TURN al client
    console.log(`👥 Joined room ${roomId}, size: ${rooms[roomId].length}`);

    // Notifica a otros en room
    socket.to(roomId).emit("user-joined", { userId: socket.id });
  });

  // Relay video offer
  socket.on("video-offer", (data: { offer: any; roomId: string; to: string }) => {
    socket.to(data.to).emit("video-offer", { offer: data.offer, from: socket.id });
    console.log("📡 Video offer relayed");
  });

  // Relay video answer
  socket.on("video-answer", (data: { answer: any; roomId: string; to: string }) => {
    socket.to(data.to).emit("video-answer", { answer: data.answer, from: socket.id });
    console.log("📡 Video answer relayed");
  });

  // Relay ICE candidate
  socket.on("ice-candidate", (data: { candidate: any; roomId: string; to: string }) => {
    socket.to(data.to).emit("ice-candidate", { candidate: data.candidate, from: socket.id });
    console.log("🧊 ICE candidate relayed");
  });

  // Toggle video/mute (extiende de tu actividad)
  socket.on("toggle-video", (data: { roomId: string; enabled: boolean }) => {
    socket.to(data.roomId).emit("peer-toggle-video", { peerId: socket.id, enabled: data.enabled });
  });

  // Nueva línea: Renegociación SDP para add/remove video track al toggle (front maneja botones, backend relay).
  socket.on("video-renegotiate", (data: { roomId: string; sdp: RTCSessionDescriptionInit; to: string }) => {
    socket.to(data.to).emit("video-renegotiate", { sdp: data.sdp, from: socket.id });
    console.log(`🔄 Video renegotiation in ${data.roomId}: ${socket.id} -> ${data.to}`);
  });
  // Fin de línea nueva.

  socket.on("disconnect", () => {
    console.log(`🔴 User disconnected: ${socket.id}`);
    // Limpia de todas las rooms
    Object.keys(rooms).forEach(roomId => {
      rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
      if (rooms[roomId].length === 0) delete rooms[roomId];
      socket.to(roomId).emit("peer-disconnected", { peerId: socket.id });
    });
  });
});