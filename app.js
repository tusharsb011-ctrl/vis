/* ═══════════════════════════════════════════════════
   MEMORABLE — Spaced Repetition Tracker
   Application Logic
   ═══════════════════════════════════════════════════ */

(() => {
    'use strict';

    // ────────── CONSTANTS ──────────
    const STORAGE_KEY = 'memorable-topics';
    const INTERVALS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
    const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // ────────── DOM REFS ──────────
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const dom = {
        form: $('#topic-form'),
        nameInput: $('#topic-name'),
        dateInput: $('#start-date'),
        btnSubmit: $('#btn-submit'),
        panelAdd: $('#panel-add'),
        panelUpcoming: $('#panel-upcoming'),
        panelVisualizer: $('#panel-visualizer'),
        reviewList: $('#review-list'),
        emptyState: $('#empty-state'),
        reviewSummary: $('#review-summary'),
        todayCount: $('#today-count'),
        topicCountBadge: $('#topic-count-badge'),
        recentTopics: $('#recent-topics'),
        toastContainer: $('#toast-container'),
        modalOverlay: $('#modal-overlay'),
        modalTopicName: $('#modal-topic-name'),
        modalCancel: $('#modal-cancel'),
        modalConfirm: $('#modal-confirm'),
        btnGoAdd: $('#btn-go-add'),
        vizGreeting: $('#viz-greeting-display'),
        vizInput: $('#viz-input'),
        vizResponse: $('#viz-response'),
        vizModelPill: $('#viz-model-pill'),
        vizModelLabel: $('#viz-model-label'),
        vizDropdownMenu: $('#viz-dropdown-menu'),
        vizDropdownItems: $$('.viz-dropdown__item'),
        vizMicBtn: $('#viz-mic-btn'),
        vizSubmitBtn: $('#viz-submit-btn'),
        vizResponse: $('#viz-response'),
    };

    // ────────── STATE ──────────
    let topics = [];
    let activeTab = 'add';
    let deleteTargetId = null;
    let currentVizModel = 'Flash';
    let chatHistory = [];
    let currentChatId = null;

    // ────────── DATA LAYER (Vercel KV via API) ──────────
    async function loadTopics() {
        try {
            const res = await fetch('/api/topics');
            if (res.ok) {
                topics = await res.json() || [];
            } else {
                topics = [];
            }
        } catch {
            topics = [];
        }
    }

    async function saveTopics() {
        try {
            await fetch('/api/topics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(topics)
            });
        } catch (err) {
            console.error('Failed to sync topics', err);
        }
    }

    function loadVizModel() {
        currentVizModel = localStorage.getItem('memorable-viz-model') || 'Flash';
        if (dom.vizModelLabel) {
            dom.vizModelLabel.textContent = currentVizModel;
        }
    }

    function addTopic(name, startDate) {
        const topic = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            name: name.trim(),
            startDate: startDate, // ISO string 'YYYY-MM-DD'
            createdAt: new Date().toISOString(),
        };
        topics.push(topic);
        saveTopics();
        return topic;
    }

    function deleteTopic(id) {
        topics = topics.filter(t => t.id !== id);
        saveTopics();
    }

    // ────────── CHAT DATA LAYER ──────────

    async function loadChats() {
        try {
            const res = await fetch('/api/chats');
            if (res.ok) {
                chatHistory = await res.json();
            } else {
                chatHistory = [];
            }
        } catch (err) {
            console.error('Failed to load chats:', err);
            chatHistory = [];
        }
        renderChatSidebar();
    }

    function createNewChat() {
        currentChatId = Date.now().toString(36);

        // Reset UI
        const vizCanvas = document.querySelector('.viz-canvas');
        if (vizCanvas) {
            vizCanvas.classList.remove('chat-active');
            vizCanvas.classList.add('initial-state');
        }
        dom.vizResponse.innerHTML = '';
    }

    async function loadChat(id) {
        currentChatId = id;
        
        try {
            const res = await fetch(`/api/messages?chatId=${id}`);
            if (res.ok) {
                const messages = await res.json();
                
                // Set active UI
                const vizCanvas = document.querySelector('.viz-canvas');
                if (vizCanvas) {
                    vizCanvas.classList.remove('initial-state');
                    vizCanvas.classList.add('chat-active');
                }

                // Render messages
                dom.vizResponse.innerHTML = '';
                messages.forEach(msg => {
                    appendMessageToUI(msg.text, msg.role);
                });
            }
        } catch (err) {
            console.error('Failed to load chat messages:', err);
        }

        renderChatSidebar();
    }

    function renderChatSidebar() {
        const list = $('#viz-sidebar-list');
        if (!list) return;

        list.innerHTML = '';
        chatHistory.forEach(chat => {
            const el = document.createElement('div');
            el.className = 'viz-sidebar__item' + (chat.id === currentChatId ? ' viz-sidebar__item--active' : '');
            el.textContent = chat.title;
            el.addEventListener('click', () => loadChat(chat.id));
            list.appendChild(el);
        });
    }

    function appendMessageToUI(text, role) {
        // Prevent duplicate messages if already rendered at the bottom
        const messages = dom.vizResponse.querySelectorAll('.message');
        if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            if (lastMsg.textContent === text && lastMsg.classList.contains(`${role}-message`)) {
                return;
            }
        }

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}-message`;
        msgDiv.textContent = text;
        dom.vizResponse.appendChild(msgDiv);
        dom.vizResponse.scrollTop = dom.vizResponse.scrollHeight;
    }

    // ────────── REPETITION CALCULATOR ──────────
    // Intervals are GAPS between consecutive revisions (cumulative).
    // Rev 1 = start + 1, Rev 2 = Rev1 + 2, Rev 3 = Rev2 + 3, Rev 4 = Rev3 + 5 ...
    function getUpcomingRepetitions() {
        const today = stripTime(new Date());
        const result = [];

        topics.forEach(topic => {
            const start = new Date(topic.startDate + 'T00:00:00');
            let cumulativeDays = 0;

            INTERVALS.forEach((gap, idx) => {
                cumulativeDays += gap;

                const reviewDate = new Date(start);
                reviewDate.setDate(reviewDate.getDate() + cumulativeDays);
                const reviewDateStripped = stripTime(reviewDate);

                if (reviewDateStripped >= today) {
                    const diffMs = reviewDateStripped - today;
                    const daysUntil = Math.round(diffMs / (1000 * 60 * 60 * 24));

                    result.push({
                        topicId: topic.id,
                        topicName: topic.name,
                        date: reviewDateStripped,
                        dateStr: formatDateISO(reviewDateStripped),
                        reviewNumber: idx + 1,
                        totalReviews: INTERVALS.length,
                        daysUntil: daysUntil,
                        intervalDay: cumulativeDays,
                    });
                }
            });
        });

        // Sort ascending by date, then by topic name
        result.sort((a, b) => a.date - b.date || a.topicName.localeCompare(b.topicName));
        return result;
    }

    // ────────── DATE HELPERS ──────────
    function stripTime(d) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function formatDateISO(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function formatDateNice(d) {
        return `${DAYS_SHORT[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    }

    function formatDateShort(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
    }

    function getRelativeLabel(daysUntil) {
        if (daysUntil === 0) return 'Today';
        if (daysUntil === 1) return 'Tomorrow';
        if (daysUntil <= 7) return `In ${daysUntil} days`;
        if (daysUntil <= 30) {
            const weeks = Math.floor(daysUntil / 7);
            return weeks === 1 ? 'In 1 week' : `In ${weeks} weeks`;
        }
        const months = Math.floor(daysUntil / 30);
        return months === 1 ? 'In 1 month' : `In ${months} months`;
    }

    function getUrgencyClass(daysUntil) {
        if (daysUntil <= 1) return 'urgent';
        if (daysUntil <= 7) return 'soon';
        return 'later';
    }

    function getTodayISO() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // ────────── TAB SWITCHING ──────────
    const panels = { add: 'panelAdd', upcoming: 'panelUpcoming', visualizer: 'panelVisualizer' };

    function switchTab(tab) {
        if (activeTab === tab) return;
        activeTab = tab;

        // Update desktop nav
        $$('.topnav__tab').forEach(btn => {
            btn.classList.toggle('topnav__tab--active', btn.dataset.tab === tab);
        });

        // Update mobile nav
        $$('.bottomnav__item').forEach(btn => {
            btn.classList.toggle('bottomnav__item--active', btn.dataset.tab === tab);
        });

        // Hide all panels
        Object.values(panels).forEach(key => {
            dom[key].classList.remove('tab-panel--active');
        });

        // Show target panel with re-animation
        const target = dom[panels[tab]];
        target.style.animation = 'none';
        target.offsetHeight; // reflow
        target.style.animation = '';
        target.classList.add('tab-panel--active');

        if (tab === 'upcoming') {
            renderUpcoming();
        }
        if (tab === 'visualizer') {
            startVizGreeting();
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    }

    // ────────── RENDER: UPCOMING REVIEWS ──────────
    function renderUpcoming() {
        const reps = getUpcomingRepetitions();

        // Update summary
        const todayItems = reps.filter(r => r.daysUntil === 0);
        dom.todayCount.textContent = todayItems.length;
        dom.reviewSummary.textContent = reps.length === 0
            ? 'No reviews scheduled'
            : `${reps.length} review${reps.length !== 1 ? 's' : ''} across ${topics.length} topic${topics.length !== 1 ? 's' : ''}`;

        // Glow effect on today count if > 0
        const ring = $('#today-count-ring');
        if (todayItems.length > 0) {
            ring.style.borderColor = 'var(--badge-urgent)';
            ring.style.boxShadow = '0 0 20px rgba(255,107,107,0.25)';
            dom.todayCount.style.color = 'var(--badge-urgent)';
        } else {
            ring.style.borderColor = 'var(--primary-container)';
            ring.style.boxShadow = '0 0 20px rgba(0,210,255,0.15)';
            dom.todayCount.style.color = 'var(--primary-container)';
        }

        // Clear list
        dom.reviewList.innerHTML = '';

        if (reps.length === 0) {
            dom.reviewList.appendChild(createEmptyState());
            return;
        }

        // Group by date for separators
        let lastDateStr = '';
        let cardIndex = 0;

        reps.forEach((rep) => {
            const dateStr = rep.dateStr;

            // Date separator
            if (dateStr !== lastDateStr) {
                const sep = document.createElement('div');
                sep.className = 'date-separator';
                sep.style.animationDelay = `${cardIndex * 0.04}s`;

                const label = rep.daysUntil === 0 ? 'Today'
                    : rep.daysUntil === 1 ? 'Tomorrow'
                        : formatDateNice(rep.date);

                sep.innerHTML = `
                    <span class="date-separator__line"></span>
                    <span class="date-separator__text">${label}</span>
                    <span class="date-separator__line"></span>
                `;
                dom.reviewList.appendChild(sep);
                lastDateStr = dateStr;
            }

            // Review card
            const urgency = getUrgencyClass(rep.daysUntil);
            const card = document.createElement('div');
            card.className = `review-card review-card--${urgency}`;
            card.style.animationDelay = `${cardIndex * 0.04}s`;

            const day = rep.date.getDate();
            const month = MONTHS_SHORT[rep.date.getMonth()];

            card.innerHTML = `
                <div class="review-card__date-block">
                    <span class="review-card__date-day">${day}</span>
                    <span class="review-card__date-month">${month}</span>
                </div>
                <div class="review-card__content">
                    <div class="review-card__topic">${escapeHtml(rep.topicName)}</div>
                    <div class="review-card__meta">
                        <span class="review-card__badge badge--${urgency}">${getRelativeLabel(rep.daysUntil)}</span>
                        <span>Review #${rep.reviewNumber} · Day +${rep.intervalDay}</span>
                    </div>
                </div>
                <div class="review-card__actions">
                    <button class="btn-icon" data-delete-id="${rep.topicId}" title="Delete topic: ${escapeHtml(rep.topicName)}">
                        <span class="material-symbols-outlined" style="font-size:18px">delete</span>
                    </button>
                </div>
            `;

            dom.reviewList.appendChild(card);
            cardIndex++;
        });
    }

    function createEmptyState() {
        const div = document.createElement('div');
        div.className = 'empty-state';
        div.id = 'empty-state';
        div.innerHTML = `
            <span class="material-symbols-outlined empty-state__icon">auto_stories</span>
            <p class="empty-state__title">No upcoming reviews</p>
            <p class="empty-state__text">Add a topic to begin your spaced repetition journey.</p>
            <button class="btn-ghost" id="btn-go-add-dynamic">
                <span class="material-symbols-outlined" style="font-size:18px">add_circle</span>
                Add Your First Topic
            </button>
        `;
        // Bind the dynamic button
        div.querySelector('#btn-go-add-dynamic').addEventListener('click', () => switchTab('add'));
        return div;
    }

    // ────────── RENDER: RECENT TOPICS (in form panel) ──────────
    function renderRecentTopics() {
        if (topics.length === 0) {
            dom.recentTopics.innerHTML = '';
            return;
        }

        const sorted = [...topics].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const recent = sorted.slice(0, 5);

        let html = `<div class="recent-topics__heading">Your Topics (${topics.length})</div>`;

        recent.forEach((t, i) => {
            html += `
                <div class="recent-item" style="animation-delay:${i * 0.06}s">
                    <div class="recent-item__info">
                        <span class="recent-item__dot"></span>
                        <span class="recent-item__name">${escapeHtml(t.name)}</span>
                    </div>
                    <span class="recent-item__date">${formatDateShort(t.startDate)}</span>
                </div>
            `;
        });

        if (topics.length > 5) {
            html += `<div class="recent-item" style="animation-delay:${5 * 0.06}s">
                <div class="recent-item__info">
                    <span class="recent-item__dot" style="background:var(--outline-variant);box-shadow:none"></span>
                    <span class="recent-item__name" style="color:var(--outline)">+${topics.length - 5} more…</span>
                </div>
            </div>`;
        }

        dom.recentTopics.innerHTML = html;
    }

    // ────────── UPDATE BADGE ──────────
    function updateBadge() {
        if (dom.topicCountBadge) {
            dom.topicCountBadge.textContent = topics.length;
        }
    }

    // ────────── FORM HANDLING ──────────
    function handleSubmit(e) {
        e.preventDefault();

        const name = dom.nameInput.value.trim();
        const date = dom.dateInput.value;

        // Validate name
        if (!name) {
            const group = $('#input-group-name');
            group.classList.add('input-group--error');
            dom.nameInput.focus();
            setTimeout(() => group.classList.remove('input-group--error'), 500);
            showToast('Please enter a topic name.', 'error');
            return;
        }

        // Validate date
        if (!date) {
            const group = $('#input-group-date');
            group.classList.add('input-group--error');
            dom.dateInput.focus();
            setTimeout(() => group.classList.remove('input-group--error'), 500);
            showToast('Please select a start date.', 'error');
            return;
        }

        // Check duplicate
        const exists = topics.some(t => t.name.toLowerCase() === name.toLowerCase());
        if (exists) {
            const group = $('#input-group-name');
            group.classList.add('input-group--error');
            setTimeout(() => group.classList.remove('input-group--error'), 500);
            showToast('A topic with this name already exists.', 'error');
            return;
        }

        // Add
        const topic = addTopic(name, date);

        // Ripple effect on button
        createRipple(e, dom.btnSubmit);

        // Reset form
        dom.nameInput.value = '';
        dom.dateInput.value = getTodayISO();
        dom.nameInput.focus();

        // Update UI
        renderRecentTopics();
        updateBadge();

        // Toast
        showToast(`"${topic.name}" added — ${INTERVALS.length} reviews scheduled!`, 'success');
    }

    // ────────── DELETE ──────────
    function showDeleteModal(topicId) {
        const topic = topics.find(t => t.id === topicId);
        if (!topic) return;

        deleteTargetId = topicId;
        dom.modalTopicName.textContent = `Delete "${topic.name}" and all its scheduled reviews?`;
        dom.modalOverlay.classList.add('modal-overlay--visible');
    }

    function hideDeleteModal() {
        dom.modalOverlay.classList.remove('modal-overlay--visible');
        deleteTargetId = null;
    }

    function confirmDelete() {
        if (!deleteTargetId) return;
        const topic = topics.find(t => t.id === deleteTargetId);
        const name = topic ? topic.name : 'Topic';

        deleteTopic(deleteTargetId);
        hideDeleteModal();

        renderUpcoming();
        renderRecentTopics();
        updateBadge();

        showToast(`"${name}" deleted.`, 'success');
    }

    // ────────── TOAST ──────────
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;

        const icon = type === 'success' ? 'check_circle' : 'error';
        toast.innerHTML = `
            <span class="material-symbols-outlined" style="font-size:20px;color:var(--${type === 'success' ? 'primary-container' : 'error'})">${icon}</span>
            <span>${escapeHtml(message)}</span>
        `;

        dom.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast--exit');
            toast.addEventListener('animationend', () => toast.remove());
        }, 3500);
    }

    // ────────── RIPPLE EFFECT ──────────
    function createRipple(e, button) {
        const rect = button.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = (e.clientX || rect.left + rect.width / 2) - rect.left - size / 2;
        const y = (e.clientY || rect.top + rect.height / 2) - rect.top - size / 2;

        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;

        button.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove());
    }

    // ────────── UTILS ──────────
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ────────── EVENT LISTENERS ──────────
    function bindEvents() {
        // Form submit
        dom.form.addEventListener('submit', handleSubmit);

        // Tab switching — desktop
        $$('.topnav__tab').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        // Tab switching — mobile
        $$('.bottomnav__item').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        // "Add first topic" button in empty state
        if (dom.btnGoAdd) {
            dom.btnGoAdd.addEventListener('click', () => switchTab('add'));
        }

        // Delete buttons (delegated)
        dom.reviewList.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-delete-id]');
            if (btn) {
                showDeleteModal(btn.dataset.deleteId);
            }
        });

        // Modal
        dom.modalCancel.addEventListener('click', hideDeleteModal);
        dom.modalConfirm.addEventListener('click', confirmDelete);
        dom.modalOverlay.addEventListener('click', (e) => {
            if (e.target === dom.modalOverlay) hideDeleteModal();
        });

        // ESC to close modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hideDeleteModal();
        });

        // Visualizer input — Enter key
        if (dom.vizInput) {
            dom.vizInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleVizSubmit();
                }
            });
        }

        // Visualizer model dropdown
        if (dom.vizModelPill) {
            dom.vizModelPill.addEventListener('click', (e) => {
                e.stopPropagation();
                dom.vizDropdownMenu.classList.toggle('viz-dropdown__menu--open');
            });

            document.addEventListener('click', (e) => {
                if (!e.target.closest('#viz-dropdown')) {
                    dom.vizDropdownMenu.classList.remove('viz-dropdown__menu--open');
                }
            });

            dom.vizDropdownItems.forEach(item => {
                item.addEventListener('click', (e) => {
                    currentVizModel = e.target.dataset.value;
                    dom.vizModelLabel.textContent = currentVizModel;
                    localStorage.setItem('memorable-viz-model', currentVizModel);
                    dom.vizDropdownMenu.classList.remove('viz-dropdown__menu--open');
                });
            });
        }

        // Voice Input (Speech-to-Text)
        if (dom.vizMicBtn) {
            let recognition = null;
            let isRecording = false;
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

            if (SpeechRecognition) {
                recognition = new SpeechRecognition();
                recognition.continuous = false;
                recognition.interimResults = true;

                recognition.onstart = () => {
                    isRecording = true;
                    dom.vizMicBtn.classList.add('viz-mic--recording');
                    dom.vizInput.placeholder = "Listening...";
                };

                recognition.onresult = (event) => {
                    let finalTranscript = '';
                    let interimTranscript = '';
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            finalTranscript += event.results[i][0].transcript;
                        } else {
                            interimTranscript += event.results[i][0].transcript;
                        }
                    }
                    dom.vizInput.value = finalTranscript || interimTranscript;
                };

                recognition.onerror = (event) => {
                    console.error("Speech recognition error", event.error);
                    stopRecording();
                    showToast('Speech recognition failed. Please check permissions.', 'error');
                };

                recognition.onend = () => {
                    stopRecording();
                    // Auto-submit if we captured text
                    if (dom.vizInput.value.trim() !== '') {
                        handleVizSubmit();
                    }
                };

                function stopRecording() {
                    isRecording = false;
                    dom.vizMicBtn.classList.remove('viz-mic--recording');
                    dom.vizInput.placeholder = "Ask anything about your topics…";
                    try { recognition.stop(); } catch (e) { }
                }

                dom.vizMicBtn.addEventListener('click', () => {
                    if (isRecording) {
                        stopRecording();
                    } else {
                        dom.vizInput.value = '';
                        try {
                            recognition.start();
                        } catch (e) {
                            console.error(e);
                        }
                    }
                });
            } else {
                dom.vizMicBtn.addEventListener('click', () => {
                    showToast('Speech recognition is not supported in your browser.', 'error');
                });
            }
        }

        // Toggle Mic / Submit buttons
        if (dom.vizInput && dom.vizSubmitBtn && dom.vizMicBtn) {
            dom.vizInput.addEventListener('input', () => {
                if (dom.vizInput.value.trim().length > 0) {
                    dom.vizSubmitBtn.classList.add('viz-search-bar__submit--visible');
                    dom.vizMicBtn.classList.add('viz-search-bar__trailing--hidden');
                } else {
                    dom.vizSubmitBtn.classList.remove('viz-search-bar__submit--visible');
                    dom.vizMicBtn.classList.remove('viz-search-bar__trailing--hidden');
                }
            });

            dom.vizSubmitBtn.addEventListener('click', (e) => {
                e.preventDefault();
                handleVizSubmit();
            });
        }
    }

    // ────────── VISUALIZER: GREETING ROTATION ──────────
    const VIZ_PHRASES = [
        'What would you like to explore?     ',
        'Ready to dive deeper?      ',
        'Your knowledge, visualized       .',
        'Master your memory today.',
        'Discover connections in your learning.       ',
    ];
    let vizPhraseIndex = 0;
    let vizGreetingInterval = null;

    function startVizGreeting() {
        if (vizGreetingInterval) clearInterval(vizGreetingInterval);
        vizPhraseIndex = 0;
        if (dom.vizGreeting) {
            dom.vizGreeting.textContent = VIZ_PHRASES[0];
            dom.vizGreeting.style.opacity = '1';
            dom.vizGreeting.style.transform = 'translateY(0)';
        }

        vizGreetingInterval = setInterval(() => {
            if (activeTab !== 'visualizer') {
                clearInterval(vizGreetingInterval);
                vizGreetingInterval = null;
                return;
            }
            if (!dom.vizGreeting) return;

            // Fade out
            dom.vizGreeting.style.opacity = '0';
            dom.vizGreeting.style.transform = 'translateY(-6px)';

            setTimeout(() => {
                let nextIndex;
                do {
                    nextIndex = Math.floor(Math.random() * VIZ_PHRASES.length);
                } while (nextIndex === vizPhraseIndex && VIZ_PHRASES.length > 1);
                vizPhraseIndex = nextIndex;

                dom.vizGreeting.textContent = VIZ_PHRASES[vizPhraseIndex];
                dom.vizGreeting.style.opacity = '1';
                dom.vizGreeting.style.transform = 'translateY(0)';
            }, 800);
        }, 5000);
    }

    // ────────── VISUALIZER: SUBMIT ──────────
    function handleVizSubmit() {
        const query = dom.vizInput.value.trim();
        if (!query) return;

        // 1. Ensure currentChatId is initialized
        if (!currentChatId) {
            currentChatId = Date.now().toString(36);
        }

        // 2. Trigger layout shift if it's the first message
        const vizCanvas = document.querySelector('.viz-canvas');
        if (vizCanvas && vizCanvas.classList.contains('initial-state')) {
            vizCanvas.classList.remove('initial-state');
            vizCanvas.classList.add('chat-active');
        }

        // 3. Clear input
        dom.vizInput.value = '';

        // 4. Show typing indicator (for AI reply)
        if (!dom.vizResponse.querySelector('.viz-typing')) {
            const typing = document.createElement('div');
            typing.className = 'viz-typing message ai-message';
            typing.style.padding = '12px 20px';
            typing.style.backgroundColor = 'transparent';
            typing.style.border = 'none';
            typing.innerHTML = `
                <div class="viz-typing__dot"></div>
                <div class="viz-typing__dot"></div>
                <div class="viz-typing__dot"></div>
            `;
            dom.vizResponse.appendChild(typing);
            dom.vizResponse.scrollTop = dom.vizResponse.scrollHeight;
        }

        // Reset buttons back to mic state
        if (dom.vizSubmitBtn && dom.vizMicBtn) {
            dom.vizSubmitBtn.classList.remove('viz-search-bar__submit--visible');
            dom.vizMicBtn.classList.remove('viz-search-bar__trailing--hidden');
        }

        // 5. Send message to Vercel API Route
        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: currentChatId,
                query: query,
                topics: topics,
                mode: currentVizModel
            })
        })
        .then(response => {
            if (!response.ok) throw new Error('API failed');
            return response.json();
        })
        .then((data) => {
            const typingIndicator = dom.vizResponse.querySelector('.viz-typing');
            if (typingIndicator) typingIndicator.remove();
            
            appendMessageToUI(data.reply, 'ai');
            
            // Re-load chats to show updated titles/timestamps in the sidebar
            loadChats();
        })
        .catch(error => {
            console.error('Error sending message:', error);
            const typingIndicator = dom.vizResponse.querySelector('.viz-typing');
            if (typingIndicator) typingIndicator.remove();
            appendMessageToUI('Failed to send message to Memorable server.', 'ai');
        });
    }

    // Helper: get repetitions for a single topic
    function getTopicRepetitions(topic) {
        const start = new Date(topic.startDate + 'T00:00:00');
        let cumulativeDays = 0;
        const reps = [];

        INTERVALS.forEach((gap, idx) => {
            cumulativeDays += gap;
            const reviewDate = new Date(start);
            reviewDate.setDate(reviewDate.getDate() + cumulativeDays);
            reps.push({
                date: stripTime(reviewDate),
                reviewNumber: idx + 1,
            });
        });
        return reps;
    }

    async function init() {
        // Set default date
        dom.dateInput.value = getTodayISO();

        await loadTopics();

        renderRecentTopics();
        renderUpcoming();
        updateBadge();

        // Bind events
        bindEvents();
    }

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
