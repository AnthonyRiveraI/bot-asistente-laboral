const axios = require('axios');
const { unescape } = require('querystring');
require('dotenv').config();  // Asegúrate de usar dotenv para cargar variables de entorno

// URL del Webhook para enviar los datos (se obtiene de la variable de entorno)
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://hook.us2.make.com/349qjcw5disoaprcutnjy0vyon0g73zg";

// Configuración de la herramienta
const tool_config = {
    type: "function",
    function: {
        name: "conversation_summary_request",
        description: "Recoge el nombre del usuario, correo electrónico, número de teléfono y resumen de la conversación, luego envía los datos a un webhook para su procesamiento.",
        parameters: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "El nombre completo del usuario."
                },
                email: {
                    type: "string",
                    description: "Una dirección de correo válida del usuario."
                },
                phone_number: {
                    type: "string",
                    description: "Un número de teléfono válido en formato internacional."
                },
                conversation_summary: {
                    type: "string",
                    description: "Un breve resumen de los puntos de la conversación."
                }
            },
            required: ["name", "email", "phone_number", "conversation_summary"]
        }
    }
};

// Función de callback para enviar los datos al Webhook
const conversation_summary_request = async (arguments) => {
    try {
        let { name, email, phone_number, conversation_summary } = arguments;

        // Verificar que todos los parámetros estén presentes
        if (!name || !email || !phone_number || !conversation_summary) {
            return { status: "error", message: "Faltan parámetros requeridos para procesar la solicitud." };
        }

        // Preparar los datos del payload
        const data = {
            name: unescape(name),
            email: unescape(email),
            phone_number: phone_number,
            conversation_summary: unescape(conversation_summary)
        };

        // Enviar los datos al Webhook
        const response = await axios.post(WEBHOOK_URL, data, {
            headers: { "Content-Type": "application/json" }
        });

        if (response.status === 200) {
            return { status: "completed", message: "El resumen de la conversación se ha enviado con éxito. Nos pondremos en contacto contigo pronto." };
        } else {
            throw new Error(`Error al enviar el resumen de la conversación: ${response.data}`);
        }
    } catch (error) {
        console.error('Error al enviar datos al webhook:', error);
        return { status: "error", message: `Error al conectar con el webhook: ${error.message}` };
    }
};

// Exportar la configuración y la función
module.exports = {
    tool_config,
    conversation_summary_request
};
