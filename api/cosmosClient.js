const { CosmosClient } = require('@azure/cosmos');

const endpoint = process.env.COSMOS_ENDPOINT || '';
const key = process.env.COSMOS_KEY || '';

const client = (endpoint && key) ? new CosmosClient({ endpoint, key }) : null;
const database = client ? client.database('visDB') : null;
const chatsContainer = database ? database.container('chats') : null;
const messagesContainer = database ? database.container('messages') : null;

module.exports = { client, database, chatsContainer, messagesContainer };
