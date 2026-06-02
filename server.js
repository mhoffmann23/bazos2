const express = require('express');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DB_PATH = path.join(__dirname, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const AD_TYPES = new Set(['offer', 'request', 'job', 'auction']);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

function ensureDbShape(db) {
  db.users = Array.isArray(db.users) ? db.users : [];
  db.ads = Array.isArray(db.ads) ? db.ads : [];
  db.chats = Array.isArray(db.chats) ? db.chats : [];
  db.swipes = Array.isArray(db.swipes) ? db.swipes : [];
  return db;
}

function readDb() {
  if (!fs.existsSync(DB_PATH)) {
    const empty = ensureDbShape({});
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  return ensureDbShape(JSON.parse(raw || '{}'));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function getRequesterId(req) {
  return req.header('x-user-id') || req.query.userId || req.body.userId || null;
}

function getUser(db, userId) {
  return db.users.find((user) => user.id === userId);
}

function decorateUser(user) {
  const ratings = Array.isArray(user.ratings) ? user.ratings : [];
  const likes = Array.isArray(user.likes) ? user.likes : [];
  const ratingSum = ratings.reduce((sum, rating) => sum + (Number(rating.stars) || 0), 0);
  const ratingAverage = ratings.length ? Math.round((ratingSum / ratings.length) * 10) / 10 : 0;

  return {
    ...user,
    likesCount: likes.length,
    ratingAverage,
    ratingCount: ratings.length
  };
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/users', (req, res) => {
  const db = readDb();
  res.json(db.users.map((user) => decorateUser(user)));
});

app.get('/api/users/:id', (req, res) => {
  const db = readDb();
  const user = getUser(db, req.params.id);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const ads = db.ads.filter((ad) => ad.ownerId === user.id);
  return res.json({ user: decorateUser(user), ads });
});

app.patch('/api/users/:id', (req, res) => {
  const db = readDb();
  const user = getUser(db, req.params.id);
  const requesterId = getRequesterId(req);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (!requesterId || requesterId !== user.id) {
    return res.status(403).json({ error: 'Only the owner can update this profile' });
  }

  if (typeof req.body.displayName === 'string') {
    user.displayName = req.body.displayName.trim();
  }
  if (typeof req.body.bio === 'string') {
    user.bio = req.body.bio.trim();
  }
  if (typeof req.body.datingBio === 'string') {
    user.datingBio = req.body.datingBio.trim();
  }
  if (typeof req.body.datingOptIn === 'boolean') {
    user.datingOptIn = req.body.datingOptIn;
  }

  writeDb(db);
  return res.json({ user: decorateUser(user) });
});

app.post('/api/users/:id/like', (req, res) => {
  const db = readDb();
  const user = getUser(db, req.params.id);
  const fromUserId = req.body.fromUserId || getRequesterId(req);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (!fromUserId) {
    return res.status(400).json({ error: 'fromUserId is required' });
  }
  if (fromUserId === user.id) {
    return res.status(400).json({ error: 'You cannot like your own profile' });
  }

  user.likes = Array.isArray(user.likes) ? user.likes : [];
  if (!user.likes.includes(fromUserId)) {
    user.likes.push(fromUserId);
  }

  writeDb(db);
  return res.json({ likesCount: user.likes.length });
});

app.post('/api/users/:id/comments', (req, res) => {
  const db = readDb();
  const user = getUser(db, req.params.id);
  const fromUserId = req.body.fromUserId || getRequesterId(req);
  const text = (req.body.text || '').trim();

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (!fromUserId) {
    return res.status(400).json({ error: 'fromUserId is required' });
  }
  if (!text) {
    return res.status(400).json({ error: 'Comment text is required' });
  }

  user.comments = Array.isArray(user.comments) ? user.comments : [];
  const comment = {
    id: randomUUID(),
    fromUserId,
    text,
    createdAt: nowIso()
  };
  user.comments.unshift(comment);

  writeDb(db);
  return res.json({ comment });
});

app.post('/api/users/:id/rating', (req, res) => {
  const db = readDb();
  const user = getUser(db, req.params.id);
  const fromUserId = req.body.fromUserId || getRequesterId(req);
  const stars = Number(req.body.stars);
  const comment = typeof req.body.comment === 'string' ? req.body.comment.trim() : '';

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (!fromUserId) {
    return res.status(400).json({ error: 'fromUserId is required' });
  }
  if (fromUserId === user.id) {
    return res.status(400).json({ error: 'You cannot rate your own profile' });
  }
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'Stars must be an integer between 1 and 5' });
  }

  user.ratings = Array.isArray(user.ratings) ? user.ratings : [];
  const existing = user.ratings.find((rating) => rating.fromUserId === fromUserId);

  if (existing) {
    existing.stars = stars;
    existing.comment = comment;
    existing.updatedAt = nowIso();
  } else {
    user.ratings.push({
      id: randomUUID(),
      fromUserId,
      stars,
      comment,
      createdAt: nowIso()
    });
  }

  writeDb(db);
  return res.json({ user: decorateUser(user) });
});

