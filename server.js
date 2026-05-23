require('dotenv').config();

const express = require('express');
const path = require('path');
const { chatsContainer, messagesContainer } = require('./api/cosmosClient');

const app = express();
app.use(express.json());

let inMemoryChats = {};
let inMemoryMessages = {};

// Serve static frontend files (index.html, app.js, style.css)
app.use(express.static(path.join(__dirname)));

app.get('/api/chats', async (req, res) => {
  try {
    if (chatsContainer) {
      const { resources } = await chatsContainer.items.query("SELECT * FROM c ORDER BY c.updated_at DESC").fetchAll();
      return res.json(resources || []);
    }

    const arr = Object.values(inMemoryChats).sort((a, b) => {
      const at = new Date(a.updated_at).getTime() || 0;
      const bt = new Date(b.updated_at).getTime() || 0;
      return bt - at;
    });
    return res.json(arr);
  } catch (err) {
    console.error('GET /api/chats error', err);
    return res.status(500).json([]);
  }
});

app.get('/api/messages', async (req, res) => {
  const chatId = req.query.chatId;
  if (!chatId) return res.status(400).json([]);

  try {
    if (messagesContainer) {
      const { resources } = await messagesContainer.items.query({
        query: "SELECT * FROM c WHERE c.chat_id = @chatId ORDER BY c.created_at ASC",
        parameters: [{ name: "@chatId", value: chatId }]
      }).fetchAll();
      return res.json(resources || []);
    }

    return res.json(inMemoryMessages[chatId] || []);
  } catch (err) {
    console.error('GET /api/messages error', err);
    return res.status(500).json([]);
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { chatId, query, topics, mode } = req.body || {};
    if (!chatId || !query) return res.status(400).json({ error: 'chatId and query required' });

    // Ensure chat exists
    if (chatsContainer && messagesContainer) {
      const { resource: existing } = await chatsContainer.item(chatId, chatId).read();
      if (!existing) {
        const title = query.slice(0, 30) + (query.length > 30 ? '...' : '');
        await chatsContainer.items.create({ id: chatId, title, updated_at: new Date().toISOString() });
      } else {
          // Cosmos DB requires id for upsert/replace, we will update the updated_at
          existing.updated_at = new Date().toISOString();
          await chatsContainer.item(chatId, chatId).replace(existing);
      }

      await messagesContainer.items.create({ 
          id: Date.now().toString(36) + Math.random().toString(36).substring(2),
          chat_id: chatId, 
          role: 'user', 
          text: query,
          created_at: new Date().toISOString()
      });
    } else {
      if (!inMemoryChats[chatId]) {
        inMemoryChats[chatId] = { id: chatId, title: query.slice(0, 30), updated_at: new Date().toISOString() };
      } else {
          inMemoryChats[chatId].updated_at = new Date().toISOString();
      }
      inMemoryMessages[chatId] = inMemoryMessages[chatId] || [];
      inMemoryMessages[chatId].push({ chat_id: chatId, role: 'user', text: query, created_at: new Date().toISOString() });
    }

    // Try to call Google GenAI if configured
    let replyText = 'No AI configured. (Local dev response)';
    try {
      let GoogleGenAI;
      try { GoogleGenAI = require('@google/genai').GoogleGenAI; } catch (e) { GoogleGenAI = null; }

      if (GoogleGenAI && process.env.GEMINI_API_KEY) {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const modelName = mode === 'Pro' ? 'gemini-1.5-pro' : 'gemini-1.5-flash';
        const context = `You are Aetheric. Topics: \n${JSON.stringify(topics || [], null, 2)}\nUser Query: ${query}`;
        const response = await ai.models.generateContent({ model: modelName, contents: context });
        replyText = response.text || replyText;
      } else {
        replyText = `Echo: ${query}`;
      }
    } catch (err) {
      console.error('AI generation error', err);
    }

    // Save AI reply
    if (chatsContainer && messagesContainer) {
      await messagesContainer.items.create({ 
          id: Date.now().toString(36) + Math.random().toString(36).substring(2),
          chat_id: chatId, 
          role: 'ai', 
          text: replyText,
          created_at: new Date().toISOString()
      });
      // updating chat timestamp again
      const { resource: existing } = await chatsContainer.item(chatId, chatId).read();
      if(existing) {
          existing.updated_at = new Date().toISOString();
          await chatsContainer.item(chatId, chatId).replace(existing);
      }
    } else {
      inMemoryMessages[chatId].push({ chat_id: chatId, role: 'ai', text: replyText, created_at: new Date().toISOString() });
      inMemoryChats[chatId].updated_at = new Date().toISOString();
    }

    return res.json({ reply: replyText });
  } catch (error) {
    console.error('POST /api/chat error', error);
    return res.status(500).json({ error: 'Failed to process request' });
  }
});
let inMemoryTopics = [];

app.get('/api/topics', async (req, res) => {
  try {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const { kv } = require('@vercel/kv');
      const topics = await kv.get('user_topics');
      return res.json(topics || []);
    }
    return res.json(inMemoryTopics);
  } catch (err) {
    console.error('GET /api/topics error', err);
    return res.status(500).json({ error: 'Failed to fetch topics' });
  }
});

app.post('/api/topics', async (req, res) => {
  try {
    const topics = req.body;
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const { kv } = require('@vercel/kv');
      await kv.set('user_topics', topics);
      return res.json({ success: true });
    }
    inMemoryTopics = topics || [];
    return res.json({ success: true });
  } catch (err) {
    console.error('POST /api/topics error', err);
    return res.status(500).json({ error: 'Failed to save topics' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
