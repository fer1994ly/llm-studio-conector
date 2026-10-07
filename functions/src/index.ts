import * as functions from 'firebase-functions/v1';
import cors from 'cors';
import fetch from 'node-fetch';

const corsHandler = cors({ origin: true });

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  apiBaseUrl?: string;
  apiKey?: string;
}

export const api = functions.https.onRequest((request, response) => {
  corsHandler(request, response, async () => {
    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      response.status(200).send();
      return;
    }

    // Only allow POST requests
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Método no permitido' });
      return;
    }

    // Route to chat endpoint
    if (request.url.includes('/chat')) {
      await handleChatCompletion(request, response);
    } else {
      response.status(404).json({ error: 'Endpoint no encontrado' });
    }
  });
});

async function handleChatCompletion(
  request: functions.https.Request,
  response: functions.Response
): Promise<void> {
  try {
    const body: ChatRequest = request.body;
    
    const {
      model,
      messages,
      temperature = 0.7,
      max_tokens = 1024,
      stream = true,
      apiBaseUrl = functions.config().api?.base_url || 'http://localhost:1234/v1',
      apiKey = functions.config().api?.key || body.apiKey || '',
    } = body;

    // Validate required parameters
    if (!model || !messages || !Array.isArray(messages)) {
      response.status(400).json({ 
        error: 'Faltan parámetros requeridos: model, messages' 
      });
      return;
    }

    // Prepare headers for upstream API
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey && apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }

    // Prepare request body
    const requestBody = {
      model,
      messages,
      temperature,
      max_tokens,
      stream,
    };

    console.log(`Proxying request to: ${apiBaseUrl}/chat/completions`);

    // Make request to upstream API
    const apiResponse = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      let errorMessage = `Error ${apiResponse.status}`;
      
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }

      console.error('Upstream API error:', errorMessage);
      response.status(apiResponse.status).json({ 
        error: errorMessage 
      });
      return;
    }

    // Handle streaming response
    if (stream && apiResponse.body) {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      // Pipe the streaming response
      apiResponse.body.pipe(response);
    } else {
      // Handle non-streaming response
      const data = await apiResponse.json();
      response.status(200).json(data);
    }

  } catch (error) {
    console.error('Error en proxy de chat:', error);
    
    let errorMessage = 'Error interno del servidor';
    if (error instanceof Error) {
      errorMessage = error.message;
    }

    response.status(500).json({ 
      error: errorMessage 
    });
  }
}
