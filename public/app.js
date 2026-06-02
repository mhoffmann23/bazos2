const state = {
  users: [],
  currentUserId: null,
  currentChatId: null,
  currentSwipeAd: null
};

const elements = {
  currentUserSelect: document.getElementById('currentUserSelect'),
  adTypeFilter: document.getElementById('adTypeFilter'),
  adsList: document.getElementById('adsList'),
  createAdForm: document.getElementById('createAdForm'),
  chatList: document.getElementById('chatList'),
  chatMessages: document.getElementById('chatMessages'),
  createChatForm: document.getElementById('createChatForm'),
  chatUserSelect: document.getElementById('chatUserSelect'),
  sendMessageForm: document.getElementById('sendMessageForm'),
  messageInput: document.getElementById('messageInput'),
  profileUserSelect: document.getElementById('profileUserSelect'),
  profileInfo: document.getElementById('profileInfo'),
  profileComments: document.getElementById('profileComments'),
  profileAds: document.getElementById('profileAds'),
  likeProfileButton: document.getElementById('likeProfileButton'),
  ratingSelect: document.getElementById('ratingSelect'),
  rateProfileButton: document.getElementById('rateProfileButton'),
  commentForm: document.getElementById('commentForm'),
  commentInput: document.getElementById('commentInput'),
  datingToggle: document.getElementById('datingToggle'),
  datingList: document.getElementById('datingList'),
  swipeCard: document.getElementById('swipeCard'),
  dislikeButton: document.getElementById('dislikeButton'),
  likeButton: document.getElementById('likeButton'),
  analyticsAdSelect: document.getElementById('analyticsAdSelect'),
  analyticsResult: document.getElementById('analyticsResult'),
  toast: document.getElementById('toast')
};

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.style.borderColor = isError ? '#ff6b6b' : '#2c3240';
  elements.toast.classList.add('show');
  setTimeout(() => elements.toast.classList.remove('show'), 2200);
}

