const express = require("express");
require("dotenv").config();
const OpenAI = require("openai");
const semver = require('semver');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { getCurrentTime } = require('./utility_tools/datetime');
const axios = require('axios');
const app = express();
app.use(express.json());

const OPENAI_API_KEY = process.env.OPEN_AI_KEY_ASISTANCE;
const ASSISTANT_ID = process.env.ASSISTANT_ID;
const CUSTOM_API_KEY = process.env.CUSTOM_API_KEY; // Esta es tu clave API personalizada

// Inicialización del cliente de OpenAI
const client = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

// Verificar si la clave API de OpenAI está en las variables de entorno
if (!OPENAI_API_KEY) {
    throw new Error("No se encontró la clave API de OpenAI en las variables de entorno");
}

// Middleware para verificar la clave API personalizada
const verifyApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (apiKey !== CUSTOM_API_KEY) {
        console.log(`Clave API inválida: ${apiKey}`);
        return res.status(401).json({ error: 'No autorizado: clave API inválida' });
    }

    next();
};


// Función para agregar un hilo a la base de datos
async function addThread(thread_id, platform, username) {
    try {
        const currentTime = await getCurrentTime();
        const newThread = new Thread({
            thread_id,
            platform,
            username,
            timestamp: new Date(currentTime),
            status: 'Arrived'
        });
        await newThread.save();
        console.log('Hilo agregado a la base de datos con éxito.');
    } catch (error) {
        console.error('Error al agregar el hilo a la base de datos:', error);
    }
}

// Función para verificar el estado de la ejecución
async function checkRunStatus(client, thread_id, run_id, tool_data) {
    try {
        if (!thread_id || !run_id) {
            console.error('Error: Faltante thread_id o run_id');
            throw new Error('Faltante thread_id o run_id');
        }

        console.log(`Verificando el estado del run con ID: ${run_id} para el hilo: ${thread_id}`);
        return { status: 'completed', run_id }; // Esto es un placeholder
    } catch (error) {
        console.error('Error al verificar el estado de la ejecución:', error);
        throw error;
    }
}

// Función para limpiar contenido en formato Markdown
function cleanMarkdown(text) {
    // Eliminar encabezados de Markdown
    text = text.replace(/^#+\s*/gm, '');
    // Eliminar negritas con asteriscos
    text = text.replace(/\*\*(.*?)\*\*/g, '$1');
    // Eliminar enlaces en formato Markdown
    text = text.replace(/\[.*?\]\((.*?)\)/g, '$1');
    return text;
}

// Función auxiliar para limpiar el contenido de Markdown (similar a clean_markdown en Python)
function cleanMarkdown(text) {
    text = text.replace(/^#+\s*/gm, '');  // Eliminar encabezados Markdown
    text = text.replace(/\*\*(.*?)\*\*/g, '$1');  // Eliminar negritas
    text = text.replace(/\[.*?\]\((.*?)\)/g, '$1');  // Eliminar enlaces
    return text;
}

const processToolCalls = async (client, thread_id, run_id, tool_data) => {
    try {
        const startTime = Date.now();
        const maxExecutionTime = 15000; // Límite de 15 segundos para el tiempo de ejecución

        while (Date.now() - startTime < maxExecutionTime) {
            const runStatus = await client.beta.threads.runs.retrieve(thread_id, run_id);
            console.log(`Checking run status: ${runStatus.status}`);

            if (runStatus.status === 'completed') {
                const messages = await client.beta.threads.messages.list(thread_id);
                let messageContent = messages.data[0].content[0].text.value;
                console.log(`Message content before cleaning: ${messageContent}`);

                // Limpiar el contenido del mensaje
                messageContent = cleanMarkdown(messageContent);

                // Eliminar referencias
                messageContent = messageContent.replace(/【.*?†.*?】/g, '');
                messageContent = messageContent.replace(/\s+/g, ' ').trim(); // Eliminar espacios extra

                console.log(`Message content after cleaning: ${messageContent}`);

                return { response: messageContent, status: "completed" };
            } else if (runStatus.status === 'requires_action') {
                console.log("Run requires action, handling...");

                for (const toolCall of runStatus.required_action.submit_tool_outputs.tool_calls) {
                    const functionName = toolCall.function.name;

                    let args;
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch (error) {
                        console.error(`JSON decoding failed: ${error.message}. Input: ${toolCall.function.arguments}`);
                        args = {};
                    }

                    if (tool_data.function_map && tool_data.function_map[functionName]) {
                        const functionToCall = tool_data.function_map[functionName];
                        const output = await functionToCall(args);

                        // En lugar de usar client.beta, usa client directamente
                        if (client.threads && client.threads.runs && client.threads.runs.submitToolOutputs) {
                            await client.threads.runs.submitToolOutputs(thread_id, run_id, {
                                tool_outputs: [{
                                    tool_call_id: toolCall.id,
                                    output: JSON.stringify(output)
                                }]
                            });
                        } else {
                            console.error("Error: submitToolOutputs no está disponible en este cliente OpenAI.");
                            return { response: "error", status: "failed" };
                        }
                    } else {
                        console.warn(`Function ${functionName} not found in tool data.`);
                    }
                }
            } else if (runStatus.status === 'failed') {
                console.error("Run failed");
                return { response: "error", status: "failed" };
            }

            await new Promise(resolve => setTimeout(resolve, 2000)); // Esperar 2 segundos antes de verificar nuevamente
        }

        console.log("Run timed out");
        return { response: "timeout", status: "timeout" };
    } catch (error) {
        console.error("Error in processToolCalls:", error.message);
        throw new Error("Error al procesar las llamadas de herramientas.");
    }
};



// Función para cargar las herramientas desde el directorio
const loadToolsFromDirectory = (directory) => {
    const tool_data = { tool_configs: [], function_map: {} };

    // Leer todos los archivos del directorio
    fs.readdirSync(directory).forEach((filename) => {
        if (filename.endsWith('.js')) {
            // Obtener la ruta completa del archivo
            const filePath = path.join(directory, filename);

            // Cargar dinámicamente el módulo
            const tool = require(filePath);

            // Verificar si el módulo tiene la configuración `tool_config`
            if (tool.tool_config) {
                tool_data.tool_configs.push(tool.tool_config); // Agregar tool_config
            }

            // Mapear las funciones exportadas en el archivo
            Object.keys(tool).forEach((funcName) => {
                if (typeof tool[funcName] === 'function') {
                    tool_data.function_map[funcName] = tool[funcName];
                }
            });
        }
    });

    return tool_data;
};

// Exportar funciones y cliente OpenAI
module.exports = {
    addThread,
    checkRunStatus,
    processToolCalls,
    client, // Usamos el cliente OpenAI inicializado
    verifyApiKey,
    loadToolsFromDirectory,
    getCurrentTime // Exportar middleware para verificar la clave API
};
