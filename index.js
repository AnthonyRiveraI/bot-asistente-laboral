const express = require("express");
const mongoose = require('mongoose');
const rateLimit = require("express-rate-limit");
const axios = require('axios');
require("dotenv").config();
const path = require('path');
const { connectDB, Thread } = require('./db');
const { client, addThread, checkRunStatus, processToolCalls } = require('./coreFunctions');
const { getCurrentTime } = require('./utility_tools/datetime');
const { loadToolsFromDirectory } = require('./coreFunctions');

const app = express();
app.use(cors({
    origin: 'http://127.0.0.1:5500', // Permitir solicitudes desde este origen
    methods: ['GET', 'POST'], // Métodos permitidos
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-KEY'], // Encabezados permitidos
}));

app.use(express.json());

// Conectar a la base de datos
connectDB();  // Asegúrate de tener la conexión a MongoDB configurada correctamente

// Cargar herramientas desde el directorio
const toolsDirectory = path.join(__dirname, 'tools');
const tool_data = loadToolsFromDirectory(toolsDirectory);

// Imprimir las herramientas cargadas y las funciones disponibles
console.log('Herramientas cargadas:', tool_data.tool_configs);
console.log('Funciones disponibles:', Object.keys(tool_data.function_map));

const VALID_TOKEN = process.env.VALID_TOKEN;

// Middleware para verificar la autenticación del token
const verifyHeaders = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
        return res.status(400).json({ error: "Falta el encabezado Authorization" });
    }

    const token = authHeader.split(" ")[1];

    if (token !== VALID_TOKEN) {
        return res.status(403).json({ error: "Acceso prohibido: token no válido" });
    }

    next();
};

// Limitar a 100 mensajes por día
const chatLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,  // 24 horas
    max: 100,  // Limitar a 100 mensajes por día
    message: "Has alcanzado el límite de 100 mensajes por día"
});

// Ruta para iniciar una nueva conversación
app.get('/start', async (req, res) => {
    const platform = req.query.platform || 'Not Specified';
    const username = req.query.username || 'Not Specified';

    try {
        console.log(`Iniciando nueva conversación desde la plataforma: ${platform} para el usuario: ${username}`);

        // Verificar si ya existe un thread para el usuario en la base de datos
        const existingThread = await Thread.findOne({ username, platform });

        if (existingThread) {
            console.log(`Usando hilo existente con ID: ${existingThread.thread_id} para el usuario: ${username}`);
            return res.status(200).json({ thread_id: existingThread.thread_id, message: 'Usando hilo existente' });
        }

        // Crear un nuevo thread en OpenAI
        const openAIThread = await client.beta.threads.create();
        if (!openAIThread || !openAIThread.id) {
            throw new Error("No se pudo obtener el 'thread_id' de OpenAI.");
        }

        const currentTime = await getCurrentTime();
        const timestamp = new Date(currentTime);  // Asegúrate de que sea una instancia de Date
        if (isNaN(timestamp.getTime())) {
            throw new Error("La fecha obtenida no es válida");
        }

        const newThread = new Thread({
            thread_id: openAIThread.id,  // Usar el thread_id de OpenAI
            platform: platform,
            username: username,
            timestamp: timestamp,
            status: 'Arrived'
        });

        // Guardar el nuevo thread en la base de datos
        await newThread.save();
        console.log(`Nuevo hilo creado con ID: ${newThread.thread_id}`);

        res.status(200).json({ thread_id: newThread.thread_id, message: 'Hilo creado con éxito' });
    } catch (error) {
        console.error('Error al crear o recuperar el hilo:', error);
        res.status(500).json({ error: 'Error al crear o recuperar el hilo' });
    }
});

app.post('/chat', chatLimiter, verifyHeaders, async (req, res) => {
    const { thread_id, message } = req.body;

    if (!thread_id) {
        console.error("Error: Faltante thread_id");
        return res.status(400).json({ error: "Faltante thread_id" });
    }

    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: "El mensaje es obligatorio y debe ser una cadena." });
    }

    try {
        console.log(`Received message: ${message} for thread ID: ${thread_id}`);

        const messageResponse = await client.beta.threads.messages.create(thread_id, {
            role: "user",
            content: message
        });

        if (!messageResponse || !messageResponse.id) {
            throw new Error("No se pudo obtener la respuesta del mensaje correctamente.");
        }

        console.log(`Message sent successfully, response ID: ${messageResponse.id}`);

        const run = await client.beta.threads.runs.create(thread_id, {
            assistant_id: process.env.ASSISTANT_ID
        });

        if (!run || !run.id) {
            throw new Error("No se pudo obtener el run_id de la respuesta de OpenAI.");
        }

        const runId = run.id;
        console.log(`Run created with ID: ${runId}`);

        return res.status(200).json({ run_id: runId });

    } catch (error) {
        console.error('Error en /chat:', error.response ? error.response.data : error.message);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.post('/check', async (req, res) => {
    try {
        // Obtener los datos del cuerpo de la solicitud
        const { thread_id, run_id } = req.body;

        if (!thread_id || !run_id) {
            console.error("Error: Faltante thread_id o run_id en /check");
            return res.status(400).json({ error: "Faltante thread_id o run_id" });
        }

        // Llamar a processToolCalls para manejar la lógica de las herramientas
        const result = await processToolCalls(client, thread_id, run_id, tool_data);

        // Devolver la respuesta
        res.status(200).json(result);
    } catch (error) {
        console.error("Error en /check:", error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Iniciar servidor
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor corriendo en el puerto ${port}`));
