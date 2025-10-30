// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: 'http://localhost:3000', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(cors());
app.use(express.json());

const users = {};
const rooms = {};
const privateMessages = {};
const uuidv4 = () => crypto.randomUUID();

rooms['global'] = { messages: [], typing: new Set(), members: new Set(), unread: {} };

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join', (username) => {
    if (!username?.trim()) return socket.emit('error', 'Username required');
    username = username.trim();
    if (Object.values(users).some(u => u.username === username)) {
      return socket.emit('error', 'Username taken');
    }

    users[socket.id] = { username, online: true, rooms: ['global'] };
    socket.join('global');
    rooms['global'].members.add(socket.id);
    rooms['global'].unread[socket.id] = 0;

    socket.broadcast.emit('userOnline', { id: socket.id, username });
    socket.emit('connected', {
      userId: socket.id,
      username,
      onlineUsers: getOnlineUsers(),
      rooms: Object.keys(rooms),
      activeRoom: 'global',
      messages: rooms['global'].messages.slice(-50),
      unreadCounts: rooms['global'].unread
    });
  });

  socket.on('joinRoom', (roomName) => {
    if (!users[socket.id]) return;
    roomName = roomName.trim();
    if (!roomName) return;

    if (!rooms[roomName]) {
      rooms[roomName] = { messages: [], typing: new Set(), members: new Set(), unread: {} };
      io.emit('roomCreated', roomName);
    }

    const user = users[socket.id];
    if (!user.rooms.includes(roomName)) {
      user.rooms.push(roomName);
      socket.join(roomName);
      rooms[roomName].members.add(socket.id);
      rooms[roomName].unread[socket.id] = 0;
    }

    socket.to(roomName).emit('notification', {
      type: 'join',
      message: `${user.username} joined ${roomName}`,
      room: roomName
    });

    socket.emit('roomJoined', {
      roomName,
      messages: rooms[roomName].messages.slice(-50),
      members: Array.from(rooms[roomName].members).map(id => ({
        id, username: users[id]?.username
      })),
      unread: rooms[roomName].unread[socket.id] || 0
    });

    socket.to(roomName).emit('userJoinedRoom', { roomName, username: user.username });
  });

  socket.on('sendMessage', async ({ room, text, file }) => {
    if (!users[socket.id] || !users[socket.id].rooms.includes(room)) return;

    const msg = {
      id: uuidv4(),
      sender: users[socket.id].username,
      senderId: socket.id,
      text: text?.trim() || '',
      file: file || null,
      timestamp: new Date().toISOString(),
      room,
      reactions: {},
      readBy: [socket.id],
      delivered: true
    };

    rooms[room].messages.push(msg);
    rooms[room].members.forEach(id => {
      if (id !== socket.id) rooms[room].unread[id] = (rooms[room].unread[id] || 0) + 1;
    });

    io.to(room).emit('newMessage', msg);
    io.to(room).emit('unreadUpdate', { room, unread: rooms[room].unread });
  });

  socket.on('loadOlderMessages', ({ room, beforeId, limit = 20 }) => {
    if (!users[socket.id] || !rooms[room]) return;
    let messages = rooms[room].messages;
    let start = beforeId ? messages.findIndex(m => m.id === beforeId) : messages.length;
    const older = messages.slice(Math.max(0, start - limit), start);
    socket.emit('olderMessages', { room, messages: older });
  });

  socket.on('sendPrivateMessage', ({ toUsername, text, file }) => {
    const fromUser = users[socket.id];
    if (!fromUser) return;
    const toUser = Object.values(users).find(u => u.username === toUsername);
    if (!toUser) return socket.emit('error', 'User not found');

    const key = [fromUser.username, toUsername].sort().join('|');
    if (!privateMessages[key]) privateMessages[key] = [];

    const msg = {
      id: uuidv4(),
      sender: fromUser.username,
      senderId: socket.id,
      receiver: toUsername,
      text: text?.trim() || '',
      file: file || null,
      timestamp: new Date().toISOString(),
      isPrivate: true
    };

    privateMessages[key].push(msg);
    socket.emit('privateMessage', { ...msg, type: 'sent' });
    const toSocket = Object.keys(users).find(id => users[id].username === toUsername);
    if (toSocket) io.to(toSocket).emit('privateMessage', { ...msg, type: 'received' });
  });

  socket.on('typing', ({ room, isTyping }) => {
    if (!users[socket.id] || !rooms[room]) return;
    const username = users[socket.id].username;
    isTyping ? rooms[room].typing.add(username) : rooms[room].typing.delete(username);
    io.to(room).emit('typingUpdate', { room, typingUsers: Array.from(rooms[room].typing) });
  });

  socket.on('markAsRead', (messageId) => {
    for (const room in rooms) {
      const msg = rooms[room].messages.find(m => m.id === messageId);
      if (msg && !msg.readBy.includes(socket.id)) {
        msg.readBy.push(socket.id);
        io.to(room).emit('messageRead', { messageId, readerId: socket.id });
        break;
      }
    }
  });

  socket.on('reactToMessage', ({ messageId, emoji }) => {
    const user = users[socket.id];
    if (!user) return;
    for (const room in rooms) {
      const msg = rooms[room].messages.find(m => m.id === messageId);
      if (msg) {
        if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
        const idx = msg.reactions[emoji].indexOf(user.username);
        if (idx === -1) {
          msg.reactions[emoji].push(user.username);
        } else {
          msg.reactions[emoji].splice(idx, 1);
        }
        io.to(room).emit('reactionUpdate', { messageId, reactions: msg.reactions });
        break;
      }
    }
  });

  socket.on('disconnect', () => {
    if (users[socket.id]) {
      const user = users[socket.id];
      user.rooms.forEach(room => {
        if (rooms[room]) {
          rooms[room].members.delete(socket.id);
          delete rooms[room].unread[socket.id];
          rooms[room].typing.delete(user.username);
          socket.to(room).emit('typingUpdate', { room, typingUsers: Array.from(rooms[room].typing) });
          socket.to(room).emit('notification', { type: 'leave', message: `${user.username} left ${room}`, room });
          socket.to(room).emit('userLeftRoom', { room, username: user.username });
        }
      });
      io.emit('userOffline', { id: socket.id, username: user.username });
      delete users[socket.id];
    }
    console.log(`User disconnected: ${socket.id}`);
  });
});

function getOnlineUsers() {
  return Object.entries(users).map(([id, u]) => ({ id, username: u.username }));
}

const PORT = 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));