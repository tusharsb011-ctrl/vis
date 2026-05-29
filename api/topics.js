const { kv } = require('@vercel/kv');
const { getTopicsCollection } = require('./mongoClient');

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
        return res.status(200).json(mongoTopics);
      }
      let topics = [];
      if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        topics = await kv.get('user_topics');
      }
      return res.status(200).json(topics || []);
    } catch (err) {
      console.error('GET /api/topics error', err);
      return res.status(500).json({ error: 'Failed to fetch topics' });
    }
  } else if (req.method === 'POST') {
    try {
      const topics = req.body;
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
