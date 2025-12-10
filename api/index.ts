import "dotenv/config";
import { Server } from "socket.io";

/**
 * Allowed CORS origins for the Socket.IO server.
 * Parses the ORIGIN environment variable (comma-separated), defaults to localhost.
 * @type {string[]}
 */
const origins = (process.env.ORIGIN ?? "http://localhost:5175")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

/**
 * Socket.IO server instance with CORS configuration.
 * @type {Server}
 */
const io = new Server({
  cors: { origin: origins }
});

/**
 * Port number where the signaling server will listen.
 * @type {number}
 */
const port = Number(process.env.PORT || 5003);

io.listen(port);
console.log(`Video signaling server running on port ${port}`);

/**
 * ICE server configuration list used for WebRTC peers.
 * Loads STUN servers and optional TURN credentials from environment variables.
 * @type {{ urls: string, username?: string, credential?: string }[]}
 */
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

/**
 * A mapping of room IDs to the list of socket IDs inside each room.
 * Each room allows a maximum of 10 participants.
 * @type {{ [roomId: string]: string[] }}
 */
const rooms = {};

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  /**
   * Handles a user attempting to join a WebRTC video room.
   * Supports either a string roomId or an object with roomId and userId.
   *
   * @event join-video-room
   * @param {string | { roomId: string, userId: string }} data
   */
  socket.on("join-video-room", (data) => {
    const roomId = typeof data === "string" ? data : data.roomId;
    const userId = typeof data === "object" ? data.userId : null;

    if (!rooms[roomId]) rooms[roomId] = [];

    // Room full (max 10 users)
    if (rooms[roomId].length >= 10) {
      socket.emit("roomFull");
      console.log("Room full:", roomId);
      return;
    }

    rooms[roomId].push(socket.id);
    socket.join(roomId);

    // Send ICE server config to the new client
    socket.emit("ice-config", { iceServers });

    console.log(
      `Joined room ${roomId}, size: ${rooms[roomId].length}, userId: ${userId || "N/A"}`
    );

    // Broadcast optional user/session mapping
    if (userId) {
      console.log(`Broadcasting user mapping: ${userId} -> ${socket.id}`);
      io.to(roomId).emit("user-mapping", { socketId: socket.id, userId });
    }

    // Send other peers to the new user
    const existingUsers = rooms[roomId].filter(id => id !== socket.id);
    socket.emit("existing-users", { users: existingUsers });

    // Notify the room about the new participant
    socket.to(roomId).emit("user-joined", { userId: socket.id });
  });

  /**
   * Relays a WebRTC offer to the target peer.
   * @event video-offer
   * @param {{ offer: any, roomId: string, to: string }} data
   */
  socket.on("video-offer", (data) => {
    socket.to(data.to).emit("video-offer", { offer: data.offer, from: socket.id });
    console.log("Video offer relayed");
  });

  /**
   * Relays a WebRTC answer to the target peer.
   * @event video-answer
   * @param {{ answer: any, roomId: string, to: string }} data
   */
  socket.on("video-answer", (data) => {
    socket.to(data.to).emit("video-answer", { answer: data.answer, from: socket.id });
    console.log("Video answer relayed");
  });

  /**
   * Relays ICE candidates for WebRTC negotiation between peers.
   * @event ice-candidate
   * @param {{ candidate: any, roomId: string, to: string }} data
   */
  socket.on("ice-candidate", (data) => {
    socket.to(data.to).emit("ice-candidate", { candidate: data.candidate, from: socket.id });
    console.log("ICE candidate relayed");
  });

  /**
   * Broadcasts when a user enables or disables their video stream.
   * @event toggle-video
   * @param {{ roomId: string, enabled: boolean }} data
   */
  socket.on("toggle-video", (data) => {
    socket.to(data.roomId).emit("peer-toggle-video", {
      peerId: socket.id,
      enabled: data.enabled
    });
  });

  /**
   * Relays renegotiation SDP messages for mid-call changes.
   * @event video-renegotiate
   * @param {{ roomId: string, sdp: RTCSessionDescriptionInit, to: string }} data
   */
  socket.on("video-renegotiate", (data) => {
    socket.to(data.to).emit("video-renegotiate", {
      sdp: data.sdp,
      from: socket.id
    });

    console.log(
      `Video renegotiation in ${data.roomId}: ${socket.id} -> ${data.to}`
    );
  });

  /**
   * Handles cleanup and room updates when a client disconnects.
   * @event disconnect
   */
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);

    Object.keys(rooms).forEach(roomId => {
      rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);

      if (rooms[roomId].length === 0) delete rooms[roomId];

      socket.to(roomId).emit("peer-disconnected", { peerId: socket.id });
    });
  });
});
