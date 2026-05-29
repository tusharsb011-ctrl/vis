const { kv } = require('@vercel/kv');
const { getTopicsCollection } = require('./mongoClient');

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

function normalizeTopicName(name) {
  return String(name || '').trim();
}

function normalizeTopicId(name) {
  const normalizedName = normalizeTopicName(name).toLowerCase();
  if (!normalizedName) return null;
  const base = normalizedName.normalize ? normalizedName.normalize('NFKD') : normalizedName;
  const slug = base
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `topic-${hashString(normalizedName)}`;
}

function normalizeTopics(input) {
  const list = Array.isArray(input) ? input : [];
  const byId = new Map();

  list.forEach((topic) => {
    if (!topic || !topic.name) return;
    const name = normalizeTopicName(topic.name);
    if (!name) return;
    const id = normalizeTopicId(name);
    if (!id) return;
    const createdAt = topic.createdAt || new Date().toISOString();
    const normalizedTopic = { ...topic, id, name, createdAt };

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, normalizedTopic);
      return;
    }

    const existingTime = Date.parse(existing.createdAt) || 0;
    const newTime = Date.parse(normalizedTopic.createdAt) || 0;
    if (newTime >= existingTime) {
      byId.set(id, normalizedTopic);
    }
  });

  return Array.from(byId.values());
}

async function getMongoTopics() {
  const collection = await getTopicsCollection();
  if (!collection) return null;
  const doc = await collection.findOne({ _id: 'user_topics' });
  return doc?.topics || [];
}

async function setMongoTopics(topics) {
  const collection = await getTopicsCollection();
  if (!collection) return false;
  await collection.updateOne(
    { _id: 'user_topics' },
    { $set: { topics: topics || [], updated_at: new Date().toISOString() } },
    { upsert: true }
  );
  return true;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const mongoTopics = await getMongoTopics();
      if (mongoTopics !== null) {
        return res.status(200).json(normalizeTopics(mongoTopics));
      }
      let topics = [];
      if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        topics = await kv.get('user_topics');
      }
      return res.status(200).json(normalizeTopics(topics || []));
    } catch (err) {
      console.error('GET /api/topics error', err);
      return res.status(500).json({ error: 'Failed to fetch topics' });
    }
  } else if (req.method === 'POST') {
    try {
      const topics = normalizeTopics(req.body);
      const storedInMongo = await setMongoTopics(topics);
      if (!storedInMongo && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        await kv.set('user_topics', topics);
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('POST /api/topics error', err);
      return res.status(500).json({ error: 'Failed to save topics' });
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
};
