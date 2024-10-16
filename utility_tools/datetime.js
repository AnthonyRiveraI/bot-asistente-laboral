const axios = require('axios');

// Base URL de la API de World Time
const BASE_URL = "http://worldtimeapi.org/api/timezone/";

// Función para obtener la hora actual desde la API
const getCurrentTime = async (timezone = 'America/Lima') => {
    try {
        // Construir la URL completa para la API
        const url = `${BASE_URL}${timezone}`;
        
        // Hacer la solicitud GET a la API de World Time
        const response = await axios.get(url);

        // Verificar que la solicitud fue exitosa
        if (response.status === 200) {
            const currentTime = response.data.datetime; // Obtener la fecha en formato ISO
            return new Date(currentTime); // Devolver directamente un objeto Date
        } else {
            throw new Error(`Error al obtener la hora para la zona horaria ${timezone}: ${response.statusText}`);
        }
    } catch (error) {
        throw new Error(`Error de conexión con la API de World Time: ${error.message}`);
    }
};

module.exports = {
    getCurrentTime
};