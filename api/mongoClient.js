const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || 'visDB';

let cached = global._mongoClient;
if (!cached) {
  cached = global._mongoClient = { client: null, promise: null };
}

async function getMongoClient() {
  if (!uri) return null;
  if (cached.client) return cached.client;
  if (!cached.promise) {
    const client = new MongoClient(uri);
    cached.promise = client.connect().then((connectedClient) => {
      cached.client = connectedClient;
      return connectedClient;
    });
  }
  return cached.promise;
}

async function getTopicsCollection() {
  const client = await getMongoClient();
  if (!client) return null;
  return client.db(dbName).collection('topics');
}

module.exports = { getMongoClient, getTopicsCollection };
