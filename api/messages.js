const { messagesContainer } = require('./cosmosClient');

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { chatId } = req.query;

    if (!chatId) {
        return res.status(400).json({ error: 'chatId is required' });
    }

    try {
        if (!messagesContainer) {
            return res.status(200).json([]);
        }

        const { resources } = await messagesContainer.items.query({
            query: "SELECT * FROM c WHERE c.chat_id = @chatId ORDER BY c.created_at ASC",
            parameters: [{ name: "@chatId", value: chatId }]
        }).fetchAll();
        
        return res.status(200).json(resources || []);
    } catch (error) {
        console.error('Error fetching messages:', error);
        return res.status(500).json({ error: 'Failed to fetch messages' });
    }
}
