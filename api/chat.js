const { GoogleGenAI } = require('@google/genai');
const { chatsContainer, messagesContainer } = require('./cosmosClient');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { chatId, query, topics, mode } = req.body;

        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }
        if (!chatId) {
            return res.status(400).json({ error: 'chatId is required' });
        }

        // 1. Ensure Cosmos DB is configured
        if (!chatsContainer || !messagesContainer) {
            console.error('Cosmos DB is not configured on the backend.');
        } else {
            // 2. Ensure the chat exists in the database
            const { resource: existingChat } = await chatsContainer.item(chatId, chatId).read();

            if (!existingChat) {
                const title = query.slice(0, 30) + (query.length > 30 ? '...' : '');
                await chatsContainer.items.create({ id: chatId, title: title, updated_at: new Date().toISOString() });
            } else {
                existingChat.updated_at = new Date().toISOString();
                await chatsContainer.item(chatId, chatId).replace(existingChat);
            }

            // 3. Save the user's message
            await messagesContainer.items.create({
                id: Date.now().toString(36) + Math.random().toString(36).substring(2),
                chat_id: chatId, 
                role: 'user', 
                text: query,
                created_at: new Date().toISOString()
            });
        }

        // 4. Initialize Gemini SDK
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'AIzaSyBMw64DYSrFkTPMgWLHbrbO-TpB_NrIYsk' });
        
        const modelName = mode === 'Pro' ? 'gemini-1.5-pro' : 'gemini-1.5-flash';

        // Prepare context
        const context = `You are Aetheric, a helpful AI assistant built into a spaced repetition tracker. 
Here is the user's current spaced repetition data:
${JSON.stringify(topics, null, 2)}

User's Query: ${query}

Respond directly, concisely, and helpfully based on the user's topics. Format your response cleanly.`;

        // Generate content
        const response = await ai.models.generateContent({
            model: modelName,
            contents: context,
        });

        const reply = response.text || 'No response received.';

        // 5. Save the AI's response to the database
        if (chatsContainer && messagesContainer) {
            await messagesContainer.items.create({ 
                id: Date.now().toString(36) + Math.random().toString(36).substring(2),
                chat_id: chatId, 
                role: 'ai', 
                text: reply,
                created_at: new Date().toISOString()
            });

            // Update chat's updated_at timestamp to bring it to the top
            const { resource: existingChat } = await chatsContainer.item(chatId, chatId).read();
            if (existingChat) {
                existingChat.updated_at = new Date().toISOString();
                await chatsContainer.item(chatId, chatId).replace(existingChat);
            }
        }

        return res.status(200).json({ reply });
    } catch (error) {
        console.error('Error calling Gemini or Cosmos DB:', error);
        return res.status(500).json({ error: 'Failed to process request' });
    }
}
