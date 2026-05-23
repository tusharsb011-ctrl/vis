const { chatsContainer } = require('./cosmosClient');

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        if (!chatsContainer) {
            return res.status(200).json([]);
        }

        const { resources } = await chatsContainer.items.query("SELECT * FROM c ORDER BY c.updated_at DESC").fetchAll();
        return res.status(200).json(resources || []);
    } catch (error) {
        console.error('Error fetching chats:', error);
        return res.status(500).json({ error: 'Failed to fetch chats' });
    }
}
