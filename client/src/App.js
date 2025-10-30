// client/src/App.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import {
  Container, Row, Col, Form, Button, ListGroup, Badge,
  InputGroup, Modal, Image, Alert, Spinner, Dropdown
} from 'react-bootstrap';
import {
  Send, CircleFill, People, Type, Paperclip,
  Hash, Person, Check2All, Search, List,
  Heart, EmojiLaughing, HandThumbsUp
} from 'react-bootstrap-icons';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

const socket = io('http://localhost:5000', { 
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

const PAGE_SIZE = 20;
const REACTION_EMOJIS = ['heart', 'laugh', 'like'];

function App() {
  const [username, setUsername] = useState('');
  const [connected, setConnected] = useState(false);
  const [activeRoom, setActiveRoom] = useState('global');
  const [rooms, setRooms] = useState(['global']);
  const [messages, setMessages] = useState({});
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [unreadCounts, setUnreadCounts] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showPrivateModal, setShowPrivateModal] = useState(false);
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const messagesEndRef = useRef({});
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef({});
  const observer = useRef();

  useEffect(() => {
    socket.on('connected', (data) => {
      setConnected(true);
      setOnlineUsers(data.onlineUsers || []);
      setRooms(data.rooms || ['global']);
      setMessages(prev => ({ ...prev, [data.activeRoom]: data.messages || [] }));
      setActiveRoom(data.activeRoom);
      setUnreadCounts(prev => ({ ...prev, [data.activeRoom]: 0 }));
      setError('');
      setSidebarOpen(false);
    });

    socket.on('roomCreated', (roomName) => {
      setRooms(prev => [...new Set([...prev, roomName])]);
    });

    socket.on('roomJoined', (data) => {
      setMessages(prev => ({ ...prev, [data.roomName]: data.messages }));
      setActiveRoom(data.roomName);
      setUnreadCounts(prev => ({ ...prev, [data.roomName]: data.unread || 0 }));
      setHasMore(prev => ({ ...prev, [data.roomName]: data.messages.length >= PAGE_SIZE }));
      setSidebarOpen(false);
    });

    socket.on('olderMessages', ({ room, messages: older }) => {
      setMessages(prev => ({ ...prev, [room]: [...older, ...(prev[room] || [])] }));
      setLoadingOlder(false);
      setHasMore(prev => ({ ...prev, [room]: older.length === PAGE_SIZE }));
    });

    socket.on('newMessage', (msg) => {
      setMessages(prev => ({ ...prev, [msg.room]: [...(prev[msg.room] || []), msg] }));
      if (msg.senderId !== socket.id && activeRoom !== msg.room) {
        playSound();
        showBrowserNotification(`#${msg.room}`, `${msg.sender}: ${msg.text || 'Image'}`);
      }
      if (msg.senderId !== socket.id) socket.emit('markAsRead', msg.id);
    });

    socket.on('notification', (notif) => {
      setNotifications(prev => [...prev.slice(-2), notif]);
      setTimeout(() => setNotifications(prev => prev.filter(n => n !== notif)), 4000);
    });

    socket.on('unreadUpdate', ({ room, unread }) => {
      setUnreadCounts(prev => ({ ...prev, [room]: unread[socket.id] || 0 }));
    });

    socket.on('typingUpdate', ({ room, typingUsers }) => {
      setTypingUsers(prev => ({ ...prev, [room]: typingUsers }));
    });

    socket.on('userOnline', (user) => {
      setOnlineUsers(prev => [...prev.filter(u => u.id !== user.id), user]);
    });

    socket.on('userOffline', (user) => {
      setOnlineUsers(prev => prev.filter(u => u.id !== user.id));
    });

    socket.on('messageRead', ({ messageId, readerId }) => {
      setMessages(prev => {
        const newMsgs = { ...prev };
        for (const r in newMsgs) {
          newMsgs[r] = newMsgs[r].map(m =>
            m.id === messageId ? { ...m, readBy: [...(m.readBy || []), readerId] } : m
          );
        }
        return newMsgs;
      });
    });

    socket.on('reactionUpdate', ({ messageId, reactions }) => {
      setMessages(prev => {
        const newMsgs = { ...prev };
        for (const r in newMsgs) {
          newMsgs[r] = newMsgs[r].map(m =>
            m.id === messageId ? { ...m, reactions } : m
          );
        }
        return newMsgs;
      });
    });

    socket.on('error', (msg) => {
      setError(msg);
      socket.disconnect();
    });

    return () => socket.off();
  }, [activeRoom]);

  useEffect(() => {
    socket.io.on('reconnect', () => {
      if (username) socket.emit('join', username);
    });
    return () => socket.io.off('reconnect');
  }, [username]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const playSound = () => {
    const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-software-interface-start-2579.mp3');
    audio.play().catch(() => {});
  };

  const showBrowserNotification = (title, body) => {
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  };

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
    });

  const handleTyping = (room, isTyping) => {
    if (typingTimeoutRef.current[room]) clearTimeout(typingTimeoutRef.current[room]);
    socket.emit('typing', { room, isTyping });
    if (isTyping) {
      typingTimeoutRef.current[room] = setTimeout(() => {
        socket.emit('typing', { room, isTyping: false });
      }, 1000);
    }
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!username.trim()) return setError('Username required');
    socket.connect();
    socket.emit('join', username.trim());
  };

  const loadOlder = useCallback(() => {
    if (loadingOlder || !hasMore[activeRoom]) return;
    setLoadingOlder(true);
    const oldest = messages[activeRoom]?.[0];
    socket.emit('loadOlderMessages', { room: activeRoom, beforeId: oldest?.id, limit: PAGE_SIZE });
  }, [activeRoom, messages, loadingOlder, hasMore]);

  const lastMessageRef = useCallback(node => {
    if (loadingOlder) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore[activeRoom]) loadOlder();
    });
    if (node) observer.current.observe(node);
  }, [loadingOlder, hasMore, loadOlder, activeRoom]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim() && !file) return;

    const fileData = file ? await fileToBase64(file) : null;

    if (selectedUser) {
      socket.emit('sendPrivateMessage', { toUsername: selectedUser, text: message, file: fileData });
    } else {
      socket.emit('sendMessage', { room: activeRoom, text: message, file: fileData });
    }

    setMessage('');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    handleTyping(activeRoom, false);
  };

  const reactToMessage = (messageId, emoji) => {
    socket.emit('reactToMessage', { messageId, emoji });
  };

  const filteredMessages = (messages[activeRoom] || [])
    .filter(m => !searchTerm || (m.text && m.text.toLowerCase().includes(searchTerm.toLowerCase())));

  if (!connected) {
    return (
      <Container className="mt-5">
        <Row className="justify-content-center">
          <Col xs={12} md={6}>
            <h2 className="text-center mb-4">Join Chat</h2>
            <Form onSubmit={handleJoin}>
              <Form.Group className="mb-3">
                <Form.Control
                  type="text"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  isInvalid={!!error}
                />
                <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
              </Form.Group>
              <Button variant="success" type="submit" className="w-100">
                Join Chat
              </Button>
            </Form>
          </Col>
        </Row>
      </Container>
    );
  }

  return (
    <>
      {/* Mobile Menu Button */}
      <div className="d-md-none p-2 bg-primary text-white position-fixed top-0 left-0 z-3">
        <Button variant="link" className="text-white p-0" onClick={() => setSidebarOpen(!sidebarOpen)}>
          <List size={24} />
        </Button>
      </div>

      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="position-fixed top-0 start-50 translate-middle-x z-3 mt-4" style={{ minWidth: '300px' }}>
          {notifications.map((n, i) => (
            <Alert key={i} variant={n.type === 'join' ? 'success' : 'warning'} className="shadow">
              {n.message}
            </Alert>
          ))}
        </div>
      )}

      <Container fluid className="h-100 p-0 d-flex">
        {/* Sidebar */}
        <div className={`sidebar bg-dark text-white d-flex flex-column ${sidebarOpen ? 'open' : ''}`}>
          <div className="p-3 border-bottom bg-darker">
            <h5 className="mb-0 text-white">Chat</h5>
          </div>
          
          <div className="flex-grow-1 overflow-auto">
            <ListGroup variant="flush" className="p-0">
              {rooms.map((room) => (
                <ListGroup.Item
                  key={room}
                  action
                  active={activeRoom === room}
                  onClick={() => {
                    setActiveRoom(room);
                    setUnreadCounts(prev => ({ ...prev, [room]: 0 }));
                    setSidebarOpen(false);
                  }}
                  className="border-0 bg-transparent text-white px-3 py-2 d-flex justify-content-between align-items-center"
                >
                  <div className="d-flex align-items-center">
                    <Hash size={16} className="me-2 text-muted" />
                    <span className="text-truncate">{room}</span>
                  </div>
                  {unreadCounts[room] > 0 && (
                    <Badge bg="danger" pill className="ms-2">{unreadCounts[room]}</Badge>
                  )}
                </ListGroup.Item>
              ))}
              <ListGroup.Item
                action
                onClick={() => {
                  const name = prompt('Room name:');
                  if (name?.trim()) socket.emit('joinRoom', name.trim());
                }}
                className="border-0 bg-transparent text-white px-3 py-2"
              >
                <Hash size={16} className="me-2 text-muted" />
                + New Room
              </ListGroup.Item>
            </ListGroup>
          </div>

          <div className="p-2 border-top bg-darker">
            <h6 className="mb-2 text-white">Users ({onlineUsers.length})</h6>
            <ListGroup variant="flush">
              {onlineUsers.map((user) => (
                <ListGroup.Item
                  key={user.id}
                  action
                  className="border-0 bg-transparent text-white px-2 py-1"
                  onClick={() => {
                    setSelectedUser(user.username);
                    setShowPrivateModal(true);
                    setSidebarOpen(false);
                  }}
                >
                  <div className="d-flex align-items-center">
                    <CircleFill size={10} className="text-success me-2 flex-shrink-0" />
                    <Person size={14} className="me-2 flex-shrink-0" />
                    <span className="text-truncate flex-grow-1">{user.username}</span>
                    {user.username === username && <Badge bg="info" className="ms-auto">You</Badge>}
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          </div>
        </div>

        {/* Sidebar Overlay */}
        <div 
          className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
          onClick={() => setSidebarOpen(false)}
        />

        {/* Main Chat Area */}
        <div className="flex-grow-1 d-flex flex-column h-100">
          {/* Header */}
          <div className="bg-primary text-white p-3 d-flex justify-content-between align-items-center">
            <h5 className="mb-0 fw-bold">
              {selectedUser ? `@${selectedUser}` : `#${activeRoom}`}
            </h5>
            <Badge bg="light" text="dark" className="rounded-pill px-2">
              <People className="me-1" size={14} />
              {onlineUsers.length}
            </Badge>
          </div>

          {/* Search Bar */}
          <div className="p-3 border-bottom bg-light">
            <InputGroup className="rounded-pill shadow-sm">
              <Form.Control
                placeholder="Search messages..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="border-0 bg-transparent rounded-pill"
                style={{ paddingLeft: '1rem' }}
              />
              <Button 
                variant="outline-secondary" 
                className="rounded-pill border-0"
                style={{ minWidth: '40px', marginRight: '1rem' }}
              >
                <Search size={16} />
              </Button>
            </InputGroup>
          </div>

          {/* Messages */}
          <div className="flex-grow-1 p-3 chat-area position-relative">
            {loadingOlder && (
              <div className="text-center my-3">
                <Spinner animation="border" size="sm" className="me-2" />
                Loading older messages...
              </div>
            )}

            {filteredMessages.map((msg, idx) => (
              <div
                key={msg.id}
                ref={idx === 0 ? lastMessageRef : null}
                className={`d-flex mb-3 ${msg.sender === username ? 'justify-content-end' : 'justify-content-start'}`}
              >
                <div
                  className={`p-3 rounded-3 shadow-sm message-bubble ${
                    msg.sender === username 
                      ? 'bg-primary text-white' 
                      : 'bg-white border'
                  }`}
                  style={{ maxWidth: '70%' }}
                >
                  {msg.sender !== username && !selectedUser && (
                    <div className="d-flex align-items-center mb-1">
                      <strong className="me-2 text-primary">{msg.sender}</strong>
                      <small className="text-muted">
                        {new Date(msg.timestamp).toLocaleTimeString([], { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </small>
                    </div>
                  )}
                  
                  {msg.file && (
                    <Image 
                      src={msg.file} 
                      rounded 
                      className="mb-2 d-block w-100" 
                      style={{ maxHeight: '200px', objectFit: 'cover' }} 
                    />
                  )}
                  
                  {msg.text && <p className="mb-1 m-0">{msg.text}</p>}
                  
                  {msg.sender === username && (
                    <small className="text-light">
                      {new Date(msg.timestamp).toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                      {Array.isArray(msg.readBy) && msg.readBy.length > 1 && (
                        <Check2All size={12} className="ms-1" />
                      )}
                    </small>
                  )}

                  {/* Reactions */}
                  {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                    <div className="d-flex gap-1 mt-2 flex-wrap">
                      {Object.entries(msg.reactions).map(([emoji, users]) => (
                        <Badge
                          key={emoji}
                          bg="light"
                          text="dark"
                          className="d-flex align-items-center px-2 py-1 reaction-badge"
                          style={{ fontSize: '0.75rem' }}
                        >
                          {emoji === 'heart' && <Heart size={12} className="text-danger" />}
                          {emoji === 'laugh' && <EmojiLaughing size={12} className="text-warning" />}
                          {emoji === 'like' && <HandThumbsUp size={12} className="text-primary" />}
                          {users.length}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Reaction Button */}
                  <Dropdown className="mt-1">
                    <Dropdown.Toggle variant="link" bsPrefix="p-0" className="text-decoration-none">
                      <small className="text-muted">Add reaction</small>
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                      {REACTION_EMOJIS.map(emoji => (
                        <Dropdown.Item key={emoji} onClick={() => reactToMessage(msg.id, emoji)}>
                          {emoji === 'heart' && <Heart size={18} className="text-danger" />}
                          {emoji === 'laugh' && <EmojiLaughing size={18} className="text-warning" />}
                          {emoji === 'like' && <HandThumbsUp size={18} className="text-primary" />}
                          <span className="ms-2 text-capitalize">{emoji}</span>
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Menu>
                  </Dropdown>
                </div>
              </div>
            ))}

            {typingUsers[activeRoom]?.length > 0 && typingUsers[activeRoom][0] !== username && (
              <div className="text-muted small p-2">
                <Type size={14} className="me-1" />
                {typingUsers[activeRoom].join(', ')} is typing...
              </div>
            )}

            <div ref={(el) => (messagesEndRef.current[activeRoom] = el)} />
          </div>

          {/* Message Input */}
          <Form onSubmit={sendMessage} className="p-3 border-top bg-white">
            <InputGroup className="rounded-pill shadow-sm">
              <Form.Control 
                type="file" 
                ref={fileInputRef} 
                onChange={(e) => setFile(e.target.files[0])} 
                className="d-none" 
                accept="image/*" 
              />
              <Button 
                variant="outline-secondary" 
                className="rounded-pill border-0"
                onClick={() => fileInputRef.current.click()}
              >
                <Paperclip size={18} />
              </Button>
              <Form.Control
                placeholder={`Message #${activeRoom}`}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  handleTyping(activeRoom, true);
                }}
                onKeyUp={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage(e)}
                className="border-0 rounded-pill"
              />
              <Button variant="primary" type="submit" className="rounded-pill">
                <Send size={18} />
              </Button>
            </InputGroup>
            {file && <small className="text-muted d-block mt-1">Attached: {file.name}</small>}
          </Form>
        </div>
      </Container>

      <Modal show={showPrivateModal} onHide={() => { setShowPrivateModal(false); setSelectedUser(null); }}>
        <Modal.Header closeButton>
          <Modal.Title>Private with {selectedUser}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="info">Private messages appear in the same room.</Alert>
        </Modal.Body>
      </Modal>
    </>
  );
}

export default App;