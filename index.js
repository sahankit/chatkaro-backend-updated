const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

console.log('🚀 Starting Chat Server (Simple Standalone Mode)...');

const app = express();

// Basic middleware
app.use(cors());
app.use(express.json());



// Simple in-memory storage
const users = new Map();
const usernames = new Set();
const rooms = new Map();

// Initialize default rooms
const defaultRooms = [
  { id: 'general', name: 'General Chat', description: 'General discussion', category: 'Popular' },
  { id: 'tech', name: 'Tech Talk', description: 'Technology discussions', category: 'Technology' },
  { id: 'gaming', name: 'Gaming', description: 'Gaming discussions', category: 'Entertainment' },
  { id: 'music', name: 'Music', description: 'Music and entertainment', category: 'Entertainment' },
  { id: 'sports', name: 'Sports', description: 'Sports discussions', category: 'Sports & Lifestyle' },
  { id: 'food', name: 'Food & Cooking', description: 'Food and cooking', category: 'Sports & Lifestyle' },
  { id: 'movies', name: 'Movies & TV', description: 'Movies and TV shows', category: 'Entertainment' },
  { id: 'books', name: 'Books', description: 'Book discussions', category: 'Learning' },
  { id: 'travel', name: 'Travel', description: 'Travel experiences', category: 'Sports & Lifestyle' },
  { id: 'fitness', name: 'Fitness', description: 'Health and fitness', category: 'Sports & Lifestyle' },
  { id: 'art', name: 'Art & Design', description: 'Art and design', category: 'Creative' },
  { id: 'science', name: 'Science', description: 'Science discussions', category: 'Learning' },
  { id: 'business', name: 'Business', description: 'Business and entrepreneurship', category: 'Professional' },
  { id: 'education', name: 'Education', description: 'Learning and education', category: 'Learning' },
  { id: 'random', name: 'Random', description: 'Random conversations', category: 'Popular' },
  { id: 'help', name: 'Help & Support', description: 'Get help and support', category: 'Support' }
];

defaultRooms.forEach(roomData => {
  rooms.set(roomData.id, {
    id: roomData.id,
    name: roomData.name,
    description: roomData.description,
    category: roomData.category,
    users: new Set(),
    messages: []
  });
});

console.log(`✅ Initialized ${defaultRooms.length} chat rooms`);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    process: process.pid,
    mode: 'standalone',
    uptime: process.uptime(),
    activeUsers: users.size,
    activeRooms: rooms.size
  });
});

// Get available rooms
app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    name: room.name,
    description: room.description,
    userCount: room.users.size
  }));
  res.json(roomList);
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      socketCount: io ? io.engine.clientsCount : 0,
      activeRooms: rooms.size
    },
    mode: 'standalone'
  });
});

// Serve static files from client build in production
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  app.use(express.static(path.join(__dirname, '../client/build')));
  
  // Handle React routing, return all requests to React app
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

console.log('✅ Socket.IO configured');