async function api(path, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  if (state.currentUserId) {
    headers['x-user-id'] = state.currentUserId;
  }
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let errorMessage = 'Request failed';
    try {
      const data = await response.json();
      errorMessage = data.error || errorMessage;
    } catch (error) {
      errorMessage = response.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

function getUserName(userId) {
  const user = state.users.find((item) => item.id === userId);
  return user ? user.displayName : userId;
}

function fillUserSelect(select, users, selectedId, excludeId) {
  select.innerHTML = '';
  users
    .filter((user) => user.id !== excludeId)
    .forEach((user) => {
      const option = document.createElement('option');
      option.value = user.id;
      option.textContent = user.displayName;
      if (user.id === selectedId) {
        option.selected = true;
      }
      select.appendChild(option);
    });
}

async function loadUsers() {
  state.users = await api('/api/users');
  if (!state.currentUserId && state.users.length) {
    state.currentUserId = state.users[0].id;
  }
  fillUserSelect(elements.currentUserSelect, state.users, state.currentUserId);
  fillUserSelect(elements.profileUserSelect, state.users, state.currentUserId);
  fillUserSelect(elements.chatUserSelect, state.users, null, state.currentUserId);
}

async function loadAds() {
  const type = elements.adTypeFilter.value;
  const query = type ? `?type=${encodeURIComponent(type)}` : '';
  const ads = await api(`/api/ads${query}`);
  elements.adsList.innerHTML = '';

  ads.forEach((ad) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h4>${ad.title}</h4>
      <p>${ad.description}</p>
      <p class="meta">Typ: ${ad.type} | Cena: ${ad.price ?? 'N/A'} | Lokace: ${ad.location || '-'}</p>
      <p class="meta">Autor: ${getUserName(ad.ownerId)}</p>
    `;
    elements.adsList.appendChild(card);
  });
}

async function createAd(event) {
  event.preventDefault();
  const formData = new FormData(elements.createAdForm);
  const payload = Object.fromEntries(formData.entries());
  payload.ownerId = state.currentUserId;

  try {
    await api('/api/ads', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    elements.createAdForm.reset();
    await loadAds();
    await loadProfile();
    await loadAnalyticsAds();
    showToast('Inzerat ulozen');
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadChats() {
  const chats = await api(`/api/chats?userId=${state.currentUserId}`);
  elements.chatList.innerHTML = '';

  chats.forEach((chat) => {
    const listItem = document.createElement('div');
    listItem.className = 'list-item';
    const other = chat.participants.find((id) => id !== state.currentUserId);
    listItem.innerHTML = `
      <strong>${getUserName(other)}</strong>
      <span class="meta">${chat.lastMessage ? chat.lastMessage.text : 'Zadna zprava'}</span>
    `;
    listItem.addEventListener('click', () => openChat(chat.id));
    elements.chatList.appendChild(listItem);
  });
}

async function openChat(chatId) {
  state.currentChatId = chatId;
  const chat = await api(`/api/chats/${chatId}?userId=${state.currentUserId}`);
  renderMessages(chat.messages || []);
}

function renderMessages(messages) {
  elements.chatMessages.innerHTML = '';
  messages.forEach((message) => {
    const item = document.createElement('div');
    item.className = `message ${message.fromUserId === state.currentUserId ? 'me' : ''}`;
    item.innerHTML = `
      <strong>${getUserName(message.fromUserId)}</strong>
      <div>${message.text}</div>
      <div class="meta">${new Date(message.sentAt).toLocaleString()}</div>
    `;
    elements.chatMessages.appendChild(item);
  });
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

async function createChat(event) {
  event.preventDefault();
  const otherUserId = elements.chatUserSelect.value;
  if (!otherUserId) {
    return;
  }
  try {
    const chat = await api('/api/chats', {
      method: 'POST',
      body: JSON.stringify({ userId: state.currentUserId, otherUserId })
    });
    await loadChats();
    await openChat(chat.id);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const text = elements.messageInput.value.trim();
  if (!text || !state.currentChatId) {
    return;
  }
  try {
    await api(`/api/chats/${state.currentChatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ fromUserId: state.currentUserId, text })
    });
    elements.messageInput.value = '';
    await openChat(state.currentChatId);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadProfile() {
  const userId = elements.profileUserSelect.value || state.currentUserId;
  if (!userId) {
    return;
  }
  const { user, ads } = await api(`/api/users/${userId}`);

  elements.profileInfo.innerHTML = `
    <strong>${user.displayName}</strong>
    <p>${user.bio || 'Bez popisu'}</p>
    <p class="meta">Likes: ${user.likesCount} | Hodnoceni: ${user.ratingAverage} (${user.ratingCount})</p>
  `;

  elements.profileComments.innerHTML = '';
  (user.comments || []).forEach((comment) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <strong>${getUserName(comment.fromUserId)}</strong>
      <div>${comment.text}</div>
      <div class="meta">${new Date(comment.createdAt).toLocaleString()}</div>
    `;
    elements.profileComments.appendChild(item);
  });

  elements.profileAds.innerHTML = '';
  ads.forEach((ad) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <strong>${ad.title}</strong>
      <div class="meta">${ad.type} | ${ad.price ?? 'N/A'} | ${ad.location || '-'}</div>
    `;
    elements.profileAds.appendChild(item);
  });

  const isOwner = state.currentUserId && state.currentUserId === user.id;
  elements.datingToggle.checked = Boolean(isOwner && user.datingOptIn);
  elements.datingToggle.disabled = !isOwner;
}

