import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const guardians = new Map();
// requesterSocketId -> { assignedGuardianSocketId: string|null, payload: object|null }
const activeHelpRequests = new Map();

io.on('connection', (socket) => {
  socket.emit('guardianList', Array.from(guardians.values()));

  socket.on('registerGuardian', (data) => {
    const guardian = { ...data, socketId: socket.id, updatedAt: Date.now() };
    guardians.set(socket.id, guardian);
    io.emit('guardianList', Array.from(guardians.values()));
  });

  socket.on('updateLocation', (coords) => {
    const guardian = guardians.get(socket.id);
    if (guardian) {
      guardian.lat = coords.lat;
      guardian.lng = coords.lng;
      guardian.updatedAt = Date.now();
      guardians.set(socket.id, guardian);
      io.emit('guardianList', Array.from(guardians.values()));
    }
  });

  socket.on('requestHelp', (payload = {}) => {
    const req = { ...payload, requesterSocketId: socket.id, requestedAt: Date.now() };
    const entry = activeHelpRequests.get(socket.id);
    // Only broadcast when there is no assigned guardian yet
    if (!entry) {
      activeHelpRequests.set(socket.id, { assignedGuardianSocketId: null, payload: req });
      io.emit('helpRequest', req);
    } else if (!entry.assignedGuardianSocketId) {
      // Update payload but keep unassigned
      activeHelpRequests.set(socket.id, { ...entry, payload: req });
      io.emit('helpRequest', req);
    }
  });

  socket.on('acceptHelp', ({ requesterSocketId }) => {
    if (!requesterSocketId) return;
    const entry = activeHelpRequests.get(requesterSocketId);

    // If no active request, inform guardian
    if (!entry) {
      io.to(socket.id).emit('helpAlreadyAssigned', {
        requesterSocketId,
        assignedGuardianSocketId: null,
      });
      return;
    }

    // If already assigned, notify this guardian and stop
    if (entry.assignedGuardianSocketId) {
      io.to(socket.id).emit('helpAlreadyAssigned', {
        requesterSocketId,
        assignedGuardianSocketId: entry.assignedGuardianSocketId,
      });
      return;
    }

    // Assign to this guardian
    activeHelpRequests.set(requesterSocketId, {
      ...entry,
      assignedGuardianSocketId: socket.id,
    });

    const guardian = guardians.get(socket.id);

    // Notify requester
    io.to(requesterSocketId).emit('helpAccepted', {
      guardianSocketId: socket.id,
      guardian,
    });

    // Notify all guardians to remove the open request
    io.emit('helpAssigned', {
      requesterSocketId,
      guardianSocketId: socket.id,
      guardian,
    });
  });

  socket.on('disconnect', () => {
    // Remove guardian from list if present
    guardians.delete(socket.id);
    io.emit('guardianList', Array.from(guardians.values()));

    // If a requester disconnects, clear their help request
    if (activeHelpRequests.has(socket.id)) {
      activeHelpRequests.delete(socket.id);
      io.emit('helpWithdrawn', { requesterSocketId: socket.id });
    }
  });
});

app.get('/', (_req, res) => res.send('Guardian server running'));
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