io.on('connection', (socket) => {
  const clientIP = socket.handshake.headers['x-forwarded-for'] || 
                   socket.handshake.headers['x-real-ip'] || 
                   socket.handshake.address || 
                   socket.conn.remoteAddress || 
                   'unknown';
  
  console.log(`🔗 User connected: ${socket.id} from ${clientIP}`);

  // Send rooms list to newly connected client
  const roomsList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    name: room.name,
    description: room.description,
    category: room.category,
    userCount: room.users.size
  }));
  socket.emit('rooms_list', roomsList);

  // Handle session restoration
  socket.on('restore_session', (sessionData) => {
    const { username, room } = sessionData;
    
    if (!username || username.trim().length === 0) {
      socket.emit('session_restore_failed', { message: 'Invalid username in session' });
      return;
    }

    const trimmedUsername = username.trim();
    
    // Check if username is available (not currently in use)
    if (usernames.has(trimmedUsername.toLowerCase())) {
      socket.emit('session_restore_failed', { message: 'Username already taken' });
      return;
    }

    // Create user
    const user = {
      id: socket.id,
      username: trimmedUsername,
      joinedAt: new Date().toISOString(),
      currentRoom: null
    };

    users.set(socket.id, user);
    usernames.add(trimmedUsername.toLowerCase());
    
    console.log(`🔄 Session restored: ${user.username} (${socket.id})`);
    
    // If there's a room in the session, try to join it
    if (room && rooms.has(room)) {
      const roomData = rooms.get(room);
      roomData.users.add(socket.id);
      socket.join(room);
      user.currentRoom = room;

      const roomUsers = Array.from(roomData.users).map(userId => users.get(userId)?.username).filter(Boolean);

      socket.emit('session_restored', {
        room: {
          id: roomData.id,
          name: roomData.name,
          description: roomData.description,
          category: roomData.category,
          userCount: roomData.users.size
        },
        messages: roomData.messages.slice(-50),
        users: roomUsers
      });

      // Notify other users in the room
      socket.to(room).emit('user_joined_room', { 
        username: user.username, 
        userCount: roomData.users.size,
        updatedUsers: roomUsers
      });

      // Update room count
      io.emit('room_updated', {
        roomId: room,
        userCount: roomData.users.size
      });

      // Send updated rooms list
      const updatedRoomsList = Array.from(rooms.values()).map(room => ({
        id: room.id,
        name: room.name,
        description: room.description,
        category: room.category,
        userCount: room.users.size
      }));
      io.emit('rooms_list', updatedRoomsList);

      console.log(`🔄 ${user.username} restored to room: ${roomData.name}`);
    } else {
      // Just restore user without room
      socket.emit('session_restored', {
        room: null,
        messages: [],
        users: []
      });
    }
  });

  // Handle user joining
  socket.on('join', (userData) => {
    const { username } = userData;
    
    if (!username || username.trim().length === 0) {
      socket.emit('join_error', { message: 'Username is required' });
      return;
    }

    const trimmedUsername = username.trim();
    
    if (trimmedUsername.length > 20) {
      socket.emit('join_error', { message: 'Username must be 20 characters or less' });
      return;
    }

    if (usernames.has(trimmedUsername.toLowerCase())) {
      socket.emit('join_error', { message: 'Username already taken' });
      return;
    }

    // Create user
    const user = {
      id: socket.id,
      username: trimmedUsername,
      joinedAt: new Date().toISOString(),
      currentRoom: null
    };

    users.set(socket.id, user);
    usernames.add(trimmedUsername.toLowerCase());
    
    console.log(`✅ User joined: ${user.username} (${socket.id}) from ${clientIP}`);
    socket.emit('user_joined', user);
  });

  // Handle joining a room
  socket.on('join_room', (data) => {
    const { roomId } = data;
    const user = users.get(socket.id);
    if (!user || !rooms.has(roomId)) return;

    let previousRoom = null;
    let previousRoomName = '';

    // Leave current room and notify other users
    for (const [id, room] of rooms.entries()) {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        socket.leave(id);
        previousRoom = id;
        previousRoomName = room.name;
        
        // Get updated user list for the previous room
        const updatedUsers = Array.from(room.users).map(userId => users.get(userId)?.username).filter(Boolean);
        
        // Notify users in previous room that this user left
        socket.to(id).emit('user_left', { 
          username: user.username, 
          userCount: room.users.size,
          updatedUsers: updatedUsers
        });
        
            // Update room count for previous room
    io.emit('room_updated', {
      roomId: id,
      userCount: room.users.size
    });

    // Send updated rooms list to all clients
    const updatedRoomsList = Array.from(rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      description: room.description,
      userCount: room.users.size
    }));
    io.emit('rooms_list', updatedRoomsList);
        
        console.log(`👋 ${user.username} left room: ${room.name} (${room.users.size} users remaining)`);
        break;
      }
    }

    // Join new room
    const room = rooms.get(roomId);
    room.users.add(socket.id);
    socket.join(roomId);
    user.currentRoom = roomId;

    // Get updated user list for new room
    const roomUsers = Array.from(room.users).map(userId => users.get(userId)?.username).filter(Boolean);

    socket.emit('room_joined', {
      room: {
        id: room.id,
        name: room.name,
        description: room.description,
        category: room.category,
        userCount: room.users.size
      },
      messages: room.messages.slice(-50),
      users: roomUsers
    });

    // Notify other users in new room that this user joined
    socket.to(roomId).emit('user_joined_room', { 
      username: user.username, 
      userCount: room.users.size,
      updatedUsers: roomUsers
    });

    // Update room count for new room
    io.emit('room_updated', {
      roomId,
      userCount: room.users.size
    });

    // Send updated rooms list to all clients
    const updatedRoomsList = Array.from(rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      description: room.description,
      userCount: room.users.size
    }));
    io.emit('rooms_list', updatedRoomsList);

    console.log(`🚪 ${user.username} joined room: ${room.name} (${room.users.size} users total)`);
    if (previousRoom) {
      console.log(`   ↳ Previously in: ${previousRoomName}`);
    }
  });

  // Handle sending messages
  socket.on('send_message', (messageData) => {
    const user = users.get(socket.id);
    if (!user || !user.currentRoom) return;

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    const message = {
      id: uuidv4(),
      username: user.username,
      content: messageData.content.trim(),
      timestamp: new Date().toISOString(),
      roomId: user.currentRoom
    };

    // Basic message validation
    if (!message.content || message.content.length === 0) return;
    if (message.content.length > 1000) {
      socket.emit('error', { message: 'Message too long (max 1000 characters)' });
      return;
    }

    // Store message in room
    room.messages.push(message);
    
    // Keep only last 100 messages per room
    if (room.messages.length > 100) {
      room.messages = room.messages.slice(-100);
    }

    // Broadcast message to room
    io.to(user.currentRoom).emit('new_message', message);
    
    console.log(`💬 ${user.username} in ${room.name}: ${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}`);
  });

  // Handle private messages
  socket.on('private_message', (messageData) => {
    const user = users.get(socket.id);
    if (!user) return;

    const { to, content, id, timestamp } = messageData;
    
    // Basic validation
    if (!to || !content || content.trim().length === 0) return;
    if (content.length > 1000) {
      socket.emit('error', { message: 'Message too long (max 1000 characters)' });
      return;
    }

    // Find the recipient
    let recipientSocketId = null;
    for (const [socketId, userData] of users.entries()) {
      if (userData.username === to) {
        recipientSocketId = socketId;
        break;
      }
    }

    if (!recipientSocketId) {
      socket.emit('error', { message: 'User not found or offline' });
      return;
    }

    // Create the private message
    const privateMessage = {
      id: id || uuidv4(),
      from: user.username,
      to: to,
      content: content.trim(),
      timestamp: timestamp || new Date().toISOString()
    };

    // Send to recipient
    socket.to(recipientSocketId).emit('private_message', privateMessage);
    
    console.log(`💌 Private message from ${user.username} to ${to}: ${content.substring(0, 30)}${content.length > 30 ? '...' : ''}`);
  });

  // Handle typing indicators
  socket.on('typing_start', () => {
    const user = users.get(socket.id);
    if (user && user.currentRoom) {
      socket.to(user.currentRoom).emit('user_typing', user.username);
    }
  });

  socket.on('typing_stop', () => {
    const user = users.get(socket.id);
    if (user && user.currentRoom) {
      socket.to(user.currentRoom).emit('user_stopped_typing', user.username);
    }
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    const user = users.get(socket.id);
    if (!user) return;
    
    console.log(`👋 User disconnected: ${user.username} (${socket.id}) - ${reason}`);
    
    // Remove from current room and notify other users
    if (user.currentRoom && rooms.has(user.currentRoom)) {
      const room = rooms.get(user.currentRoom);
      room.users.delete(socket.id);
      
      // Get updated user list after removal
      const updatedUsers = Array.from(room.users).map(userId => users.get(userId)?.username).filter(Boolean);
      
      // Notify remaining users in the room
      socket.to(user.currentRoom).emit('user_left', { 
        username: user.username, 
        userCount: room.users.size,
        updatedUsers: updatedUsers
      });
      
      // Update room count globally
      io.emit('room_updated', {
        roomId: user.currentRoom,
        userCount: room.users.size
      });

      // Send updated rooms list to all clients
      const updatedRoomsList = Array.from(rooms.values()).map(room => ({
        id: room.id,
        name: room.name,
        description: room.description,
        category: room.category,
        userCount: room.users.size
      }));
      io.emit('rooms_list', updatedRoomsList);
      
      console.log(`   ↳ Removed from room: ${room.name} (${room.users.size} users remaining)`);
    }
    
    // Clean up user data
    users.delete(socket.id);
    if (user.username) {
      usernames.delete(user.username.toLowerCase());
      console.log(`   ↳ Username "${user.username}" released`);
    }
  });
});

// Cleanup old messages every 30 minutes
setInterval(() => {
  let totalCleaned = 0;
  for (const [roomId, room] of rooms.entries()) {
    const beforeCount = room.messages.length;
    room.messages = room.messages.slice(-50); // Keep only last 50 messages
    const cleaned = beforeCount - room.messages.length;
    totalCleaned += cleaned;
  }
  
  if (totalCleaned > 0) {
    console.log(`🧹 Cleaned up ${totalCleaned} old messages across all rooms`);
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('🎉 ============================================');
  console.log('🚀 Chat Server Started Successfully!');
  console.log('🎉 ============================================');
  console.log('');
  console.log(`📍 Server URL: http://${HOST}:${PORT}`);
  console.log(`💬 Chat Client: http://localhost:3000`);
  console.log('');
  console.log('📋 Features Active:');
  console.log('   ✅ Real-time messaging');
  console.log('   ✅ Multiple chat rooms');
  console.log('   ✅ User authentication');
  console.log('   ✅ Room switching (fixed)');
  console.log('');
  console.log('🔧 Mode: Simple Standalone (No external dependencies)');
  console.log(`🆔 Process ID: ${process.pid}`);
  console.log('');
  console.log('Ready for connections! 🎯');
  console.log('============================================');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