async function likeProfile() {
  const userId = elements.profileUserSelect.value;
  if (!userId) {
    return;
  }
  try {
    await api(`/api/users/${userId}/like`, {
      method: 'POST',
      body: JSON.stringify({ fromUserId: state.currentUserId })
    });
    await loadProfile();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function rateProfile() {
  const userId = elements.profileUserSelect.value;
  if (!userId) {
    return;
  }
  try {
    await api(`/api/users/${userId}/rating`, {
      method: 'POST',
      body: JSON.stringify({ fromUserId: state.currentUserId, stars: Number(elements.ratingSelect.value) })
    });
    await loadProfile();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function commentProfile(event) {
  event.preventDefault();
  const userId = elements.profileUserSelect.value;
  const text = elements.commentInput.value.trim();
  if (!userId || !text) {
    return;
  }
  try {
    await api(`/api/users/${userId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ fromUserId: state.currentUserId, text })
    });
    elements.commentInput.value = '';
    await loadProfile();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadDating() {
  const users = await api(`/api/dating?userId=${state.currentUserId}`);
  elements.datingList.innerHTML = '';
  users.forEach((user) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h4>${user.displayName}</h4>
      <p>${user.datingBio || user.bio || 'Bez popisu'}</p>
      <p class="meta">Likes: ${user.likesCount} | Hodnoceni: ${user.ratingAverage}</p>
    `;
    elements.datingList.appendChild(card);
  });
}

async function toggleDating() {
  try {
    await api(`/api/users/${state.currentUserId}`, {
      method: 'PATCH',
      body: JSON.stringify({ userId: state.currentUserId, datingOptIn: elements.datingToggle.checked })
    });
    await loadDating();
    showToast('Nastaveni seznamky ulozeno');
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadSwipeAd() {
  const { ad } = await api(`/api/swipes/ads/random?userId=${state.currentUserId}`);
  state.currentSwipeAd = ad;
  renderSwipeCard();
}

function renderSwipeCard() {
  if (!state.currentSwipeAd) {
    elements.swipeCard.innerHTML = '<p>Uz nejsou dalsi inzeraty.</p>';
    return;
  }
  const ad = state.currentSwipeAd;
  elements.swipeCard.innerHTML = `
    <h4>${ad.title}</h4>
    <p>${ad.description}</p>
    <p class="meta">Typ: ${ad.type} | Cena: ${ad.price ?? 'N/A'} | Lokace: ${ad.location || '-'}</p>
  `;
}

async function submitSwipe(liked) {
  if (!state.currentSwipeAd) {
    return;
  }
  try {
    await api('/api/swipes', {
      method: 'POST',
      body: JSON.stringify({
        userId: state.currentUserId,
        adId: state.currentSwipeAd.id,
        liked
      })
    });
    await loadSwipeAd();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadAnalyticsAds() {
  const ads = await api(`/api/ads?ownerId=${state.currentUserId}`);
  elements.analyticsAdSelect.innerHTML = '';
  ads.forEach((ad) => {
    const option = document.createElement('option');
    option.value = ad.id;
    option.textContent = ad.title;
    elements.analyticsAdSelect.appendChild(option);
  });
  if (ads.length) {
    await loadAnalytics();
  } else {
    elements.analyticsResult.textContent = 'Zatim zadne vlastni inzeraty.';
  }
}

async function loadAnalytics() {
  const adId = elements.analyticsAdSelect.value;
  if (!adId) {
    return;
  }
  const data = await api(`/api/ads/${adId}/swipes?ownerId=${state.currentUserId}`);
  elements.analyticsResult.innerHTML = `
    <p>Celkem swipu: ${data.summary.total}</p>
    <p>Libi: ${data.summary.likes}</p>
    <p>Nelibi: ${data.summary.dislikes}</p>
  `;
}

function setupTabs() {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab-button').forEach((btn) => btn.classList.remove('active'));
      document.querySelectorAll('.section').forEach((section) => section.classList.remove('active'));
      button.classList.add('active');
      document.getElementById(button.dataset.target).classList.add('active');
    });
  });
}

async function refreshAll() {
  await loadUsers();
  await loadAds();
  await loadChats();
  await loadProfile();
  await loadDating();
  await loadSwipeAd();
  await loadAnalyticsAds();
}

function setupEvents() {
  elements.currentUserSelect.addEventListener('change', async () => {
    state.currentUserId = elements.currentUserSelect.value;
    fillUserSelect(elements.chatUserSelect, state.users, null, state.currentUserId);
    fillUserSelect(elements.profileUserSelect, state.users, state.currentUserId);
    await refreshAll();
  });

  elements.adTypeFilter.addEventListener('change', loadAds);
  elements.createAdForm.addEventListener('submit', createAd);
  elements.createChatForm.addEventListener('submit', createChat);
  elements.sendMessageForm.addEventListener('submit', sendMessage);
  elements.profileUserSelect.addEventListener('change', loadProfile);
  elements.likeProfileButton.addEventListener('click', likeProfile);
  elements.rateProfileButton.addEventListener('click', rateProfile);
  elements.commentForm.addEventListener('submit', commentProfile);
  elements.datingToggle.addEventListener('change', toggleDating);
  elements.dislikeButton.addEventListener('click', () => submitSwipe(false));
  elements.likeButton.addEventListener('click', () => submitSwipe(true));
  elements.analyticsAdSelect.addEventListener('change', loadAnalytics);
}

async function init() {
  setupTabs();
  setupEvents();
  try {
    await refreshAll();
  } catch (error) {
    showToast(error.message, true);
  }
}

document.addEventListener('DOMContentLoaded', init);