app.get('/api/dating', (req, res) => {
  const db = readDb();
  const userId = getRequesterId(req);

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const matches = db.users
    .filter((user) => user.datingOptIn)
    .filter((user) => user.id !== userId)
    .map((user) => decorateUser(user));

  return res.json(matches);
});

app.get('/api/ads', (req, res) => {
  const db = readDb();
  let ads = [...db.ads];

  if (req.query.ownerId) {
    ads = ads.filter((ad) => ad.ownerId === req.query.ownerId);
  }
  if (req.query.type) {
    ads = ads.filter((ad) => ad.type === req.query.type);
  }
  if (req.query.q) {
    const query = String(req.query.q).toLowerCase();
    ads = ads.filter((ad) => `${ad.title} ${ad.description}`.toLowerCase().includes(query));
  }

  ads.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.json(ads);
});

app.get('/api/ads/:id', (req, res) => {
  const db = readDb();
  const ad = db.ads.find((item) => item.id === req.params.id);

  if (!ad) {
    return res.status(404).json({ error: 'Ad not found' });
  }

  return res.json(ad);
});

app.post('/api/ads', (req, res) => {
  const db = readDb();
  const ownerId = req.body.ownerId || getRequesterId(req);
  const type = req.body.type;
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const location = typeof req.body.location === 'string' ? req.body.location.trim() : '';
  const priceValue = req.body.price === '' || req.body.price === undefined ? null : Number(req.body.price);

  if (!ownerId) {
    return res.status(400).json({ error: 'ownerId is required' });
  }
  if (!AD_TYPES.has(type)) {
    return res.status(400).json({ error: 'Invalid ad type' });
  }
  if (!title || !description) {
    return res.status(400).json({ error: 'Title and description are required' });
  }
  if (priceValue !== null && Number.isNaN(priceValue)) {
    return res.status(400).json({ error: 'Price must be a number' });
  }

  const ad = {
    id: randomUUID(),
    ownerId,
    type,
    title,
    description,
    price: priceValue,
    location,
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  db.ads.push(ad);
  writeDb(db);
  return res.status(201).json(ad);
});

app.put('/api/ads/:id', (req, res) => {
  const db = readDb();
  const ad = db.ads.find((item) => item.id === req.params.id);
  const ownerId = req.body.ownerId || getRequesterId(req);

  if (!ad) {
    return res.status(404).json({ error: 'Ad not found' });
  }
  if (!ownerId || ad.ownerId !== ownerId) {
    return res.status(403).json({ error: 'Only the owner can update this ad' });
  }

  if (req.body.type && AD_TYPES.has(req.body.type)) {
    ad.type = req.body.type;
  }
  if (typeof req.body.title === 'string') {
    ad.title = req.body.title.trim();
  }
  if (typeof req.body.description === 'string') {
    ad.description = req.body.description.trim();
  }
  if (typeof req.body.location === 'string') {
    ad.location = req.body.location.trim();
  }
  if (req.body.status) {
    ad.status = String(req.body.status);
  }
  if (req.body.price !== undefined) {
    const priceValue = req.body.price === '' ? null : Number(req.body.price);
    if (priceValue !== null && Number.isNaN(priceValue)) {
      return res.status(400).json({ error: 'Price must be a number' });
    }
    ad.price = priceValue;
  }

  ad.updatedAt = nowIso();
  writeDb(db);
  return res.json(ad);
});

app.delete('/api/ads/:id', (req, res) => {
  const db = readDb();
  const adIndex = db.ads.findIndex((item) => item.id === req.params.id);
  const ownerId = req.query.ownerId || getRequesterId(req);

  if (adIndex === -1) {
    return res.status(404).json({ error: 'Ad not found' });
  }
  if (!ownerId || db.ads[adIndex].ownerId !== ownerId) {
    return res.status(403).json({ error: 'Only the owner can delete this ad' });
  }

  const removed = db.ads.splice(adIndex, 1)[0];
  writeDb(db);
  return res.json({ removed });
});

app.get('/api/chats', (req, res) => {
  const db = readDb();
  const userId = getRequesterId(req);

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const chats = db.chats
    .filter((chat) => Array.isArray(chat.participants) && chat.participants.includes(userId))
    .map((chat) => {
      const messages = Array.isArray(chat.messages) ? chat.messages : [];
      return {
        id: chat.id,
        participants: chat.participants,
        lastMessage: messages[messages.length - 1] || null
      };
    });

  return res.json(chats);
});

app.post('/api/chats', (req, res) => {
  const db = readDb();
  const userId = req.body.userId || getRequesterId(req);
  const otherUserId = req.body.otherUserId;

  if (!userId || !otherUserId) {
    return res.status(400).json({ error: 'userId and otherUserId are required' });
  }
  if (userId === otherUserId) {
    return res.status(400).json({ error: 'Chat requires two different users' });
  }
  if (!getUser(db, userId) || !getUser(db, otherUserId)) {
    return res.status(404).json({ error: 'User not found' });
  }

  let chat = db.chats.find(
    (item) =>
      Array.isArray(item.participants) &&
      item.participants.length === 2 &&
      item.participants.includes(userId) &&
      item.participants.includes(otherUserId)
  );

  if (!chat) {
    chat = {
      id: randomUUID(),
      participants: [userId, otherUserId],
      messages: []
    };
    db.chats.push(chat);
    writeDb(db);
  }

  return res.status(201).json(chat);
});

app.get('/api/chats/:id', (req, res) => {
  const db = readDb();
  const userId = getRequesterId(req);
  const chat = db.chats.find((item) => item.id === req.params.id);

  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  if (!userId || !chat.participants.includes(userId)) {
    return res.status(403).json({ error: 'You are not a participant of this chat' });
  }

  return res.json(chat);
});

app.post('/api/chats/:id/messages', (req, res) => {
  const db = readDb();
  const chat = db.chats.find((item) => item.id === req.params.id);
  const fromUserId = req.body.fromUserId || getRequesterId(req);
  const text = (req.body.text || '').trim();

  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  if (!fromUserId || !chat.participants.includes(fromUserId)) {
    return res.status(403).json({ error: 'You are not a participant of this chat' });
  }
  if (!text) {
    return res.status(400).json({ error: 'Message text is required' });
  }

  const toUserId = chat.participants.find((id) => id !== fromUserId) || null;
  chat.messages = Array.isArray(chat.messages) ? chat.messages : [];
  const message = {
    id: randomUUID(),
    fromUserId,
    toUserId,
    text,
    sentAt: nowIso()
  };

  chat.messages.push(message);
  writeDb(db);
  return res.status(201).json(message);
});

app.get('/api/swipes/ads/random', (req, res) => {
  const db = readDb();
  const userId = getRequesterId(req);

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const swipedAdIds = new Set(
    db.swipes.filter((swipe) => swipe.fromUserId === userId).map((swipe) => swipe.adId)
  );
  const candidates = db.ads.filter(
    (ad) => ad.ownerId !== userId && ad.status !== 'deleted' && !swipedAdIds.has(ad.id)
  );

  if (!candidates.length) {
    return res.json({ ad: null });
  }

  const randomIndex = Math.floor(Math.random() * candidates.length);
  return res.json({ ad: candidates[randomIndex] });
});

app.post('/api/swipes', (req, res) => {
  const db = readDb();
  const userId = req.body.userId || getRequesterId(req);
  const adId = req.body.adId;
  const liked = Boolean(req.body.liked);

  if (!userId || !adId) {
    return res.status(400).json({ error: 'userId and adId are required' });
  }

  const ad = db.ads.find((item) => item.id === adId);
  if (!ad) {
    return res.status(404).json({ error: 'Ad not found' });
  }
  if (ad.ownerId === userId) {
    return res.status(400).json({ error: 'You cannot swipe your own ad' });
  }

  const existing = db.swipes.find((swipe) => swipe.adId === adId && swipe.fromUserId === userId);
  if (existing) {
    existing.liked = liked;
    existing.swipedAt = nowIso();
  } else {
    db.swipes.push({
      id: randomUUID(),
      adId,
      fromUserId: userId,
      liked,
      swipedAt: nowIso()
    });
  }

  writeDb(db);
  return res.status(201).json({ ok: true });
});

app.get('/api/ads/:id/swipes', (req, res) => {
  const db = readDb();
  const ad = db.ads.find((item) => item.id === req.params.id);
  const ownerId = req.query.ownerId || getRequesterId(req);

  if (!ad) {
    return res.status(404).json({ error: 'Ad not found' });
  }
  if (!ownerId || ad.ownerId !== ownerId) {
    return res.status(403).json({ error: 'Only the owner can see swipe analytics' });
  }

  const swipes = db.swipes.filter((swipe) => swipe.adId === ad.id);
  const likes = swipes.filter((swipe) => swipe.liked).length;
  const dislikes = swipes.length - likes;

  const recent = [...swipes]
    .sort((a, b) => new Date(b.swipedAt) - new Date(a.swipedAt))
    .slice(0, 20);

  return res.json({
    adId: ad.id,
    summary: {
      total: swipes.length,
      likes,
      dislikes
    },
    recent
  });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Bazos 2.0 running on http://localhost:${PORT}`);
});
